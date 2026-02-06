#!/usr/bin/env python3
"""
Robust Court Detection for Amateur Tennis Footage
==================================================

Multiple detection strategies:
1. Neural network (for broadcast footage)
2. Classical CV with Hough line detection (for any footage with visible lines)
3. Manual 4-point calibration (fallback)

Works with:
- Phone recordings from behind baseline
- Side-angle footage
- Any court color (hard, clay, grass)
- Varying lighting conditions
"""

import cv2
import numpy as np
from collections import defaultdict
import math
import json
import os


class CourtGeometry:
    """Standard tennis court dimensions in meters"""
    # Full court
    COURT_LENGTH = 23.77  # baseline to baseline
    COURT_WIDTH_DOUBLES = 10.97
    COURT_WIDTH_SINGLES = 8.23

    # Service box
    SERVICE_LINE_DIST = 6.40  # from net
    SERVICE_BOX_WIDTH = 4.115  # half of singles width

    # Net
    NET_HEIGHT_CENTER = 0.914
    NET_HEIGHT_POSTS = 1.07

    # Reference points (normalized court coordinates)
    # Origin at center of baseline (player's end)
    KEYPOINTS = {
        'baseline_left': (-COURT_WIDTH_SINGLES/2, 0),
        'baseline_right': (COURT_WIDTH_SINGLES/2, 0),
        'baseline_center': (0, 0),
        'service_line_left': (-COURT_WIDTH_SINGLES/2, SERVICE_LINE_DIST),
        'service_line_right': (COURT_WIDTH_SINGLES/2, SERVICE_LINE_DIST),
        'service_line_center': (0, SERVICE_LINE_DIST),
        'net_left': (-COURT_WIDTH_SINGLES/2, COURT_LENGTH/2),
        'net_right': (COURT_WIDTH_SINGLES/2, COURT_LENGTH/2),
        'net_center': (0, COURT_LENGTH/2),
        'far_service_left': (-COURT_WIDTH_SINGLES/2, COURT_LENGTH/2 + SERVICE_LINE_DIST),
        'far_service_right': (COURT_WIDTH_SINGLES/2, COURT_LENGTH/2 + SERVICE_LINE_DIST),
        'far_baseline_left': (-COURT_WIDTH_SINGLES/2, COURT_LENGTH),
        'far_baseline_right': (COURT_WIDTH_SINGLES/2, COURT_LENGTH),
    }


class RobustCourtDetector:
    """
    Multi-strategy court detection for amateur footage
    """

    def __init__(self, nn_model_path=None, device='cpu'):
        self.geometry = CourtGeometry()
        self.homography = None
        self.calibration_points = None
        self.detection_method = None

        # Neural network model (optional)
        self.nn_model = None
        if nn_model_path and os.path.exists(nn_model_path):
            try:
                self._load_nn_model(nn_model_path, device)
            except Exception as e:
                print(f"Could not load NN model: {e}")

    def _load_nn_model(self, path, device):
        """Load neural network court detection model"""
        import torch
        import torch.nn as nn

        # Import the model architecture
        from calibrate_comprehensive import BallTrackerNet

        self.nn_model = BallTrackerNet(input_channels=3, out_channels=15)
        self.nn_model.load_state_dict(torch.load(path, map_location=device))
        self.nn_model.to(device)
        self.nn_model.eval()
        self.nn_device = device
        print("Neural network court model loaded")

    def detect(self, frame, method='auto'):
        """
        Detect court in frame using specified or automatic method selection.

        Args:
            frame: BGR image
            method: 'auto', 'nn', 'hough', 'color', or 'manual'

        Returns:
            dict with 'homography', 'keypoints', 'method', 'confidence'
        """
        if method == 'auto':
            # Try methods in order of preference
            result = self._try_nn_detection(frame)
            if result and result['confidence'] > 0.7:
                return result

            result = self._try_hough_detection(frame)
            if result and result['confidence'] > 0.5:
                return result

            result = self._try_color_detection(frame)
            if result and result['confidence'] > 0.4:
                return result

            # Return best result or None
            return result

        elif method == 'nn':
            return self._try_nn_detection(frame)
        elif method == 'hough':
            return self._try_hough_detection(frame)
        elif method == 'color':
            return self._try_color_detection(frame)
        elif method == 'manual':
            if self.calibration_points:
                return self._use_manual_calibration(frame)
            return None

        return None

    def set_manual_calibration(self, points, frame_shape):
        """
        Set manual calibration from 4 corner points.

        Args:
            points: List of 4 (x, y) tuples in order:
                    [baseline_left, baseline_right, far_baseline_right, far_baseline_left]
            frame_shape: (height, width) of the frame
        """
        if len(points) != 4:
            raise ValueError("Need exactly 4 points for calibration")

        self.calibration_points = np.float32(points)
        self.calibration_frame_shape = frame_shape

        # Court corners in meters (singles court)
        court_corners = np.float32([
            [0, 0],  # baseline left
            [self.geometry.COURT_WIDTH_SINGLES, 0],  # baseline right
            [self.geometry.COURT_WIDTH_SINGLES, self.geometry.COURT_LENGTH],  # far right
            [0, self.geometry.COURT_LENGTH],  # far left
        ])

        self.homography, _ = cv2.findHomography(self.calibration_points, court_corners)
        self.detection_method = 'manual'

        return {
            'homography': self.homography,
            'keypoints': self.calibration_points,
            'method': 'manual',
            'confidence': 1.0
        }

    def _try_nn_detection(self, frame):
        """Try neural network detection"""
        if self.nn_model is None:
            return None

        import torch
        import torch.nn.functional as F

        h, w = frame.shape[:2]
        img = cv2.resize(frame, (640, 360))
        inp = (img.astype(np.float32) / 255.)
        inp = torch.tensor(np.rollaxis(inp, 2, 0)).unsqueeze(0)

        with torch.no_grad():
            out = self.nn_model(inp.float().to(self.nn_device))[0]
        pred = torch.sigmoid(out).detach().cpu().numpy()

        # Extract keypoints from heatmaps
        points = []
        for kps_num in range(14):
            heatmap = (pred[kps_num] * 255).astype(np.uint8)
            _, heatmap = cv2.threshold(heatmap, 170, 255, cv2.THRESH_BINARY)
            circles = cv2.HoughCircles(heatmap, cv2.HOUGH_GRADIENT, dp=1, minDist=20,
                                       param1=50, param2=2, minRadius=10, maxRadius=25)
            if circles is not None:
                x = circles[0][0][0] * (w / 640)
                y = circles[0][0][1] * (h / 360)
                points.append((x, y))
            else:
                points.append(None)

        # Count valid points
        valid_count = sum(1 for p in points if p is not None)
        confidence = valid_count / 14.0

        if valid_count < 4:
            return {'method': 'nn', 'confidence': confidence, 'homography': None, 'keypoints': points}

        # Compute homography if enough points
        homography = self._compute_homography_from_keypoints(points)

        return {
            'homography': homography,
            'keypoints': points,
            'method': 'nn',
            'confidence': confidence
        }

    def _try_hough_detection(self, frame):
        """
        Detect court lines using Hough transform.
        Optimized for behind-baseline amateur footage.
        """
        h, w = frame.shape[:2]

        # Convert to grayscale and HSV for court detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Step 1: Create mask for white/bright lines
        # Use multiple thresholds to catch lines in varying lighting
        _, bright_mask = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)

        # Also check for low-saturation (white) pixels
        white_mask = cv2.inRange(hsv, np.array([0, 0, 180]), np.array([180, 40, 255]))

        # Combine masks
        line_mask = cv2.bitwise_or(white_mask, bright_mask)

        # Clean up with morphology
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        line_mask = cv2.morphologyEx(line_mask, cv2.MORPH_CLOSE, kernel)

        # Step 2: Detect lines using Hough transform
        edges = cv2.Canny(line_mask, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50,
                                minLineLength=50, maxLineGap=20)

        if lines is None:
            return {'method': 'hough', 'confidence': 0, 'homography': None, 'keypoints': None}

        # Step 3: Classify lines into horizontal and vertical groups
        # For behind-baseline view: baseline is nearly horizontal at bottom,
        # sidelines angle inward toward top (converging due to perspective)

        baseline_candidates = []  # Near-horizontal lines in bottom 40% of frame
        sideline_candidates = []  # Lines with perspective (not purely vertical)
        service_line_candidates = []  # Horizontal lines in middle of frame

        for line in lines:
            x1, y1, x2, y2 = line[0]
            length = np.sqrt((x2-x1)**2 + (y2-y1)**2)
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            mid_y = (y1 + y2) / 2
            mid_x = (x1 + x2) / 2

            # Baseline: near-horizontal (angle close to 0 or 180), in bottom part of frame
            if abs(angle) < 15 or abs(angle) > 165:
                if mid_y > h * 0.5:  # Bottom half
                    baseline_candidates.append((x1, y1, x2, y2, length, angle, mid_y))
                elif mid_y > h * 0.2:  # Middle area = service line or far baseline
                    service_line_candidates.append((x1, y1, x2, y2, length, angle, mid_y))

            # Sidelines: lines that are more vertical than horizontal
            # In behind-baseline view, sidelines are nearly vertical (70-110 degrees)
            elif 50 < abs(angle) < 130:
                # Should span some vertical distance
                y_span = abs(y2 - y1)
                if y_span > h * 0.08 and length > 60:
                    sideline_candidates.append((x1, y1, x2, y2, length, angle, mid_x))

        # Step 4: Select best baseline (longest near-horizontal line at bottom)
        baseline = None
        if baseline_candidates:
            baseline_candidates.sort(key=lambda l: l[4], reverse=True)  # by length
            baseline = baseline_candidates[0]

        # Step 5: Select sidelines (left-most and right-most converging lines)
        left_sideline = None
        right_sideline = None

        if sideline_candidates:
            # For left sideline, look for lines on left side with positive slope (going up-right)
            # For right sideline, look for lines on right side with negative slope (going up-left)

            left_candidates = [l for l in sideline_candidates if l[6] < w * 0.5]  # left half
            right_candidates = [l for l in sideline_candidates if l[6] > w * 0.5]  # right half

            if left_candidates:
                left_candidates.sort(key=lambda l: l[4], reverse=True)
                left_sideline = left_candidates[0]

            if right_candidates:
                right_candidates.sort(key=lambda l: l[4], reverse=True)
                right_sideline = right_candidates[0]

        # Step 6: Find far baseline/service line
        far_line = None
        if service_line_candidates:
            # Take the one closest to 30-40% from top
            service_line_candidates.sort(key=lambda l: abs(l[6] - h * 0.35))
            far_line = service_line_candidates[0]

        # Step 7: Compute court corners from intersections
        keypoints = None
        if baseline and left_sideline and right_sideline:
            # Extend lines and find intersections
            def extend_line(line, length_factor=3):
                x1, y1, x2, y2 = line[:4]
                dx, dy = x2 - x1, y2 - y1
                return (x1 - dx * length_factor, y1 - dy * length_factor,
                        x2 + dx * length_factor, y2 + dy * length_factor)

            baseline_ext = extend_line(baseline)
            left_ext = extend_line(left_sideline)
            right_ext = extend_line(right_sideline)

            # Find intersections
            bl_corner = self._line_intersection(baseline_ext, left_ext)
            br_corner = self._line_intersection(baseline_ext, right_ext)

            if bl_corner and br_corner:
                # For far corners, either use far_line or extrapolate
                if far_line:
                    far_ext = extend_line(far_line)
                    tl_corner = self._line_intersection(far_ext, left_ext)
                    tr_corner = self._line_intersection(far_ext, right_ext)
                else:
                    # Extrapolate sidelines to top of frame
                    tl_corner = self._extrapolate_to_y(left_sideline, h * 0.15)
                    tr_corner = self._extrapolate_to_y(right_sideline, h * 0.15)

                if tl_corner and tr_corner:
                    keypoints = [bl_corner, br_corner, tr_corner, tl_corner]

        # Build result
        all_lines = {
            'baseline': [baseline] if baseline else [],
            'sidelines': [l for l in [left_sideline, right_sideline] if l],
            'service': service_line_candidates[:3],
            'h': baseline_candidates[:5],
            'v': sideline_candidates[:5]
        }

        if keypoints and len(keypoints) == 4:
            # Compute homography
            try:
                court_corners = np.float32([
                    [0, 0],  # baseline left (player's perspective: their left)
                    [self.geometry.COURT_WIDTH_SINGLES, 0],  # baseline right
                    [self.geometry.COURT_WIDTH_SINGLES, self.geometry.COURT_LENGTH],  # far right
                    [0, self.geometry.COURT_LENGTH],  # far left
                ])
                homography, _ = cv2.findHomography(np.float32(keypoints), court_corners)

                return {
                    'homography': homography,
                    'keypoints': keypoints,
                    'method': 'hough',
                    'confidence': 0.7,
                    'lines': all_lines
                }
            except Exception as e:
                print(f"Homography failed: {e}")

        return {
            'method': 'hough',
            'confidence': 0.3 if keypoints else 0.1,
            'homography': None,
            'keypoints': keypoints,
            'lines': all_lines
        }

    def _line_intersection(self, line1, line2):
        """Find intersection of two line segments (extended to infinity)"""
        x1, y1, x2, y2 = line1[:4]
        x3, y3, x4, y4 = line2[:4]

        denom = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4)
        if abs(denom) < 1e-10:
            return None

        t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / denom
        x = x1 + t*(x2-x1)
        y = y1 + t*(y2-y1)

        return (x, y)

    def _extrapolate_to_y(self, line, target_y):
        """Extrapolate line to a specific y coordinate"""
        x1, y1, x2, y2 = line[:4]
        if abs(y2 - y1) < 1e-10:
            return None

        t = (target_y - y1) / (y2 - y1)
        x = x1 + t * (x2 - x1)
        return (x, target_y)

    def _extract_court_corners_from_lines(self, h_lines, v_lines, img_w, img_h):
        """Extract court corner points from detected lines"""

        def line_intersection(line1, line2):
            """Find intersection of two lines"""
            x1, y1, x2, y2 = line1[:4]
            x3, y3, x4, y4 = line2[:4]

            denom = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4)
            if abs(denom) < 1e-10:
                return None

            t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / denom

            x = x1 + t*(x2-x1)
            y = y1 + t*(y2-y1)

            # Check if intersection is within reasonable bounds
            if -img_w < x < 2*img_w and -img_h < y < 2*img_h:
                return (x, y)
            return None

        # Find intersections between horizontal and vertical lines
        corners = []

        # Get the most prominent horizontal lines (likely baseline and service line)
        if len(h_lines) >= 2:
            baseline = h_lines[-1]  # Bottom-most horizontal line
            service_line = h_lines[-2] if len(h_lines) > 1 else h_lines[-1]
        else:
            return None

        # Get outer vertical lines (sidelines)
        if len(v_lines) >= 2:
            left_sideline = v_lines[0]   # Left-most vertical
            right_sideline = v_lines[-1]  # Right-most vertical
        else:
            return None

        # Find the 4 corners formed by baseline/service and sidelines
        corner_bl = line_intersection(baseline, left_sideline)
        corner_br = line_intersection(baseline, right_sideline)
        corner_tl = line_intersection(service_line, left_sideline)
        corner_tr = line_intersection(service_line, right_sideline)

        if all([corner_bl, corner_br, corner_tl, corner_tr]):
            # Order: baseline_left, baseline_right, far_right, far_left
            return [corner_bl, corner_br, corner_tr, corner_tl]

        return None

    def _try_color_detection(self, frame):
        """
        Detect court using color segmentation.
        Works best when court color is distinct from surroundings.
        """
        h, w = frame.shape[:2]
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Common court colors to try
        court_colors = {
            'blue_hard': ([100, 50, 50], [130, 255, 255]),   # US Open blue
            'green_hard': ([35, 50, 50], [85, 255, 255]),    # Green hard court
            'clay': ([5, 50, 50], [25, 255, 255]),           # Clay/red
            'grass': ([35, 40, 40], [75, 255, 200]),         # Grass
        }

        best_result = None
        best_confidence = 0

        for court_type, (lower, upper) in court_colors.items():
            mask = cv2.inRange(hsv, np.array(lower), np.array(upper))

            # Clean up mask
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

            # Find contours
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if not contours:
                continue

            # Find largest contour (likely the court)
            largest = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(largest)

            # Court should be significant portion of frame
            if area < 0.1 * w * h:
                continue

            # Approximate contour to polygon
            epsilon = 0.02 * cv2.arcLength(largest, True)
            approx = cv2.approxPolyDP(largest, epsilon, True)

            # Look for quadrilateral (4 corners)
            if len(approx) == 4:
                corners = approx.reshape(4, 2).tolist()
                confidence = min(0.5, area / (w * h))

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_result = {
                        'method': 'color',
                        'court_type': court_type,
                        'corners': corners,
                        'confidence': confidence
                    }

        if best_result and best_confidence > 0.2:
            # Order corners properly
            corners = self._order_corners(best_result['corners'])

            court_corners = np.float32([
                [0, 0],
                [self.geometry.COURT_WIDTH_SINGLES, 0],
                [self.geometry.COURT_WIDTH_SINGLES, self.geometry.COURT_LENGTH],
                [0, self.geometry.COURT_LENGTH],
            ])

            try:
                homography, _ = cv2.findHomography(np.float32(corners), court_corners)
                best_result['homography'] = homography
                best_result['keypoints'] = corners
            except:
                best_result['homography'] = None

            return best_result

        return {'method': 'color', 'confidence': 0, 'homography': None, 'keypoints': None}

    def _order_corners(self, corners):
        """Order corners as: top-left, top-right, bottom-right, bottom-left"""
        corners = np.array(corners)

        # Sort by y coordinate
        sorted_by_y = corners[np.argsort(corners[:, 1])]

        # Top two points
        top = sorted_by_y[:2]
        top = top[np.argsort(top[:, 0])]  # Sort by x

        # Bottom two points
        bottom = sorted_by_y[2:]
        bottom = bottom[np.argsort(bottom[:, 0])]  # Sort by x

        # Return in order: bottom-left, bottom-right, top-right, top-left
        return [bottom[0].tolist(), bottom[1].tolist(), top[1].tolist(), top[0].tolist()]

    def _use_manual_calibration(self, frame):
        """Use previously set manual calibration"""
        if self.homography is None:
            return None

        return {
            'homography': self.homography,
            'keypoints': self.calibration_points,
            'method': 'manual',
            'confidence': 1.0
        }

    def _compute_homography_from_keypoints(self, points):
        """Compute homography from detected keypoints"""
        # This would need to map the 14 keypoints to court coordinates
        # For now, return None if not enough points
        valid_points = [(i, p) for i, p in enumerate(points) if p is not None]
        if len(valid_points) < 4:
            return None

        # TODO: Implement proper keypoint to court coordinate mapping
        return None

    def pixel_to_court(self, pixel_pos, homography=None):
        """
        Convert pixel position to court coordinates (meters).

        Args:
            pixel_pos: (x, y) in pixels
            homography: Optional homography matrix (uses stored if not provided)

        Returns:
            (x, y) in meters from baseline center, or None if no homography
        """
        H = homography if homography is not None else self.homography
        if H is None:
            return None

        point = np.array([[pixel_pos]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, H)

        return (float(transformed[0, 0, 0]), float(transformed[0, 0, 1]))

    def court_to_pixel(self, court_pos, homography=None):
        """
        Convert court coordinates to pixel position.

        Args:
            court_pos: (x, y) in meters
            homography: Optional homography matrix

        Returns:
            (x, y) in pixels, or None if no homography
        """
        H = homography if homography is not None else self.homography
        if H is None:
            return None

        H_inv = np.linalg.inv(H)
        point = np.array([[court_pos]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, H_inv)

        return (float(transformed[0, 0, 0]), float(transformed[0, 0, 1]))

    def is_in_court(self, court_pos, margin=0.0):
        """
        Check if position is within court bounds.

        Args:
            court_pos: (x, y) in meters
            margin: Extra margin in meters (positive = more lenient)

        Returns:
            True if in court, False otherwise
        """
        if court_pos is None:
            return None

        x, y = court_pos

        # Singles court bounds (centered at x=COURT_WIDTH_SINGLES/2)
        half_width = self.geometry.COURT_WIDTH_SINGLES / 2

        x_in = -margin <= x <= self.geometry.COURT_WIDTH_SINGLES + margin
        y_in = -margin <= y <= self.geometry.COURT_LENGTH + margin

        return x_in and y_in

    def get_shot_depth(self, court_pos):
        """
        Get shot depth as percentage of half-court.

        Returns:
            0 = at net, 100 = at baseline, >100 = past baseline (out)
        """
        if court_pos is None:
            return None

        y = court_pos[1]
        half_court = self.geometry.COURT_LENGTH / 2

        if y <= half_court:
            # Ball on player's side (shouldn't happen for their shot)
            return 0

        # Distance from net to baseline on opponent's side
        depth_from_net = y - half_court
        depth_percent = (depth_from_net / half_court) * 100

        return depth_percent

    def visualize_detection(self, frame, result):
        """Draw detected court on frame for debugging"""
        vis = frame.copy()

        if result is None:
            cv2.putText(vis, "No court detected", (20, 40),
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            return vis

        method = result.get('method', 'unknown')
        confidence = result.get('confidence', 0)

        cv2.putText(vis, f"Method: {method} ({confidence:.2f})", (20, 40),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

        # Draw keypoints
        keypoints = result.get('keypoints')
        if keypoints:
            for i, pt in enumerate(keypoints):
                if pt is not None:
                    x, y = int(pt[0]), int(pt[1])
                    cv2.circle(vis, (x, y), 5, (0, 255, 0), -1)
                    cv2.putText(vis, str(i), (x+5, y-5),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        # Draw court outline if homography available
        homography = result.get('homography')
        if homography is not None:
            # Draw court lines
            court_points = [
                (0, 0), (self.geometry.COURT_WIDTH_SINGLES, 0),
                (self.geometry.COURT_WIDTH_SINGLES, self.geometry.COURT_LENGTH),
                (0, self.geometry.COURT_LENGTH), (0, 0)
            ]

            for i in range(len(court_points) - 1):
                p1_court = court_points[i]
                p2_court = court_points[i + 1]

                p1_pixel = self.court_to_pixel(p1_court, homography)
                p2_pixel = self.court_to_pixel(p2_court, homography)

                if p1_pixel and p2_pixel:
                    cv2.line(vis, (int(p1_pixel[0]), int(p1_pixel[1])),
                            (int(p2_pixel[0]), int(p2_pixel[1])), (255, 0, 0), 2)

        # Draw detected lines if using Hough method
        lines = result.get('lines')
        if lines:
            for line in lines.get('h', [])[:5]:  # Top 5 horizontal
                cv2.line(vis, (int(line[0]), int(line[1])),
                        (int(line[2]), int(line[3])), (0, 255, 255), 1)
            for line in lines.get('v', [])[:5]:  # Top 5 vertical
                cv2.line(vis, (int(line[0]), int(line[1])),
                        (int(line[2]), int(line[3])), (255, 0, 255), 1)

        return vis


class InteractiveCourtCalibrator:
    """
    Interactive tool for manual court calibration.
    User clicks on 4 court corners.
    """

    def __init__(self):
        self.points = []
        self.frame = None
        self.window_name = "Court Calibration - Click 4 corners"
        self.instructions = [
            "Click: Bottom-left corner (near baseline)",
            "Click: Bottom-right corner (near baseline)",
            "Click: Top-right corner (far baseline)",
            "Click: Top-left corner (far baseline)",
        ]

    def _mouse_callback(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(self.points) < 4:
            self.points.append((x, y))
            self._draw_points()

    def _draw_points(self):
        vis = self.frame.copy()

        # Draw instruction
        if len(self.points) < 4:
            cv2.putText(vis, self.instructions[len(self.points)], (20, 40),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        else:
            cv2.putText(vis, "Press ENTER to confirm, ESC to restart", (20, 40),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

        # Draw points
        for i, pt in enumerate(self.points):
            cv2.circle(vis, pt, 8, (0, 0, 255), -1)
            cv2.putText(vis, str(i+1), (pt[0]+10, pt[1]-10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        # Draw lines between points
        if len(self.points) >= 2:
            for i in range(len(self.points) - 1):
                cv2.line(vis, self.points[i], self.points[i+1], (0, 255, 0), 2)
            if len(self.points) == 4:
                cv2.line(vis, self.points[3], self.points[0], (0, 255, 0), 2)

        cv2.imshow(self.window_name, vis)

    def calibrate(self, frame):
        """
        Run interactive calibration on a frame.

        Returns:
            List of 4 (x, y) points, or None if cancelled
        """
        self.frame = frame.copy()
        self.points = []

        cv2.namedWindow(self.window_name)
        cv2.setMouseCallback(self.window_name, self._mouse_callback)
        self._draw_points()

        while True:
            key = cv2.waitKey(1) & 0xFF

            if key == 27:  # ESC - restart
                self.points = []
                self._draw_points()
            elif key == 13 and len(self.points) == 4:  # ENTER - confirm
                break
            elif key == ord('q'):  # Q - quit
                self.points = None
                break

        cv2.destroyWindow(self.window_name)
        return self.points


def test_court_detection(video_path, output_path=None):
    """Test court detection on a video"""
    cap = cv2.VideoCapture(video_path)

    # Get first frame
    ret, frame = cap.read()
    if not ret:
        print("Could not read video")
        return

    detector = RobustCourtDetector()

    # Try automatic detection
    print("Testing automatic court detection...")
    result = detector.detect(frame)

    print(f"\nDetection result:")
    print(f"  Method: {result.get('method')}")
    print(f"  Confidence: {result.get('confidence', 0):.2f}")
    print(f"  Homography: {'Found' if result.get('homography') is not None else 'Not found'}")

    # Show visualization
    vis = detector.visualize_detection(frame, result)

    if output_path:
        cv2.imwrite(output_path, vis)
        print(f"\nVisualization saved to: {output_path}")
    else:
        cv2.imshow("Court Detection", vis)
        print("\nPress any key to continue...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    # If automatic detection failed, offer manual calibration
    if result.get('homography') is None:
        print("\nAutomatic detection failed. Would you like to try manual calibration?")
        print("Press 'm' for manual, any other key to skip")

        cv2.imshow("Manual?", frame)
        key = cv2.waitKey(0)
        cv2.destroyAllWindows()

        if key == ord('m'):
            calibrator = InteractiveCourtCalibrator()
            points = calibrator.calibrate(frame)

            if points:
                result = detector.set_manual_calibration(points, frame.shape[:2])
                print("\nManual calibration set!")

                vis = detector.visualize_detection(frame, result)
                cv2.imshow("Manual Calibration Result", vis)
                cv2.waitKey(0)
                cv2.destroyAllWindows()

    cap.release()
    return detector, result


if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("Usage: python court_detector_robust.py <video_path> [output_image]")
        sys.exit(1)

    video_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    test_court_detection(video_path, output_path)
