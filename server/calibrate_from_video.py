#!/usr/bin/env python3
"""
Video Calibration Script for TechniqueAI

Processes tennis videos through MediaPipe pose detection to extract
calibration metrics for stroke analysis thresholds.
"""

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import numpy as np
import json
import argparse
from collections import deque
import math
from datetime import datetime
import urllib.request
import os

class VideoCalibrator:
    def __init__(self):
        # Download pose model if needed
        model_path = self._ensure_model()

        # Initialize MediaPipe Pose Landmarker
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO,
            num_poses=2,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.pose_landmarker = vision.PoseLandmarker.create_from_options(options)

        # Pose history for velocity/acceleration calculation
        self.pose_history = deque(maxlen=60)  # 2 seconds at 30fps
        self.prev_landmarks = None
        self.prev_time = None

        # Stroke detection state
        self.stroke_in_progress = False
        self.stroke_start_frame = None
        self.current_stroke_data = []

        # Collected metrics
        self.all_strokes = []
        self.frame_metrics = []

        # MediaPipe landmark indices (same as before)
        self.LANDMARKS = {
            'nose': 0,
            'left_shoulder': 11,
            'right_shoulder': 12,
            'left_elbow': 13,
            'right_elbow': 14,
            'left_wrist': 15,
            'right_wrist': 16,
            'left_hip': 23,
            'right_hip': 24,
            'left_knee': 25,
            'right_knee': 26,
            'left_ankle': 27,
            'right_ankle': 28
        }

    def _ensure_model(self):
        """Download pose landmarker model if not present"""
        model_path = os.path.join(os.path.dirname(__file__), 'pose_landmarker.task')
        if not os.path.exists(model_path):
            print("Downloading pose landmarker model...")
            url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
            urllib.request.urlretrieve(url, model_path)
            print("Model downloaded.")
        return model_path

    def calculate_angle(self, p1, p2, p3):
        """Calculate angle at p2 given three points"""
        v1 = np.array([p1.x - p2.x, p1.y - p2.y])
        v2 = np.array([p3.x - p2.x, p3.y - p2.y])

        cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
        angle = np.arccos(np.clip(cos_angle, -1, 1))
        return np.degrees(angle)

    def calculate_velocity(self, current, previous, dt):
        """Calculate velocity between two landmark positions"""
        if previous is None or dt <= 0:
            return 0
        dx = current.x - previous.x
        dy = current.y - previous.y
        return math.sqrt(dx*dx + dy*dy) / dt

    def extract_frame_metrics(self, landmarks, frame_num, fps):
        """Extract all relevant metrics from a single frame"""
        lm = landmarks

        metrics = {
            'frame': frame_num,
            'timestamp': frame_num / fps
        }

        # Elbow angles
        metrics['left_elbow_angle'] = self.calculate_angle(
            lm[self.LANDMARKS['left_shoulder']],
            lm[self.LANDMARKS['left_elbow']],
            lm[self.LANDMARKS['left_wrist']]
        )
        metrics['right_elbow_angle'] = self.calculate_angle(
            lm[self.LANDMARKS['right_shoulder']],
            lm[self.LANDMARKS['right_elbow']],
            lm[self.LANDMARKS['right_wrist']]
        )

        # Knee angles
        metrics['left_knee_angle'] = self.calculate_angle(
            lm[self.LANDMARKS['left_hip']],
            lm[self.LANDMARKS['left_knee']],
            lm[self.LANDMARKS['left_ankle']]
        )
        metrics['right_knee_angle'] = self.calculate_angle(
            lm[self.LANDMARKS['right_hip']],
            lm[self.LANDMARKS['right_knee']],
            lm[self.LANDMARKS['right_ankle']]
        )

        # Shoulder rotation (hip-shoulder separation)
        left_shoulder = lm[self.LANDMARKS['left_shoulder']]
        right_shoulder = lm[self.LANDMARKS['right_shoulder']]
        left_hip = lm[self.LANDMARKS['left_hip']]
        right_hip = lm[self.LANDMARKS['right_hip']]

        shoulder_angle = math.atan2(
            right_shoulder.y - left_shoulder.y,
            right_shoulder.x - left_shoulder.x
        )
        hip_angle = math.atan2(
            right_hip.y - left_hip.y,
            right_hip.x - left_hip.x
        )
        metrics['hip_shoulder_separation'] = abs(math.degrees(shoulder_angle - hip_angle))

        # Wrist positions (normalized)
        metrics['left_wrist_x'] = lm[self.LANDMARKS['left_wrist']].x
        metrics['left_wrist_y'] = lm[self.LANDMARKS['left_wrist']].y
        metrics['right_wrist_x'] = lm[self.LANDMARKS['right_wrist']].x
        metrics['right_wrist_y'] = lm[self.LANDMARKS['right_wrist']].y

        # Calculate velocities if we have previous frame
        dt = 1.0 / fps
        if self.prev_landmarks:
            prev_lm = self.prev_landmarks

            metrics['left_wrist_velocity'] = self.calculate_velocity(
                lm[self.LANDMARKS['left_wrist']],
                prev_lm[self.LANDMARKS['left_wrist']],
                dt
            )
            metrics['right_wrist_velocity'] = self.calculate_velocity(
                lm[self.LANDMARKS['right_wrist']],
                prev_lm[self.LANDMARKS['right_wrist']],
                dt
            )

            # Calculate acceleration if we have enough history
            if len(self.pose_history) >= 2:
                prev_metrics = self.pose_history[-1]
                if 'left_wrist_velocity' in prev_metrics:
                    metrics['left_wrist_acceleration'] = (
                        metrics['left_wrist_velocity'] - prev_metrics['left_wrist_velocity']
                    ) / dt
                    metrics['right_wrist_acceleration'] = (
                        metrics['right_wrist_velocity'] - prev_metrics['right_wrist_velocity']
                    ) / dt

        # Body rotation (using shoulder line angle)
        metrics['shoulder_rotation'] = math.degrees(shoulder_angle)

        return metrics

    def detect_stroke(self, metrics):
        """Detect if a stroke is occurring based on wrist velocity"""
        # Use a velocity threshold scaled for per-second values (since we divide by dt)
        velocity_threshold = 1.0  # Normalized units per second

        left_vel = metrics.get('left_wrist_velocity', 0)
        right_vel = metrics.get('right_wrist_velocity', 0)
        max_vel = max(left_vel, right_vel)

        # High velocity = in stroke, low velocity = stroke ended
        if max_vel > velocity_threshold:
            if not self.stroke_in_progress:
                self.stroke_in_progress = True
                self.stroke_start_frame = metrics['frame']
                self.current_stroke_data = []
            self.current_stroke_data.append(metrics)
        else:
            if self.stroke_in_progress and len(self.current_stroke_data) > 3:
                # Stroke ended, analyze it
                stroke = self.analyze_stroke(self.current_stroke_data)
                if stroke:
                    self.all_strokes.append(stroke)
            self.stroke_in_progress = False
            self.current_stroke_data = []

    def analyze_stroke(self, stroke_data):
        """Analyze collected stroke data"""
        if len(stroke_data) < 5:
            return None

        # Find peak velocity frame
        velocities = [max(d.get('left_wrist_velocity', 0), d.get('right_wrist_velocity', 0))
                     for d in stroke_data]
        peak_idx = np.argmax(velocities)
        peak_frame = stroke_data[peak_idx]

        # Determine stroke type based on which wrist is faster
        left_vel = peak_frame.get('left_wrist_velocity', 0)
        right_vel = peak_frame.get('right_wrist_velocity', 0)

        if right_vel > left_vel:
            stroke_type = 'Forehand'  # Assuming right-handed
            dominant_wrist = 'right'
        else:
            stroke_type = 'Backhand'
            dominant_wrist = 'left'

        # Check for serve (high wrist position)
        wrist_y = peak_frame.get(f'{dominant_wrist}_wrist_y', 0.5)
        if wrist_y < 0.3:  # Wrist above head level
            stroke_type = 'Serve'

        accelerations = [
            max(abs(d.get('left_wrist_acceleration', 0)),
                abs(d.get('right_wrist_acceleration', 0)))
            for d in stroke_data if 'left_wrist_acceleration' in d
        ]

        return {
            'type': stroke_type,
            'start_frame': stroke_data[0]['frame'],
            'end_frame': stroke_data[-1]['frame'],
            'duration_frames': len(stroke_data),
            'peak_velocity': max(velocities),
            'peak_acceleration': max(accelerations) if accelerations else 0,
            'elbow_angle_at_contact': peak_frame.get(f'{dominant_wrist}_elbow_angle', 0),
            'hip_shoulder_separation': max([d.get('hip_shoulder_separation', 0) for d in stroke_data]),
            'knee_bend': min([
                min(d.get('left_knee_angle', 180), d.get('right_knee_angle', 180))
                for d in stroke_data
            ]),
            'rotation': max([abs(d.get('shoulder_rotation', 0)) for d in stroke_data])
        }

    def process_video(self, video_path, sample_rate=1):
        """Process video and extract calibration metrics"""
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        print(f"Video: {width}x{height} @ {fps}fps, {total_frames} frames", flush=True)

        frame_num = 0
        processed = 0
        poses_detected = 0

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame_num += 1

            # Sample frames
            if frame_num % sample_rate != 0:
                continue

            processed += 1

            # Convert to RGB for MediaPipe
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Create MediaPipe Image
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

            # Calculate timestamp in milliseconds
            timestamp_ms = int((frame_num / fps) * 1000)

            # Detect poses
            results = self.pose_landmarker.detect_for_video(mp_image, timestamp_ms)

            if results.pose_landmarks and len(results.pose_landmarks) > 0:
                poses_detected += 1
                # Use the first detected pose
                landmarks = results.pose_landmarks[0]
                metrics = self.extract_frame_metrics(landmarks, frame_num, fps)
                self.frame_metrics.append(metrics)
                self.pose_history.append(metrics)
                self.detect_stroke(metrics)
                self.prev_landmarks = landmarks

            # Progress
            if processed % 100 == 0:
                # Get max velocity from recent frames for debugging
                recent_vels = [m.get('right_wrist_velocity', 0) for m in list(self.pose_history)[-10:]]
                max_recent = max(recent_vels) if recent_vels else 0
                print(f"Processed {processed} frames, {poses_detected} poses, {len(self.all_strokes)} strokes... (max_vel={max_recent:.6f})", flush=True)

        cap.release()

        print(f"\nDone! Processed {processed} frames, detected {poses_detected} poses, {len(self.all_strokes)} strokes")

        return self.generate_calibration_report(fps)

    def generate_calibration_report(self, fps):
        """Generate calibration report with statistics"""
        if not self.all_strokes:
            return {'error': 'No strokes detected', 'frame_metrics_count': len(self.frame_metrics)}

        # Aggregate metrics
        velocities = [s['peak_velocity'] for s in self.all_strokes]
        accelerations = [s['peak_acceleration'] for s in self.all_strokes if s['peak_acceleration'] > 0]
        elbow_angles = [s['elbow_angle_at_contact'] for s in self.all_strokes if s['elbow_angle_at_contact'] > 0]
        hip_shoulder_seps = [s['hip_shoulder_separation'] for s in self.all_strokes]
        knee_bends = [s['knee_bend'] for s in self.all_strokes]
        rotations = [s['rotation'] for s in self.all_strokes]

        def stats(arr):
            if not arr:
                return None
            arr = sorted(arr)
            return {
                'min': float(arr[0]),
                'max': float(arr[-1]),
                'avg': float(np.mean(arr)),
                'median': float(np.median(arr)),
                'p10': float(np.percentile(arr, 10)),
                'p25': float(np.percentile(arr, 25)),
                'p75': float(np.percentile(arr, 75)),
                'p90': float(np.percentile(arr, 90)),
                'std': float(np.std(arr)),
                'count': len(arr)
            }

        # Stroke type breakdown
        stroke_types = {}
        for s in self.all_strokes:
            t = s['type']
            if t not in stroke_types:
                stroke_types[t] = []
            stroke_types[t].append(s)

        report = {
            'timestamp': datetime.now().isoformat(),
            'total_strokes': len(self.all_strokes),
            'stroke_distribution': {t: len(strokes) for t, strokes in stroke_types.items()},
            'metrics': {
                'velocity': stats(velocities),
                'acceleration': stats(accelerations),
                'elbowAngle': stats(elbow_angles),
                'hipShoulderSeparation': stats(hip_shoulder_seps),
                'kneeBend': stats(knee_bends),
                'rotation': stats(rotations)
            },
            'recommended_thresholds': {
                'strokeDetection': {
                    'minVelocity': float(np.percentile(velocities, 10) * 0.8) if velocities else 0.025,
                    'minAcceleration': float(np.percentile(accelerations, 10) * 0.8) if accelerations else 0.008
                },
                'professional': {
                    'velocity': {
                        'average': float(np.median(velocities)) if velocities else 0.055,
                        'good': float(np.percentile(velocities, 25)) if velocities else 0.045,
                        'excellent': float(np.percentile(velocities, 75)) if velocities else 0.065
                    },
                    'acceleration': {
                        'average': float(np.median(accelerations)) if accelerations else 0.018,
                        'good': float(np.percentile(accelerations, 25)) if accelerations else 0.015,
                        'excellent': float(np.percentile(accelerations, 75)) if accelerations else 0.025
                    }
                },
                'biomechanical': {
                    'elbowAngle': {
                        'ideal_min': float(np.percentile(elbow_angles, 25)) if elbow_angles else 140,
                        'ideal_max': float(np.percentile(elbow_angles, 75)) if elbow_angles else 170
                    },
                    'hipShoulderSeparation': {
                        'ideal_min': float(np.percentile(hip_shoulder_seps, 25)) if hip_shoulder_seps else 25,
                        'ideal_max': float(np.percentile(hip_shoulder_seps, 75)) if hip_shoulder_seps else 50
                    }
                }
            },
            'strokes': self.all_strokes
        }

        return report


def main():
    parser = argparse.ArgumentParser(description='Calibrate TechniqueAI from tennis video')
    parser.add_argument('video', help='Path to video file')
    parser.add_argument('--output', '-o', help='Output JSON file', default='calibration_results.json')
    parser.add_argument('--sample-rate', '-s', type=int, default=1, help='Process every Nth frame')
    parser.add_argument('--label', '-l', default='professional', help='Skill level label')
    parser.add_argument('--player', '-p', default='unknown', help='Player name')

    args = parser.parse_args()

    print(f"Calibrating from: {args.video}")
    print(f"Label: {args.label}, Player: {args.player}")
    print("-" * 50)

    calibrator = VideoCalibrator()
    report = calibrator.process_video(args.video, args.sample_rate)

    # Add metadata
    report['label'] = args.label
    report['player'] = args.player
    report['video'] = args.video

    # Save report
    with open(args.output, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\nCalibration report saved to: {args.output}")

    # Print summary
    if 'error' not in report:
        print(f"\n{'='*50}")
        print("CALIBRATION SUMMARY")
        print(f"{'='*50}")
        print(f"Total strokes detected: {report['total_strokes']}")
        print(f"Stroke distribution: {report['stroke_distribution']}")
        print(f"\nKey Metrics:")
        for metric, data in report['metrics'].items():
            if data:
                print(f"  {metric}: avg={data['avg']:.4f}, range=[{data['min']:.4f}-{data['max']:.4f}]")
        print(f"\nRecommended Thresholds:")
        print(f"  Min velocity: {report['recommended_thresholds']['strokeDetection']['minVelocity']:.4f}")
        print(f"  Pro velocity avg: {report['recommended_thresholds']['professional']['velocity']['average']:.4f}")
    else:
        print(f"\nError: {report['error']}")
        if 'frame_metrics_count' in report:
            print(f"Frame metrics collected: {report['frame_metrics_count']}")


if __name__ == '__main__':
    main()
