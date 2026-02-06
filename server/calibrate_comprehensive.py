#!/usr/bin/env python3
"""
Comprehensive Tennis Calibration System
========================================
Integrates pose detection, ball tracking, court detection, and bounce detection
to produce validated, outcome-aware calibration data.

Features:
- Body-relative normalization (uses player torso as scale reference)
- Camera angle detection (validates viewing angle is suitable)
- Ball tracking with TrackNet
- Court detection with 14-point model
- Bounce detection to determine shot outcomes (in/out)
- Shot segmentation and outcome classification
- Real-world metric conversion (m/s, degrees)

Requirements:
- model_weights/model_best.pt (TrackNet ball detection)
- model_weights/model_tennis_court_det.pt (Court detection)
- server/ctb_regr_bounce.cbm (Bounce detection - optional)

Expected video: 1280x720 resolution, broadcast-style tennis footage
"""

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import json
import argparse
import os
from datetime import datetime
from collections import deque
from scipy.spatial import distance
from scipy.interpolate import CubicSpline
from tqdm import tqdm
import math

# ============================================================================
# NEURAL NETWORK ARCHITECTURES
# ============================================================================

class ConvBlock(nn.Module):
    """Convolutional block with ReLU and BatchNorm"""
    def __init__(self, in_channels, out_channels, kernel_size=3, pad=1, stride=1, bias=True):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size, stride=stride, padding=pad, bias=bias),
            nn.ReLU(),
            nn.BatchNorm2d(out_channels)
        )

    def forward(self, x):
        return self.block(x)


class BallTrackerNet(nn.Module):
    """TrackNet architecture for ball/keypoint detection"""
    def __init__(self, input_channels=3, out_channels=14):
        super().__init__()
        self.out_channels = out_channels
        self.input_channels = input_channels

        self.conv1 = ConvBlock(in_channels=self.input_channels, out_channels=64)
        self.conv2 = ConvBlock(in_channels=64, out_channels=64)
        self.pool1 = nn.MaxPool2d(kernel_size=2, stride=2)
        self.conv3 = ConvBlock(in_channels=64, out_channels=128)
        self.conv4 = ConvBlock(in_channels=128, out_channels=128)
        self.pool2 = nn.MaxPool2d(kernel_size=2, stride=2)
        self.conv5 = ConvBlock(in_channels=128, out_channels=256)
        self.conv6 = ConvBlock(in_channels=256, out_channels=256)
        self.conv7 = ConvBlock(in_channels=256, out_channels=256)
        self.pool3 = nn.MaxPool2d(kernel_size=2, stride=2)
        self.conv8 = ConvBlock(in_channels=256, out_channels=512)
        self.conv9 = ConvBlock(in_channels=512, out_channels=512)
        self.conv10 = ConvBlock(in_channels=512, out_channels=512)
        self.ups1 = nn.Upsample(scale_factor=2)
        self.conv11 = ConvBlock(in_channels=512, out_channels=256)
        self.conv12 = ConvBlock(in_channels=256, out_channels=256)
        self.conv13 = ConvBlock(in_channels=256, out_channels=256)
        self.ups2 = nn.Upsample(scale_factor=2)
        self.conv14 = ConvBlock(in_channels=256, out_channels=128)
        self.conv15 = ConvBlock(in_channels=128, out_channels=128)
        self.ups3 = nn.Upsample(scale_factor=2)
        self.conv16 = ConvBlock(in_channels=128, out_channels=64)
        self.conv17 = ConvBlock(in_channels=64, out_channels=64)
        self.conv18 = ConvBlock(in_channels=64, out_channels=self.out_channels)
        self._init_weights()

    def forward(self, x):
        x = self.conv1(x)
        x = self.conv2(x)
        x = self.pool1(x)
        x = self.conv3(x)
        x = self.conv4(x)
        x = self.pool2(x)
        x = self.conv5(x)
        x = self.conv6(x)
        x = self.conv7(x)
        x = self.pool3(x)
        x = self.conv8(x)
        x = self.conv9(x)
        x = self.conv10(x)
        x = self.ups1(x)
        x = self.conv11(x)
        x = self.conv12(x)
        x = self.conv13(x)
        x = self.ups2(x)
        x = self.conv14(x)
        x = self.conv15(x)
        x = self.ups3(x)
        x = self.conv16(x)
        x = self.conv17(x)
        x = self.conv18(x)
        return x

    def _init_weights(self):
        for module in self.modules():
            if isinstance(module, nn.Conv2d):
                nn.init.uniform_(module.weight, -0.05, 0.05)
                if module.bias is not None:
                    nn.init.constant_(module.bias, 0)
            elif isinstance(module, nn.BatchNorm2d):
                nn.init.constant_(module.weight, 1)
                nn.init.constant_(module.bias, 0)


# ============================================================================
# COURT REFERENCE GEOMETRY
# ============================================================================

class CourtReference:
    """Tennis court geometry reference model"""
    def __init__(self):
        # Court line coordinates (in reference space)
        self.baseline_top = ((286, 561), (1379, 561))
        self.baseline_bottom = ((286, 2935), (1379, 2935))
        self.net = ((286, 1748), (1379, 1748))
        self.left_court_line = ((286, 561), (286, 2935))
        self.right_court_line = ((1379, 561), (1379, 2935))
        self.left_inner_line = ((423, 561), (423, 2935))
        self.right_inner_line = ((1242, 561), (1242, 2935))
        self.middle_line = ((832, 1110), (832, 2386))
        self.top_inner_line = ((423, 1110), (1242, 1110))
        self.bottom_inner_line = ((423, 2386), (1242, 2386))

        self.key_points = [*self.baseline_top, *self.baseline_bottom,
                          *self.left_inner_line, *self.right_inner_line,
                          *self.top_inner_line, *self.bottom_inner_line,
                          *self.middle_line]

        # Court configurations for homography
        self.court_conf = {
            1: [*self.baseline_top, *self.baseline_bottom],
            2: [self.left_inner_line[0], self.right_inner_line[0],
                self.left_inner_line[1], self.right_inner_line[1]],
            3: [self.left_inner_line[0], self.right_court_line[0],
                self.left_inner_line[1], self.right_court_line[1]],
            4: [self.left_court_line[0], self.right_inner_line[0],
                self.left_court_line[1], self.right_inner_line[1]],
            5: [*self.top_inner_line, *self.bottom_inner_line],
            6: [*self.top_inner_line, self.left_inner_line[1], self.right_inner_line[1]],
            7: [self.left_inner_line[0], self.right_inner_line[0], *self.bottom_inner_line],
            8: [self.right_inner_line[0], self.right_court_line[0],
                self.right_inner_line[1], self.right_court_line[1]],
            9: [self.left_court_line[0], self.left_inner_line[0],
                self.left_court_line[1], self.left_inner_line[1]],
            10: [self.top_inner_line[0], self.middle_line[0],
                 self.bottom_inner_line[0], self.middle_line[1]],
            11: [self.middle_line[0], self.top_inner_line[1],
                 self.middle_line[1], self.bottom_inner_line[1]],
            12: [*self.bottom_inner_line, self.left_inner_line[1], self.right_inner_line[1]]
        }

        # Real-world dimensions (meters)
        self.COURT_LENGTH_M = 23.77  # Full court length
        self.COURT_WIDTH_M = 10.97   # Doubles width
        self.SINGLES_WIDTH_M = 8.23  # Singles width
        self.SERVICE_LINE_DIST_M = 6.40  # Service line to net

        # Reference dimensions (pixels)
        self.court_width = 1117
        self.court_height = 2408
        self.top_bottom_border = 549
        self.right_left_border = 274


# ============================================================================
# BALL DETECTOR
# ============================================================================

class BallDetector:
    """TrackNet-based ball detection"""
    def __init__(self, path_model=None, device='cuda'):
        self.model = BallTrackerNet(input_channels=9, out_channels=256)
        self.device = device
        if path_model and os.path.exists(path_model):
            self.model.load_state_dict(torch.load(path_model, map_location=device))
            self.model = self.model.to(device)
            self.model.eval()
            self.enabled = True
            print(f"Ball detector loaded from {path_model}")
        else:
            self.enabled = False
            print("Ball detector model not found - ball tracking disabled")
        self.width = 640
        self.height = 360

    def infer_model(self, frames):
        """Track ball through video frames"""
        if not self.enabled:
            return [(None, None)] * len(frames)

        ball_track = [(None, None)] * 2
        prev_pred = [None, None]

        for num in tqdm(range(2, len(frames)), desc="Ball tracking"):
            img = cv2.resize(frames[num], (self.width, self.height))
            img_prev = cv2.resize(frames[num-1], (self.width, self.height))
            img_preprev = cv2.resize(frames[num-2], (self.width, self.height))
            imgs = np.concatenate((img, img_prev, img_preprev), axis=2)
            imgs = imgs.astype(np.float32) / 255.0
            imgs = np.rollaxis(imgs, 2, 0)
            inp = np.expand_dims(imgs, axis=0)

            with torch.no_grad():
                out = self.model(torch.from_numpy(inp).float().to(self.device))
            output = out.argmax(dim=1).detach().cpu().numpy()
            x_pred, y_pred = self.postprocess(output, prev_pred)
            prev_pred = [x_pred, y_pred]
            ball_track.append((x_pred, y_pred))

        return ball_track

    def postprocess(self, feature_map, prev_pred, scale=2, max_dist=80):
        """Extract ball position from heatmap"""
        feature_map = (feature_map * 255).reshape((self.height, self.width)).astype(np.uint8)
        _, heatmap = cv2.threshold(feature_map, 127, 255, cv2.THRESH_BINARY)
        circles = cv2.HoughCircles(heatmap, cv2.HOUGH_GRADIENT, dp=1, minDist=1,
                                   param1=50, param2=2, minRadius=2, maxRadius=7)
        x, y = None, None
        if circles is not None:
            if prev_pred[0]:
                for i in range(len(circles[0])):
                    x_temp = circles[0][i][0] * scale
                    y_temp = circles[0][i][1] * scale
                    dist = distance.euclidean((x_temp, y_temp), prev_pred)
                    if dist < max_dist:
                        x, y = x_temp, y_temp
                        break
            else:
                x = circles[0][0][0] * scale
                y = circles[0][0][1] * scale
        return x, y


# ============================================================================
# COURT DETECTOR
# ============================================================================

class CourtDetector:
    """14-point court keypoint detection with manual calibration support"""
    def __init__(self, path_model=None, device='cuda'):
        self.model = BallTrackerNet(input_channels=3, out_channels=15)
        self.device = device
        self.court_ref = CourtReference()
        self.refer_kps = np.array(self.court_ref.key_points, dtype=np.float32).reshape((-1, 1, 2))

        # Manual calibration support
        self.manual_calibration = None
        self.manual_homography = None

        # Build court configuration indices
        self.court_conf_ind = {}
        for i in range(len(self.court_ref.court_conf)):
            conf = self.court_ref.court_conf[i+1]
            inds = []
            for j in range(4):
                inds.append(self.court_ref.key_points.index(conf[j]))
            self.court_conf_ind[i+1] = inds

        if path_model and os.path.exists(path_model):
            self.model.load_state_dict(torch.load(path_model, map_location=device))
            self.model = self.model.to(device)
            self.model.eval()
            self.enabled = True
            print(f"Court detector loaded from {path_model}")
        else:
            self.enabled = False
            print("Court detector model not found - court detection disabled")

    def load_manual_calibration(self, calibration_path):
        """Load manual court calibration from JSON file"""
        if not os.path.exists(calibration_path):
            print(f"Manual calibration file not found: {calibration_path}")
            return False

        with open(calibration_path, 'r') as f:
            self.manual_calibration = json.load(f)

        self.manual_homography = np.array(self.manual_calibration['homography'])
        print(f"Manual court calibration loaded from {calibration_path}")
        print(f"  Mode: {self.manual_calibration['mode']}")
        print(f"  Court: {self.manual_calibration['court_dimensions']['width']:.2f}m x {self.manual_calibration['court_dimensions']['length']:.2f}m")
        print(f"  Validation error: {self.manual_calibration['validation']['avg_error_meters']:.4f}m")
        return True

    def infer_model(self, frames):
        """Detect court keypoints and compute homography"""
        # If manual calibration is loaded, use it for all frames
        if self.manual_homography is not None:
            print(f"Using manual calibration for all {len(frames)} frames")
            return [self.manual_homography] * len(frames), [None] * len(frames)

        if not self.enabled:
            return [None] * len(frames), [None] * len(frames)

        output_width = 640
        output_height = 360
        scale = 2

        kps_res = []
        matrices_res = []

        for image in tqdm(frames, desc="Court detection"):
            img = cv2.resize(image, (output_width, output_height))
            inp = (img.astype(np.float32) / 255.)
            inp = torch.tensor(np.rollaxis(inp, 2, 0))
            inp = inp.unsqueeze(0)

            with torch.no_grad():
                out = self.model(inp.float().to(self.device))[0]
            pred = torch.sigmoid(out).detach().cpu().numpy()

            points = []
            for kps_num in range(14):
                heatmap = (pred[kps_num] * 255).astype(np.uint8)
                _, heatmap = cv2.threshold(heatmap, 170, 255, cv2.THRESH_BINARY)
                circles = cv2.HoughCircles(heatmap, cv2.HOUGH_GRADIENT, dp=1, minDist=20,
                                           param1=50, param2=2, minRadius=10, maxRadius=25)
                if circles is not None:
                    x_pred = circles[0][0][0] * scale
                    y_pred = circles[0][0][1] * scale
                    points.append((x_pred, y_pred))
                else:
                    points.append(None)

            matrix_trans = self.get_trans_matrix(points)
            kps = None
            if matrix_trans is not None:
                kps = cv2.perspectiveTransform(self.refer_kps, matrix_trans)
                matrix_trans = cv2.invert(matrix_trans)[1]
            kps_res.append(kps)
            matrices_res.append(matrix_trans)

        return matrices_res, kps_res

    def get_trans_matrix(self, points):
        """Compute best homography matrix from detected keypoints"""
        matrix_trans = None
        dist_max = np.inf

        for conf_ind in range(1, 13):
            conf = self.court_ref.court_conf[conf_ind]
            inds = self.court_conf_ind[conf_ind]
            inters = [points[inds[0]], points[inds[1]], points[inds[2]], points[inds[3]]]

            if None not in inters:
                matrix, _ = cv2.findHomography(np.float32(conf), np.float32(inters), method=0)
                if matrix is not None:
                    trans_kps = cv2.perspectiveTransform(self.refer_kps, matrix).squeeze(1)
                    dists = []
                    for i in range(12):
                        if i not in inds and points[i] is not None:
                            dists.append(distance.euclidean(points[i], trans_kps[i]))
                    if dists:
                        dist_median = np.mean(dists)
                        if dist_median < dist_max:
                            matrix_trans = matrix
                            dist_max = dist_median
        return matrix_trans

    def pixel_to_court_coords(self, pixel_pos, homography_matrix):
        """Convert pixel position to real-world court coordinates (meters)"""
        if homography_matrix is None or pixel_pos[0] is None:
            return None, None

        point = np.array([[pixel_pos]], dtype=np.float32)
        court_pos = cv2.perspectiveTransform(point, homography_matrix)[0][0]

        # Manual calibration outputs directly in meters
        if self.manual_calibration is not None:
            return float(court_pos[0]), float(court_pos[1])

        # NN model outputs to reference court pixel space - convert to meters
        x_meters = (court_pos[0] - self.court_ref.right_left_border) / self.court_ref.court_width * self.court_ref.COURT_WIDTH_M
        y_meters = (court_pos[1] - self.court_ref.top_bottom_border) / self.court_ref.court_height * self.court_ref.COURT_LENGTH_M

        return x_meters, y_meters

    def is_in_court(self, x_meters, y_meters, use_singles=True, margin=0.3):
        """Check if position is within court bounds"""
        if x_meters is None or y_meters is None:
            return None

        # Manual calibration uses origin at baseline corner (0,0 to width,length)
        if self.manual_calibration is not None:
            court_width = self.manual_calibration['court_dimensions']['width']
            court_length = self.manual_calibration['court_dimensions']['length']
            x_in = -margin <= x_meters <= court_width + margin
            y_in = -margin <= y_meters <= court_length + margin
            return x_in and y_in

        # NN calibration uses centered coordinates (-width/2 to +width/2)
        width = self.court_ref.SINGLES_WIDTH_M if use_singles else self.court_ref.COURT_WIDTH_M
        x_in = -width/2 - margin <= x_meters <= width/2 + margin
        y_in = -margin <= y_meters <= self.court_ref.COURT_LENGTH_M + margin

        return x_in and y_in


# ============================================================================
# BOUNCE DETECTOR
# ============================================================================

class BounceDetector:
    """CatBoost-based bounce detection from ball trajectory"""
    def __init__(self, path_model=None):
        self.threshold = 0.45
        self.enabled = False

        if path_model and os.path.exists(path_model):
            try:
                import catboost as ctb
                self.model = ctb.CatBoostRegressor()
                self.model.load_model(path_model)
                self.enabled = True
                print(f"Bounce detector loaded from {path_model}")
            except ImportError:
                print("CatBoost not installed - bounce detection disabled")
        else:
            print("Bounce detector model not found - bounce detection disabled")

    def predict(self, x_ball, y_ball, smooth=True):
        """Predict bounce frames from ball trajectory"""
        if not self.enabled:
            return set()

        if smooth:
            x_ball, y_ball = self.smooth_predictions(x_ball.copy(), y_ball.copy())

        features, num_frames = self.prepare_features(x_ball, y_ball)
        if features is None or len(features) == 0:
            return set()

        preds = self.model.predict(features)
        ind_bounce = np.where(preds > self.threshold)[0]

        if len(ind_bounce) > 0:
            ind_bounce = self.postprocess(ind_bounce, preds)

        frames_bounce = [num_frames[x] for x in ind_bounce]
        return set(frames_bounce)

    def prepare_features(self, x_ball, y_ball):
        """Prepare trajectory features for bounce prediction"""
        import pandas as pd

        labels = pd.DataFrame({
            'frame': range(len(x_ball)),
            'x-coordinate': x_ball,
            'y-coordinate': y_ball
        })

        num = 3
        eps = 1e-15
        for i in range(1, num):
            labels[f'x_lag_{i}'] = labels['x-coordinate'].shift(i)
            labels[f'x_lag_inv_{i}'] = labels['x-coordinate'].shift(-i)
            labels[f'y_lag_{i}'] = labels['y-coordinate'].shift(i)
            labels[f'y_lag_inv_{i}'] = labels['y-coordinate'].shift(-i)
            labels[f'x_diff_{i}'] = abs(labels[f'x_lag_{i}'] - labels['x-coordinate'])
            labels[f'y_diff_{i}'] = labels[f'y_lag_{i}'] - labels['y-coordinate']
            labels[f'x_diff_inv_{i}'] = abs(labels[f'x_lag_inv_{i}'] - labels['x-coordinate'])
            labels[f'y_diff_inv_{i}'] = labels[f'y_lag_inv_{i}'] - labels['y-coordinate']
            labels[f'x_div_{i}'] = abs(labels[f'x_diff_{i}'] / (labels[f'x_diff_inv_{i}'] + eps))
            labels[f'y_div_{i}'] = labels[f'y_diff_{i}'] / (labels[f'y_diff_inv_{i}'] + eps)

        for i in range(1, num):
            labels = labels[labels[f'x_lag_{i}'].notna()]
            labels = labels[labels[f'x_lag_inv_{i}'].notna()]
        labels = labels[labels['x-coordinate'].notna()]

        if len(labels) == 0:
            return None, []

        colnames_x = [f'x_diff_{i}' for i in range(1, num)] + \
                     [f'x_diff_inv_{i}' for i in range(1, num)] + \
                     [f'x_div_{i}' for i in range(1, num)]
        colnames_y = [f'y_diff_{i}' for i in range(1, num)] + \
                     [f'y_diff_inv_{i}' for i in range(1, num)] + \
                     [f'y_div_{i}' for i in range(1, num)]
        colnames = colnames_x + colnames_y

        features = labels[colnames]
        return features, list(labels['frame'])

    def smooth_predictions(self, x_ball, y_ball):
        """Interpolate missing ball positions"""
        is_none = [int(x is None) for x in x_ball]
        interp = 5
        counter = 0

        for num in range(interp, len(x_ball)-1):
            if not x_ball[num] and sum(is_none[num-interp:num]) == 0 and counter < 3:
                x_ext, y_ext = self.extrapolate(x_ball[num-interp:num], y_ball[num-interp:num])
                x_ball[num] = x_ext
                y_ball[num] = y_ext
                is_none[num] = 0
                if x_ball[num+1]:
                    dist = distance.euclidean((x_ext, y_ext), (x_ball[num+1], y_ball[num+1]))
                    if dist > 80:
                        x_ball[num+1], y_ball[num+1], is_none[num+1] = None, None, 1
                counter += 1
            else:
                counter = 0
        return x_ball, y_ball

    def extrapolate(self, x_coords, y_coords):
        """Cubic spline extrapolation for missing positions"""
        xs = list(range(len(x_coords)))
        func_x = CubicSpline(xs, x_coords, bc_type='natural')
        x_ext = func_x(len(x_coords))
        func_y = CubicSpline(xs, y_coords, bc_type='natural')
        y_ext = func_y(len(y_coords))
        return float(x_ext), float(y_ext)

    def postprocess(self, ind_bounce, preds):
        """Filter consecutive bounce predictions"""
        ind_bounce_filtered = [ind_bounce[0]]
        for i in range(1, len(ind_bounce)):
            if (ind_bounce[i] - ind_bounce[i-1]) != 1:
                ind_bounce_filtered.append(ind_bounce[i])
            elif preds[ind_bounce[i]] > preds[ind_bounce[i-1]]:
                ind_bounce_filtered[-1] = ind_bounce[i]
        return ind_bounce_filtered


# ============================================================================
# POSE ANALYZER WITH BODY-RELATIVE NORMALIZATION
# ============================================================================

class PoseAnalyzer:
    """MediaPipe pose detection with body-relative normalization"""

    # MediaPipe landmark indices
    NOSE = 0
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28

    def __init__(self, model_path=None):
        """Initialize MediaPipe pose detector"""
        # Try to find model
        if model_path is None:
            possible_paths = [
                'pose_landmarker_heavy.task',
                'pose_landmarker_full.task',
                'pose_landmarker_lite.task',
                os.path.expanduser('~/.mediapipe/pose_landmarker_heavy.task'),
            ]
            for path in possible_paths:
                if os.path.exists(path):
                    model_path = path
                    break

        if model_path and os.path.exists(model_path):
            base_options = python.BaseOptions(model_asset_path=model_path)
            options = vision.PoseLandmarkerOptions(
                base_options=base_options,
                output_segmentation_masks=False,
                num_poses=2  # Detect up to 2 players
            )
            self.detector = vision.PoseLandmarker.create_from_options(options)
            self.enabled = True
            print(f"Pose detector loaded from {model_path}")
        else:
            self.enabled = False
            print("MediaPipe pose model not found - using fallback detection")
            print("Download from: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker")

    def detect(self, frame):
        """Detect poses in frame, return list of pose data"""
        if not self.enabled:
            return []

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        result = self.detector.detect(mp_image)

        poses = []
        for pose_landmarks in result.pose_landmarks:
            landmarks = {}
            for i, lm in enumerate(pose_landmarks):
                landmarks[i] = {
                    'x': lm.x,  # Normalized 0-1
                    'y': lm.y,
                    'z': lm.z,
                    'visibility': lm.visibility
                }
            poses.append(landmarks)

        return poses

    def get_body_scale(self, landmarks):
        """
        Calculate body scale reference (torso length) for normalization.
        This allows comparing movements across different camera distances/angles.
        """
        try:
            # Shoulder midpoint
            shoulder_mid_x = (landmarks[self.LEFT_SHOULDER]['x'] + landmarks[self.RIGHT_SHOULDER]['x']) / 2
            shoulder_mid_y = (landmarks[self.LEFT_SHOULDER]['y'] + landmarks[self.RIGHT_SHOULDER]['y']) / 2

            # Hip midpoint
            hip_mid_x = (landmarks[self.LEFT_HIP]['x'] + landmarks[self.RIGHT_HIP]['x']) / 2
            hip_mid_y = (landmarks[self.LEFT_HIP]['y'] + landmarks[self.RIGHT_HIP]['y']) / 2

            # Torso length (shoulder to hip)
            torso_length = math.sqrt(
                (shoulder_mid_x - hip_mid_x)**2 +
                (shoulder_mid_y - hip_mid_y)**2
            )

            # Also calculate shoulder width for validation
            shoulder_width = math.sqrt(
                (landmarks[self.LEFT_SHOULDER]['x'] - landmarks[self.RIGHT_SHOULDER]['x'])**2 +
                (landmarks[self.LEFT_SHOULDER]['y'] - landmarks[self.RIGHT_SHOULDER]['y'])**2
            )

            return {
                'torso_length': torso_length,
                'shoulder_width': shoulder_width,
                'torso_to_shoulder_ratio': torso_length / shoulder_width if shoulder_width > 0 else 0
            }
        except (KeyError, ZeroDivisionError):
            return None

    def detect_camera_angle(self, landmarks):
        """
        Estimate camera viewing angle from shoulder positions.
        Returns angle in degrees: 0 = behind, 90 = side view, 180 = front
        """
        try:
            left_shoulder = landmarks[self.LEFT_SHOULDER]
            right_shoulder = landmarks[self.RIGHT_SHOULDER]

            dx = right_shoulder['x'] - left_shoulder['x']
            dy = right_shoulder['y'] - left_shoulder['y']

            # Angle of shoulder line
            angle_rad = math.atan2(dy, dx)
            angle_deg = abs(math.degrees(angle_rad))

            # Shoulder width in image
            shoulder_width = math.sqrt(dx**2 + dy**2)

            # Depth difference (z) can indicate rotation
            dz = abs(right_shoulder['z'] - left_shoulder['z'])

            # Classify view type
            if shoulder_width < 0.05:
                view_type = 'extreme_side'  # Shoulders almost overlapping = pure side view
            elif dz > 0.1:
                view_type = 'angled'
            elif abs(angle_deg) < 20:
                view_type = 'front_or_back'
            else:
                view_type = 'side'

            return {
                'shoulder_angle_deg': angle_deg,
                'shoulder_width_norm': shoulder_width,
                'depth_difference': dz,
                'view_type': view_type,
                'suitable_for_analysis': view_type not in ['extreme_side']
            }
        except KeyError:
            return None

    def calculate_metrics(self, landmarks, prev_landmarks, dt, body_scale):
        """
        Calculate biomechanical metrics with body-relative normalization.

        Returns metrics normalized to body proportions (torso-lengths per second)
        """
        if body_scale is None or body_scale['torso_length'] < 0.01:
            return None

        torso = body_scale['torso_length']
        metrics = {}

        # Wrist velocities (body-relative: torso-lengths per second)
        for side, wrist_idx in [('left', self.LEFT_WRIST), ('right', self.RIGHT_WRIST)]:
            if prev_landmarks:
                dx = landmarks[wrist_idx]['x'] - prev_landmarks[wrist_idx]['x']
                dy = landmarks[wrist_idx]['y'] - prev_landmarks[wrist_idx]['y']
                pixel_velocity = math.sqrt(dx**2 + dy**2) / dt
                metrics[f'{side}_wrist_velocity_raw'] = pixel_velocity
                metrics[f'{side}_wrist_velocity_normalized'] = pixel_velocity / torso  # Torso-lengths/sec
            else:
                metrics[f'{side}_wrist_velocity_raw'] = 0
                metrics[f'{side}_wrist_velocity_normalized'] = 0

        # Peak velocity (max of both wrists)
        metrics['peak_velocity_normalized'] = max(
            metrics['left_wrist_velocity_normalized'],
            metrics['right_wrist_velocity_normalized']
        )

        # Elbow angles
        for side, shoulder, elbow, wrist in [
            ('left', self.LEFT_SHOULDER, self.LEFT_ELBOW, self.LEFT_WRIST),
            ('right', self.RIGHT_SHOULDER, self.RIGHT_ELBOW, self.RIGHT_WRIST)
        ]:
            angle = self._calculate_angle(
                landmarks[shoulder], landmarks[elbow], landmarks[wrist]
            )
            metrics[f'{side}_elbow_angle'] = angle

        # Hip-shoulder separation (rotation)
        hip_angle = math.degrees(math.atan2(
            landmarks[self.RIGHT_HIP]['y'] - landmarks[self.LEFT_HIP]['y'],
            landmarks[self.RIGHT_HIP]['x'] - landmarks[self.LEFT_HIP]['x']
        ))
        shoulder_angle = math.degrees(math.atan2(
            landmarks[self.RIGHT_SHOULDER]['y'] - landmarks[self.LEFT_SHOULDER]['y'],
            landmarks[self.RIGHT_SHOULDER]['x'] - landmarks[self.LEFT_SHOULDER]['x']
        ))
        metrics['hip_shoulder_separation'] = abs(shoulder_angle - hip_angle)

        # Knee bend (average of both knees)
        left_knee_angle = self._calculate_angle(
            landmarks[self.LEFT_HIP], landmarks[self.LEFT_KNEE], landmarks[self.LEFT_ANKLE]
        )
        right_knee_angle = self._calculate_angle(
            landmarks[self.RIGHT_HIP], landmarks[self.RIGHT_KNEE], landmarks[self.RIGHT_ANKLE]
        )
        metrics['knee_bend'] = (left_knee_angle + right_knee_angle) / 2

        return metrics

    def _calculate_angle(self, p1, p2, p3):
        """Calculate angle at p2 given three points"""
        try:
            v1 = np.array([p1['x'] - p2['x'], p1['y'] - p2['y']])
            v2 = np.array([p3['x'] - p2['x'], p3['y'] - p2['y']])

            cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-10)
            cos_angle = np.clip(cos_angle, -1, 1)
            angle = np.degrees(np.arccos(cos_angle))
            return angle
        except:
            return 0


# ============================================================================
# SHOT SEGMENTER
# ============================================================================

class ShotSegmenter:
    """Segment video into individual shots based on ball trajectory"""

    def __init__(self, fps):
        self.fps = fps
        self.min_shot_frames = int(fps * 0.3)  # Minimum 0.3 seconds per shot
        self.max_shot_frames = int(fps * 3.0)  # Maximum 3 seconds per shot

    def segment_shots(self, ball_track, bounce_frames, homography_matrices, court_detector):
        """
        Segment ball trajectory into individual shots.

        A shot is defined as:
        - Ball moving in one direction
        - Ends at bounce or direction change
        """
        shots = []
        current_shot_start = None
        prev_valid_pos = None
        prev_direction = None

        for frame_idx, (x, y) in enumerate(ball_track):
            if x is None:
                continue

            if prev_valid_pos is not None:
                # Calculate direction
                dx = x - prev_valid_pos[0]
                dy = y - prev_valid_pos[1]

                if abs(dx) > 5 or abs(dy) > 5:  # Significant movement
                    current_direction = math.atan2(dy, dx)

                    # Check for direction change (new shot)
                    if prev_direction is not None:
                        angle_change = abs(current_direction - prev_direction)
                        if angle_change > math.pi:
                            angle_change = 2 * math.pi - angle_change

                        # Direction reversal indicates new shot
                        if angle_change > math.pi / 2:  # >90 degree change
                            if current_shot_start is not None:
                                shot = self._create_shot(
                                    current_shot_start, frame_idx - 1,
                                    ball_track, bounce_frames,
                                    homography_matrices, court_detector
                                )
                                if shot:
                                    shots.append(shot)
                            current_shot_start = frame_idx

                    if current_shot_start is None:
                        current_shot_start = frame_idx

                    prev_direction = current_direction

            # Check if this frame is a bounce
            if frame_idx in bounce_frames:
                if current_shot_start is not None:
                    shot = self._create_shot(
                        current_shot_start, frame_idx,
                        ball_track, bounce_frames,
                        homography_matrices, court_detector
                    )
                    if shot:
                        shots.append(shot)
                    current_shot_start = None
                    prev_direction = None

            prev_valid_pos = (x, y)

        # Handle last shot
        if current_shot_start is not None and len(ball_track) - current_shot_start > self.min_shot_frames:
            shot = self._create_shot(
                current_shot_start, len(ball_track) - 1,
                ball_track, bounce_frames,
                homography_matrices, court_detector
            )
            if shot:
                shots.append(shot)

        return shots

    def _create_shot(self, start_frame, end_frame, ball_track, bounce_frames,
                     homography_matrices, court_detector):
        """Create shot data structure"""
        if end_frame - start_frame < self.min_shot_frames:
            return None

        # Find contact point (highest velocity point in first third of shot)
        contact_frame = start_frame
        max_vel = 0
        search_end = start_frame + (end_frame - start_frame) // 3

        for i in range(start_frame + 1, min(search_end, len(ball_track))):
            if ball_track[i][0] is not None and ball_track[i-1][0] is not None:
                dx = ball_track[i][0] - ball_track[i-1][0]
                dy = ball_track[i][1] - ball_track[i-1][1]
                vel = math.sqrt(dx**2 + dy**2)
                if vel > max_vel:
                    max_vel = vel
                    contact_frame = i

        # Find landing position (bounce or last known position)
        landing_frame = end_frame
        landing_pos = ball_track[end_frame] if end_frame < len(ball_track) else (None, None)

        # Check if any bounce in this shot
        shot_bounces = [b for b in bounce_frames if start_frame <= b <= end_frame]
        if shot_bounces:
            landing_frame = shot_bounces[-1]  # Last bounce
            landing_pos = ball_track[landing_frame]

        # Determine if shot landed in court
        outcome = 'unknown'
        landing_court_pos = (None, None)

        if landing_pos[0] is not None and homography_matrices[landing_frame] is not None:
            landing_court_pos = court_detector.pixel_to_court_coords(
                landing_pos, homography_matrices[landing_frame]
            )
            if landing_court_pos[0] is not None:
                is_in = court_detector.is_in_court(*landing_court_pos)
                outcome = 'in' if is_in else 'out'

        # Calculate ball speed
        ball_speed_mps = self._calculate_ball_speed(
            ball_track, contact_frame, min(contact_frame + 5, end_frame),
            homography_matrices, court_detector
        )

        return {
            'start_frame': start_frame,
            'end_frame': end_frame,
            'contact_frame': contact_frame,
            'landing_frame': landing_frame,
            'landing_position_pixels': landing_pos,
            'landing_position_meters': landing_court_pos,
            'outcome': outcome,
            'ball_speed_mps': ball_speed_mps,
            'ball_speed_mph': ball_speed_mps * 2.237 if ball_speed_mps else None,
            'duration_frames': end_frame - start_frame,
            'duration_seconds': (end_frame - start_frame) / self.fps
        }

    def _calculate_ball_speed(self, ball_track, start_frame, end_frame,
                              homography_matrices, court_detector):
        """Calculate average ball speed in m/s using court coordinates"""
        valid_positions = []

        for i in range(start_frame, min(end_frame + 1, len(ball_track))):
            if ball_track[i][0] is not None and homography_matrices[i] is not None:
                court_pos = court_detector.pixel_to_court_coords(
                    ball_track[i], homography_matrices[i]
                )
                if court_pos[0] is not None:
                    valid_positions.append((i, court_pos))

        if len(valid_positions) < 2:
            return None

        # Calculate average speed
        total_distance = 0
        total_frames = 0

        for i in range(1, len(valid_positions)):
            frame_diff = valid_positions[i][0] - valid_positions[i-1][0]
            dx = valid_positions[i][1][0] - valid_positions[i-1][1][0]
            dy = valid_positions[i][1][1] - valid_positions[i-1][1][1]
            dist = math.sqrt(dx**2 + dy**2)
            total_distance += dist
            total_frames += frame_diff

        if total_frames == 0:
            return None

        time_seconds = total_frames / self.fps
        return total_distance / time_seconds


# ============================================================================
# STROKE CLASSIFIER
# ============================================================================

class StrokeClassifier:
    """Classify stroke type based on pose metrics"""

    def classify(self, pose_metrics, ball_direction=None):
        """
        Classify stroke type from pose and ball data.

        Returns: 'Forehand', 'Backhand', 'Serve', 'Volley', 'Overhead', 'Unknown'
        """
        if pose_metrics is None:
            return 'Unknown'

        # Get dominant arm velocity
        left_vel = pose_metrics.get('left_wrist_velocity_normalized', 0)
        right_vel = pose_metrics.get('right_wrist_velocity_normalized', 0)

        dominant_side = 'right' if right_vel > left_vel else 'left'
        dominant_vel = max(left_vel, right_vel)

        # Get hip-shoulder separation (rotation indicator)
        rotation = pose_metrics.get('hip_shoulder_separation', 0)

        # Get elbow angle at contact
        elbow_angle = pose_metrics.get(f'{dominant_side}_elbow_angle', 90)

        # Get vertical position indicators
        # (would need wrist Y position relative to shoulder)

        # Simple classification rules
        if dominant_vel < 0.5:  # Below threshold - not a real stroke
            return 'Unknown'

        # High arm position suggests serve or overhead
        # For now, use rotation to distinguish forehand/backhand
        if rotation > 20:
            return 'Forehand' if dominant_side == 'right' else 'Backhand'
        elif rotation < -20:
            return 'Backhand' if dominant_side == 'right' else 'Forehand'
        else:
            return 'Groundstroke'


# ============================================================================
# COMPREHENSIVE CALIBRATION SYSTEM
# ============================================================================

class ComprehensiveCalibrator:
    """Main calibration system integrating all components"""

    def __init__(self,
                 ball_model_path=None,
                 court_model_path=None,
                 bounce_model_path=None,
                 pose_model_path=None,
                 court_calibration_path=None,
                 device='cuda' if torch.cuda.is_available() else 'cpu'):

        print(f"Initializing calibration system on {device}...")
        print("=" * 60)

        self.device = device

        # Initialize components
        self.ball_detector = BallDetector(ball_model_path, device)
        self.court_detector = CourtDetector(court_model_path, device)
        self.bounce_detector = BounceDetector(bounce_model_path)
        self.pose_analyzer = PoseAnalyzer(pose_model_path)
        self.stroke_classifier = StrokeClassifier()

        # Load manual court calibration if provided
        if court_calibration_path:
            self.court_detector.load_manual_calibration(court_calibration_path)

        print("=" * 60)

    def calibrate_video(self, video_path, output_path=None,
                        sample_rate=1, max_frames=None):
        """
        Run comprehensive calibration on a video.

        Args:
            video_path: Path to video file
            output_path: Path for output JSON (optional)
            sample_rate: Process every Nth frame for pose (1 = all frames)
            max_frames: Maximum frames to process (None = all)
        """
        print(f"\nProcessing: {video_path}")
        print("-" * 60)

        # Read video
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        print(f"Video: {width}x{height} @ {fps:.1f}fps, {total_frames} frames")

        if width != 1280 or height != 720:
            print(f"WARNING: Expected 1280x720 for optimal court detection, got {width}x{height}")

        # Read all frames
        frames = []
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(frame)
            if max_frames and len(frames) >= max_frames:
                break
        cap.release()

        print(f"Loaded {len(frames)} frames")

        # Initialize shot segmenter
        shot_segmenter = ShotSegmenter(fps)

        # Step 1: Ball tracking
        print("\n[1/4] Ball tracking...")
        ball_track = self.ball_detector.infer_model(frames)
        ball_detections = sum(1 for x, y in ball_track if x is not None)
        print(f"  Ball detected in {ball_detections}/{len(frames)} frames ({100*ball_detections/len(frames):.1f}%)")

        # Step 2: Court detection
        print("\n[2/4] Court detection...")
        homography_matrices, court_keypoints = self.court_detector.infer_model(frames)
        court_detections = sum(1 for m in homography_matrices if m is not None)
        using_manual_calibration = self.court_detector.manual_calibration is not None
        if using_manual_calibration:
            print(f"  Using manual calibration for all {len(frames)} frames (100.0%)")
        else:
            print(f"  Court detected in {court_detections}/{len(frames)} frames ({100*court_detections/len(frames):.1f}%)")

        # Step 3: Bounce detection
        print("\n[3/4] Bounce detection...")
        x_ball = [pos[0] for pos in ball_track]
        y_ball = [pos[1] for pos in ball_track]
        bounce_frames = self.bounce_detector.predict(x_ball, y_ball)
        print(f"  Detected {len(bounce_frames)} bounces")

        # Step 4: Shot segmentation
        print("\n[4/4] Shot segmentation & pose analysis...")
        shots = shot_segmenter.segment_shots(
            ball_track, bounce_frames, homography_matrices, self.court_detector
        )
        print(f"  Segmented {len(shots)} shots")

        # Analyze each shot with pose data
        calibration_data = []
        camera_angles = []
        body_scales = []

        for shot_idx, shot in enumerate(tqdm(shots, desc="Analyzing shots")):
            # Get pose at contact frame
            contact_frame = shot['contact_frame']
            if contact_frame >= len(frames):
                continue

            poses = self.pose_analyzer.detect(frames[contact_frame])
            if not poses:
                continue

            # Use first detected pose (primary player)
            landmarks = poses[0]

            # Get body scale for normalization
            body_scale = self.pose_analyzer.get_body_scale(landmarks)
            if body_scale:
                body_scales.append(body_scale)

            # Detect camera angle
            camera_angle = self.pose_analyzer.detect_camera_angle(landmarks)
            if camera_angle:
                camera_angles.append(camera_angle)

                # Skip shots with unsuitable camera angles
                if not camera_angle.get('suitable_for_analysis', True):
                    continue

            # Get previous frame pose for velocity calculation
            prev_landmarks = None
            if contact_frame > 0:
                prev_poses = self.pose_analyzer.detect(frames[contact_frame - 1])
                if prev_poses:
                    prev_landmarks = prev_poses[0]

            # Calculate metrics
            dt = 1.0 / fps
            metrics = self.pose_analyzer.calculate_metrics(
                landmarks, prev_landmarks, dt, body_scale
            )

            if metrics is None:
                continue

            # Classify stroke type
            stroke_type = self.stroke_classifier.classify(metrics)

            # Compile shot data
            shot_data = {
                'shot_index': shot_idx,
                'stroke_type': stroke_type,
                'outcome': shot['outcome'],
                'contact_frame': contact_frame,
                'duration_seconds': shot['duration_seconds'],

                # Ball data
                'ball_speed_mps': shot['ball_speed_mps'],
                'ball_speed_mph': shot['ball_speed_mph'],
                'landing_position_meters': shot['landing_position_meters'],

                # Pose metrics (body-relative)
                'velocity_normalized': metrics['peak_velocity_normalized'],
                'velocity_raw': max(
                    metrics['left_wrist_velocity_raw'],
                    metrics['right_wrist_velocity_raw']
                ),

                # Biomechanical
                'left_elbow_angle': metrics['left_elbow_angle'],
                'right_elbow_angle': metrics['right_elbow_angle'],
                'hip_shoulder_separation': metrics['hip_shoulder_separation'],
                'knee_bend': metrics['knee_bend'],

                # Camera info
                'camera_view_type': camera_angle['view_type'] if camera_angle else 'unknown',
                'body_scale_torso': body_scale['torso_length'] if body_scale else None,
            }

            calibration_data.append(shot_data)

        # Generate summary statistics
        summary = self._generate_summary(calibration_data, camera_angles, body_scales, fps)

        # Create output
        result = {
            'timestamp': datetime.now().isoformat(),
            'video_path': video_path,
            'video_info': {
                'width': width,
                'height': height,
                'fps': fps,
                'total_frames': total_frames
            },
            'detection_stats': {
                'ball_detection_rate': ball_detections / len(frames),
                'court_detection_rate': court_detections / len(frames),
                'court_calibration_source': 'manual' if using_manual_calibration else 'automatic',
                'bounces_detected': len(bounce_frames),
                'shots_segmented': len(shots),
                'shots_analyzed': len(calibration_data)
            },
            'summary': summary,
            'shots': calibration_data
        }

        # Save output
        if output_path:
            with open(output_path, 'w') as f:
                json.dump(result, f, indent=2, default=str)
            print(f"\nResults saved to: {output_path}")

        # Print summary
        self._print_summary(result)

        return result

    def _generate_summary(self, shots, camera_angles, body_scales, fps):
        """Generate statistical summary of calibration data"""
        if not shots:
            return {'error': 'No shots analyzed'}

        # Filter to only successful shots (landed in)
        successful_shots = [s for s in shots if s['outcome'] == 'in']

        # Group by stroke type
        by_type = {}
        for shot in shots:
            stroke = shot['stroke_type']
            if stroke not in by_type:
                by_type[stroke] = []
            by_type[stroke].append(shot)

        def calc_stats(values):
            """Calculate percentile statistics"""
            values = [v for v in values if v is not None]
            if not values:
                return None
            arr = np.array(values)
            return {
                'count': len(arr),
                'min': float(np.min(arr)),
                'max': float(np.max(arr)),
                'mean': float(np.mean(arr)),
                'median': float(np.median(arr)),
                'std': float(np.std(arr)),
                'p10': float(np.percentile(arr, 10)),
                'p25': float(np.percentile(arr, 25)),
                'p75': float(np.percentile(arr, 75)),
                'p90': float(np.percentile(arr, 90))
            }

        summary = {
            'total_shots': len(shots),
            'successful_shots': len(successful_shots),
            'success_rate': len(successful_shots) / len(shots) if shots else 0,

            'stroke_distribution': {k: len(v) for k, v in by_type.items()},

            'outcome_distribution': {
                'in': len([s for s in shots if s['outcome'] == 'in']),
                'out': len([s for s in shots if s['outcome'] == 'out']),
                'unknown': len([s for s in shots if s['outcome'] == 'unknown'])
            },

            # All shots
            'all_shots': {
                'velocity_normalized': calc_stats([s['velocity_normalized'] for s in shots]),
                'ball_speed_mph': calc_stats([s['ball_speed_mph'] for s in shots]),
                'hip_shoulder_separation': calc_stats([s['hip_shoulder_separation'] for s in shots]),
                'knee_bend': calc_stats([s['knee_bend'] for s in shots])
            },

            # Only successful shots (key for calibration!)
            'successful_shots_only': {
                'velocity_normalized': calc_stats([s['velocity_normalized'] for s in successful_shots]),
                'ball_speed_mph': calc_stats([s['ball_speed_mph'] for s in successful_shots]),
                'hip_shoulder_separation': calc_stats([s['hip_shoulder_separation'] for s in successful_shots]),
                'knee_bend': calc_stats([s['knee_bend'] for s in successful_shots])
            },

            # By stroke type
            'by_stroke_type': {}
        }

        for stroke_type, stroke_shots in by_type.items():
            successful = [s for s in stroke_shots if s['outcome'] == 'in']
            summary['by_stroke_type'][stroke_type] = {
                'total': len(stroke_shots),
                'successful': len(successful),
                'velocity_normalized': calc_stats([s['velocity_normalized'] for s in successful]),
                'ball_speed_mph': calc_stats([s['ball_speed_mph'] for s in successful])
            }

        # Camera angle distribution
        if camera_angles:
            summary['camera_angles'] = {
                'view_types': {},
                'suitable_for_analysis': sum(1 for a in camera_angles if a.get('suitable_for_analysis', True))
            }
            for angle in camera_angles:
                vt = angle.get('view_type', 'unknown')
                summary['camera_angles']['view_types'][vt] = summary['camera_angles']['view_types'].get(vt, 0) + 1

        # Body scale consistency
        if body_scales:
            torso_lengths = [b['torso_length'] for b in body_scales]
            summary['body_scale_consistency'] = {
                'mean_torso_length': float(np.mean(torso_lengths)),
                'std_torso_length': float(np.std(torso_lengths)),
                'cv': float(np.std(torso_lengths) / np.mean(torso_lengths)) if np.mean(torso_lengths) > 0 else None
            }

        return summary

    def _print_summary(self, result):
        """Print human-readable summary"""
        print("\n" + "=" * 60)
        print("CALIBRATION SUMMARY")
        print("=" * 60)

        stats = result['detection_stats']
        print(f"\nDetection Rates:")
        print(f"  Ball tracking:  {100*stats['ball_detection_rate']:.1f}%")
        court_source = stats.get('court_calibration_source', 'automatic')
        if court_source == 'manual':
            print(f"  Court detection: 100.0% (manual calibration)")
        else:
            print(f"  Court detection: {100*stats['court_detection_rate']:.1f}%")
        print(f"  Bounces found:  {stats['bounces_detected']}")
        print(f"  Shots analyzed: {stats['shots_analyzed']}")

        summary = result['summary']
        print(f"\nShot Outcomes:")
        print(f"  Total shots:    {summary['total_shots']}")
        print(f"  Successful (in): {summary['successful_shots']} ({100*summary['success_rate']:.1f}%)")

        print(f"\nStroke Distribution:")
        for stroke, count in summary['stroke_distribution'].items():
            print(f"  {stroke}: {count}")

        if summary.get('successful_shots_only', {}).get('velocity_normalized'):
            vel = summary['successful_shots_only']['velocity_normalized']
            print(f"\nVelocity (normalized, successful shots only):")
            print(f"  Median: {vel['median']:.2f} torso-lengths/sec")
            print(f"  P25-P75: {vel['p25']:.2f} - {vel['p75']:.2f}")

        if summary.get('successful_shots_only', {}).get('ball_speed_mph'):
            speed = summary['successful_shots_only']['ball_speed_mph']
            print(f"\nBall Speed (successful shots only):")
            print(f"  Median: {speed['median']:.1f} mph")
            print(f"  P25-P75: {speed['p25']:.1f} - {speed['p75']:.1f} mph")

        print("\n" + "=" * 60)


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Comprehensive Tennis Calibration')
    parser.add_argument('--video', type=str, required=True, help='Path to video file')
    parser.add_argument('--output', type=str, help='Output JSON path')
    parser.add_argument('--ball-model', type=str,
                        default='../model_weights/model_best.pt',
                        help='Path to ball detection model')
    parser.add_argument('--court-model', type=str,
                        default='../model_weights/model_tennis_court_det.pt',
                        help='Path to court detection model')
    parser.add_argument('--court-calibration', type=str,
                        help='Path to manual court calibration JSON (from calibrate_court_manual.py)')
    parser.add_argument('--bounce-model', type=str,
                        default='ctb_regr_bounce.cbm',
                        help='Path to bounce detection model')
    parser.add_argument('--pose-model', type=str, help='Path to MediaPipe pose model')
    parser.add_argument('--max-frames', type=int, help='Maximum frames to process')
    parser.add_argument('--device', type=str, default='cuda' if torch.cuda.is_available() else 'cpu')

    args = parser.parse_args()

    # Resolve relative paths
    script_dir = os.path.dirname(os.path.abspath(__file__))

    def resolve_path(path):
        if path and not os.path.isabs(path):
            return os.path.join(script_dir, path)
        return path

    ball_model = resolve_path(args.ball_model)
    court_model = resolve_path(args.court_model)
    bounce_model = resolve_path(args.bounce_model)
    court_calibration = resolve_path(args.court_calibration) if args.court_calibration else None

    # Initialize calibrator
    calibrator = ComprehensiveCalibrator(
        ball_model_path=ball_model,
        court_model_path=court_model,
        bounce_model_path=bounce_model,
        pose_model_path=args.pose_model,
        court_calibration_path=court_calibration,
        device=args.device
    )

    # Generate output path if not specified
    output_path = args.output
    if not output_path:
        video_name = os.path.splitext(os.path.basename(args.video))[0]
        output_path = f"{video_name}_calibration_comprehensive.json"

    # Run calibration
    calibrator.calibrate_video(
        args.video,
        output_path=output_path,
        max_frames=args.max_frames
    )


if __name__ == '__main__':
    main()
