#!/usr/bin/env python3
"""
Manual Court Calibration Tool for Amateur Tennis Footage

Since automatic court detection is unreliable on amateur footage (phone recordings,
variable angles, backgrounds), this tool provides a simple manual calibration:

1. User clicks 4 corners of the court (or visible portion)
2. System computes homography to real-world coordinates
3. Calibration is saved and can be reused for videos from same camera position

Usage:
    python calibrate_court_manual.py <video_path> [--output calibration.json]

The calibration file can then be used with the main calibration script.
"""

import cv2
import numpy as np
import json
import argparse
import os


class CourtGeometry:
    """Standard tennis court dimensions in meters"""
    COURT_LENGTH = 23.77  # baseline to baseline
    COURT_WIDTH_SINGLES = 8.23
    SERVICE_LINE_DIST = 6.40  # from net to service line

    # For calibration, we use half-court (player's side)
    HALF_COURT_LENGTH = COURT_LENGTH / 2  # 11.885m


class ManualCourtCalibrator:
    """Interactive court calibration tool"""

    def __init__(self):
        self.points = []
        self.frame = None
        self.window_name = "Court Calibration"
        self.calibration_mode = 'full'  # 'full' or 'half'
        self.court = CourtGeometry()

    def _mouse_callback(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(self.points) < 4:
            self.points.append((x, y))
            self._draw()

    def _draw(self):
        vis = self.frame.copy()
        h, w = vis.shape[:2]

        # Instructions
        instructions = [
            "COURT CALIBRATION",
            "",
            "Click the 4 corners of the singles court:",
            "  1. YOUR baseline - LEFT corner",
            "  2. YOUR baseline - RIGHT corner",
            "  3. FAR baseline - RIGHT corner",
            "  4. FAR baseline - LEFT corner",
            "",
            f"Points clicked: {len(self.points)}/4",
            "",
            "Keys:",
            "  ENTER - Confirm (when 4 points set)",
            "  R - Reset points",
            "  H - Switch to half-court mode",
            "  ESC - Cancel",
        ]

        # Draw semi-transparent overlay for instructions
        overlay = vis.copy()
        cv2.rectangle(overlay, (10, 10), (400, 300), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, vis, 0.3, 0, vis)

        y_offset = 30
        for line in instructions:
            cv2.putText(vis, line, (20, y_offset),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            y_offset += 20

        # Draw points
        colors = [(0, 0, 255), (0, 255, 0), (255, 0, 0), (255, 255, 0)]
        labels = ["1: Baseline L", "2: Baseline R", "3: Far R", "4: Far L"]

        for i, pt in enumerate(self.points):
            cv2.circle(vis, pt, 10, colors[i], -1)
            cv2.circle(vis, pt, 12, (255, 255, 255), 2)
            cv2.putText(vis, labels[i], (pt[0] + 15, pt[1] - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, colors[i], 2)

        # Draw lines between points
        if len(self.points) >= 2:
            for i in range(len(self.points) - 1):
                cv2.line(vis, self.points[i], self.points[i+1], (0, 255, 0), 2)
            if len(self.points) == 4:
                cv2.line(vis, self.points[3], self.points[0], (0, 255, 0), 2)

        # Show mode
        mode_text = f"Mode: {'Full Court' if self.calibration_mode == 'full' else 'Half Court (your side)'}"
        cv2.putText(vis, mode_text, (w - 350, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

        cv2.imshow(self.window_name, vis)

    def calibrate(self, frame):
        """
        Run interactive calibration.

        Returns:
            dict with calibration data, or None if cancelled
        """
        self.frame = frame.copy()
        self.points = []
        h, w = frame.shape[:2]

        cv2.namedWindow(self.window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(self.window_name, min(1280, w), min(720, h))
        cv2.setMouseCallback(self.window_name, self._mouse_callback)

        self._draw()

        while True:
            key = cv2.waitKey(1) & 0xFF

            if key == 27:  # ESC - cancel
                cv2.destroyWindow(self.window_name)
                return None

            elif key == ord('r') or key == ord('R'):  # Reset
                self.points = []
                self._draw()

            elif key == ord('h') or key == ord('H'):  # Toggle half-court
                self.calibration_mode = 'half' if self.calibration_mode == 'full' else 'full'
                self._draw()

            elif key == 13 and len(self.points) == 4:  # ENTER - confirm
                break

        cv2.destroyWindow(self.window_name)

        # Compute homography
        return self._compute_calibration(h, w)

    def _compute_calibration(self, frame_h, frame_w):
        """Compute homography from clicked points"""

        # Court coordinates in meters
        if self.calibration_mode == 'full':
            # Full court: origin at YOUR baseline left corner
            court_corners = np.float32([
                [0, 0],                                    # Your baseline left
                [self.court.COURT_WIDTH_SINGLES, 0],       # Your baseline right
                [self.court.COURT_WIDTH_SINGLES, self.court.COURT_LENGTH],  # Far right
                [0, self.court.COURT_LENGTH],              # Far left
            ])
        else:
            # Half court: just your side to net
            court_corners = np.float32([
                [0, 0],                                    # Your baseline left
                [self.court.COURT_WIDTH_SINGLES, 0],       # Your baseline right
                [self.court.COURT_WIDTH_SINGLES, self.court.HALF_COURT_LENGTH],  # Net right
                [0, self.court.HALF_COURT_LENGTH],         # Net left
            ])

        pixel_corners = np.float32(self.points)

        # Compute homography: pixel -> court coordinates
        homography, _ = cv2.findHomography(pixel_corners, court_corners)

        # Test the homography
        test_results = []
        for i, (px, court) in enumerate(zip(self.points, court_corners)):
            result = cv2.perspectiveTransform(
                np.float32([[px]]), homography
            )[0][0]
            error = np.sqrt((result[0] - court[0])**2 + (result[1] - court[1])**2)
            test_results.append({
                'pixel': list(px),
                'expected_court': list(court),
                'actual_court': [float(result[0]), float(result[1])],
                'error_meters': float(error)
            })

        avg_error = np.mean([t['error_meters'] for t in test_results])

        return {
            'mode': self.calibration_mode,
            'frame_size': [frame_w, frame_h],
            'pixel_corners': [list(p) for p in self.points],
            'court_corners': court_corners.tolist(),
            'homography': homography.tolist(),
            'validation': {
                'points': test_results,
                'avg_error_meters': float(avg_error)
            },
            'court_dimensions': {
                'length': self.court.COURT_LENGTH if self.calibration_mode == 'full' else self.court.HALF_COURT_LENGTH,
                'width': self.court.COURT_WIDTH_SINGLES,
                'units': 'meters'
            }
        }


def pixel_to_court(pixel_pos, homography):
    """Convert pixel position to court coordinates"""
    point = np.float32([[pixel_pos]])
    result = cv2.perspectiveTransform(point, np.array(homography))
    return (float(result[0][0][0]), float(result[0][0][1]))


def is_in_court(court_pos, court_width=8.23, court_length=23.77, margin=0.3):
    """Check if position is in court bounds"""
    x, y = court_pos
    return (
        -margin <= x <= court_width + margin and
        -margin <= y <= court_length + margin
    )


def load_calibration(path):
    """Load calibration from JSON file"""
    with open(path, 'r') as f:
        return json.load(f)


def save_calibration(calibration, path):
    """Save calibration to JSON file"""
    with open(path, 'w') as f:
        json.dump(calibration, f, indent=2)
    print(f"Calibration saved to: {path}")


def visualize_calibration(frame, calibration):
    """Draw calibration overlay on frame"""
    vis = frame.copy()
    homography = np.array(calibration['homography'])
    inv_homography = np.linalg.inv(homography)

    # Draw court grid
    court_length = calibration['court_dimensions']['length']
    court_width = calibration['court_dimensions']['width']

    # Draw court outline
    court_points = [
        (0, 0), (court_width, 0),
        (court_width, court_length), (0, court_length), (0, 0)
    ]

    for i in range(len(court_points) - 1):
        p1 = cv2.perspectiveTransform(
            np.float32([[court_points[i]]]), inv_homography
        )[0][0]
        p2 = cv2.perspectiveTransform(
            np.float32([[court_points[i+1]]]), inv_homography
        )[0][0]
        cv2.line(vis, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])),
                (0, 255, 0), 2)

    # Draw service line (6.4m from baseline)
    service_line = [
        (0, 6.4), (court_width, 6.4)
    ]
    p1 = cv2.perspectiveTransform(
        np.float32([[service_line[0]]]), inv_homography
    )[0][0]
    p2 = cv2.perspectiveTransform(
        np.float32([[service_line[1]]]), inv_homography
    )[0][0]
    cv2.line(vis, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])),
            (0, 255, 255), 2)

    # Draw center line
    if calibration['mode'] == 'full':
        # Net line
        net_y = court_length / 2
        net_line = [(0, net_y), (court_width, net_y)]
        p1 = cv2.perspectiveTransform(
            np.float32([[net_line[0]]]), inv_homography
        )[0][0]
        p2 = cv2.perspectiveTransform(
            np.float32([[net_line[1]]]), inv_homography
        )[0][0]
        cv2.line(vis, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])),
                (255, 0, 0), 3)

    # Add info text
    cv2.putText(vis, f"Mode: {calibration['mode']}", (20, 30),
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.putText(vis, f"Court: {court_width:.1f}m x {court_length:.1f}m", (20, 60),
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

    return vis


def main():
    parser = argparse.ArgumentParser(description='Manual Court Calibration Tool')
    parser.add_argument('video', type=str, help='Path to video file')
    parser.add_argument('--output', '-o', type=str, default=None,
                       help='Output calibration JSON file')
    parser.add_argument('--frame', '-f', type=int, default=0,
                       help='Frame number to use for calibration')
    parser.add_argument('--load', '-l', type=str, default=None,
                       help='Load existing calibration to visualize')

    args = parser.parse_args()

    # Open video
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: Could not open video {args.video}")
        return

    # Seek to frame
    if args.frame > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)

    ret, frame = cap.read()
    cap.release()

    if not ret:
        print("Error: Could not read frame from video")
        return

    # Load existing calibration or create new
    if args.load:
        calibration = load_calibration(args.load)
        print(f"Loaded calibration from {args.load}")

        # Visualize
        vis = visualize_calibration(frame, calibration)
        cv2.imshow("Calibration Visualization", vis)
        print("Press any key to close...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    else:
        # Run calibration
        calibrator = ManualCourtCalibrator()
        calibration = calibrator.calibrate(frame)

        if calibration is None:
            print("Calibration cancelled")
            return

        # Show result
        print("\n" + "="*50)
        print("CALIBRATION COMPLETE")
        print("="*50)
        print(f"Mode: {calibration['mode']}")
        print(f"Court dimensions: {calibration['court_dimensions']['width']:.2f}m x {calibration['court_dimensions']['length']:.2f}m")
        print(f"Validation error: {calibration['validation']['avg_error_meters']:.4f}m")

        # Visualize
        vis = visualize_calibration(frame, calibration)
        cv2.imshow("Calibration Result", vis)
        print("\nPress any key to continue...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()

        # Save
        output_path = args.output
        if output_path is None:
            video_name = os.path.splitext(os.path.basename(args.video))[0]
            output_path = f"{video_name}_court_calibration.json"

        save_calibration(calibration, output_path)

        # Test some points
        print("\n" + "="*50)
        print("TEST POINTS")
        print("="*50)

        H = np.array(calibration['homography'])

        # Test center of frame
        h, w = frame.shape[:2]
        test_pixel = (w//2, h//2)
        court_pos = pixel_to_court(test_pixel, H)
        in_court = is_in_court(court_pos,
                              calibration['court_dimensions']['width'],
                              calibration['court_dimensions']['length'])
        print(f"Frame center {test_pixel} -> Court ({court_pos[0]:.2f}, {court_pos[1]:.2f})m, In court: {in_court}")


if __name__ == '__main__':
    main()
