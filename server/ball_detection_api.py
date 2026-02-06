from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import cv2
import numpy as np
import base64
from ball_detection.ball_detector import BallDetector
from ball_detection.court_detection_net import CourtDetectorNet
from ball_detection.court_reference import CourtReference
import torch
import os
import mediapipe as mp
from werkzeug.utils import secure_filename
import uuid

app = Flask(__name__)
CORS(app)

# Configure folders
UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'processed_videos'
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv'}

for folder in [UPLOAD_FOLDER, OUTPUT_FOLDER]:
    if not os.path.exists(folder):
        os.makedirs(folder)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER

# Resolve model paths relative to project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BALL_MODEL_PATH = os.path.join(PROJECT_ROOT, 'model_weights', 'model_best.pt')
COURT_MODEL_PATH = os.path.join(PROJECT_ROOT, 'model_weights', 'model_tennis_court_det.pt')

# Initialize models
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
ball_detector = BallDetector(BALL_MODEL_PATH, device)
court_detector = CourtDetectorNet(COURT_MODEL_PATH, device)
court_reference = CourtReference()

# Frame buffers
frame_buffer = []
court_buffer = []

class EnhancedBallDetector:
    def __init__(self, ball_detector, court_detector):
        self.ball_detector = ball_detector
        self.court_detector = court_detector
        self.court_mask = None
        self.homography_matrix = None
        
    def detect_with_court_context(self, frames):
        """Enhanced ball detection using court context"""
        if len(frames) < 3:
            return None, None, None
        
        # Get court detection for the latest frame
        court_matrix, court_keypoints = self.detect_court(frames[-1])
        
        # Standard ball detection
        ball_track = self.ball_detector.infer_model(frames)
        latest_ball = ball_track[-1] if ball_track else (None, None)
        
        # Apply court-based filtering
        filtered_ball = self.filter_ball_with_court(latest_ball, court_matrix)
        
        return filtered_ball, court_matrix, court_keypoints
    
    def detect_court(self, frame):
        """Detect court in single frame"""
        try:
            # Run court detection - pass full resolution frame
            matrices, keypoints = self.court_detector.infer_model([frame])
            
            return matrices[0], keypoints[0]
        except Exception as e:
            print(f"Court detection error: {e}")
            return None, None
    
    def filter_ball_with_court(self, ball_position, court_matrix):
        """Filter ball detection using court boundaries"""
        if ball_position[0] is None or court_matrix is None:
            return ball_position
        
        try:
            x, y = ball_position
            
            # Create court mask
            court_mask = court_reference.get_court_mask(3)  # Court without margins
            
            # Transform court mask to image coordinates
            h, w = 720, 1280  # Assume standard video size
            transformed_mask = cv2.warpPerspective(court_mask, court_matrix, (w, h))
            
            # Check if ball is within court boundaries
            if 0 <= int(x) < w and 0 <= int(y) < h:
                if transformed_mask[int(y), int(x)] > 0:
                    return ball_position  # Ball is within court
            
            # Ball outside court - return None or apply correction
            return (None, None)
            
        except Exception as e:
            print(f"Ball filtering error: {e}")
            return ball_position

# Initialize enhanced detector
enhanced_detector = EnhancedBallDetector(ball_detector, court_detector)

def base64_to_cv2(base64_string):
    """Convert base64 string to OpenCV image"""
    if base64_string.startswith('data:image'):
        base64_string = base64_string.split(',')[1]
    
    img_bytes = base64.b64decode(base64_string)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    return img

@app.route('/detect_ball_enhanced', methods=['POST'])
def detect_ball_enhanced():
    """Enhanced ball detection with court context"""
    try:
        data = request.json
        frame_base64 = data.get('frame')
        
        if not frame_base64:
            return jsonify({'error': 'No frame provided'}), 400
        
        frame = base64_to_cv2(frame_base64)
        print(f"Received frame shape: {frame.shape}")  # This will show (height, width, channels)

        if frame is None:
            return jsonify({'error': 'Invalid image data'}), 400
        
        frame_buffer.append(frame)
        if len(frame_buffer) > 3:
            frame_buffer.pop(0)
        
        if len(frame_buffer) < 3:
            return jsonify({
                'ball_detected': False,
                'x': None,
                'y': None,
                'court_detected': False,
                'court_keypoints': None,
                'message': f'Buffering frames ({len(frame_buffer)}/3)'
            })
        
        # Enhanced detection with court context
        ball_pos, court_matrix, court_keypoints = enhanced_detector.detect_with_court_context(frame_buffer)
        
        # Format court keypoints for JSON
        formatted_keypoints = None
        if court_keypoints is not None:
            try:
                formatted_keypoints = [[float(kp[0, 0]), float(kp[0, 1])] for kp in court_keypoints if kp is not None]
            except:
                formatted_keypoints = None
        
        return jsonify({
            'ball_detected': ball_pos[0] is not None and ball_pos[1] is not None,
            'x': float(ball_pos[0]) if ball_pos[0] is not None else None,
            'y': float(ball_pos[1]) if ball_pos[1] is not None else None,
            'court_detected': court_matrix is not None,
            'court_keypoints': formatted_keypoints,
            'court_confidence': 0.8 if court_matrix is not None else 0.0,
            'message': 'Enhanced detection with court context'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/detect_ball', methods=['POST'])
def detect_ball():
    """Original ball detection endpoint"""
    try:
        data = request.json
        frame_base64 = data.get('frame')
        
        if not frame_base64:
            return jsonify({'error': 'No frame provided'}), 400
        
        frame = base64_to_cv2(frame_base64)
        if frame is None:
            return jsonify({'error': 'Invalid image data'}), 400
        
        frame_buffer.append(frame)
        if len(frame_buffer) > 3:
            frame_buffer.pop(0)
        
        if len(frame_buffer) < 3:
            return jsonify({
                'ball_detected': False,
                'x': None,
                'y': None,
                'message': f'Buffering frames ({len(frame_buffer)}/3)'
            })
        
        ball_track = ball_detector.infer_model(frame_buffer[-3:])
        latest_detection = ball_track[-1] if ball_track else (None, None)
        x, y = latest_detection
        
        return jsonify({
            'ball_detected': x is not None and y is not None,
            'x': float(x) if x is not None else None,
            'y': float(y) if y is not None else None,
            'message': 'Detection successful'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def process_video_with_all_features(input_path, output_path):
    """Process video with ball detection, court detection, and pose detection"""
    cap = cv2.VideoCapture(input_path)
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Setup output video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    # Read all frames
    frames = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    
    if len(frames) < 3:
        raise ValueError("Video too short - need at least 3 frames")
    
    print(f"Processing {len(frames)} frames...")

    
    
    # Run court detection
    court_matrices, court_keypoints = court_detector.infer_model(frames)
    
    # Run ball detection
    ball_track = ball_detector.infer_model(frames)
    print(f"First ball detection sample: {ball_track[0] if ball_track else 'None'}")

    print(f"Video resolution: {width}x{height}")
    print(f"First court keypoint sample: {court_keypoints[0][0] if court_keypoints[0] is not None else 'None'}")
    
    # Initialize MediaPipe Pose
    mp_pose = mp.solutions.pose
    mp_drawing = mp.solutions.drawing_utils
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )
    
    ball_detections = 0
    pose_detections = 0
    court_detections = 0
    
    # Process each frame with all overlays
    for i, frame in enumerate(frames):
        # MediaPipe pose detection
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pose_results = pose.process(rgb_frame)
        
        # Draw pose landmarks
        if pose_results.pose_landmarks:
            pose_detections += 1
            mp_drawing.draw_landmarks(
                frame, 
                pose_results.pose_landmarks, 
                mp_pose.POSE_CONNECTIONS,
                mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=2, circle_radius=2),
                mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=2)
            )
        
        # Draw court keypoints
        if i < len(court_keypoints) and court_keypoints[i] is not None:
            court_detections += 1
            for j, kp in enumerate(court_keypoints[i]):
                if kp is not None:
                    x, y = int(kp[0, 0]), int(kp[0, 1])
                    cv2.circle(frame, (x, y), 8, (255, 0, 255), -1)  # Magenta for court points
        
        # Draw ball detection
        if i < len(ball_track) and ball_track[i][0] is not None:
            ball_detections += 1
            x, y = int(ball_track[i][0]), int(ball_track[i][1])
            
            # Apply court filtering if available
            if i < len(court_matrices) and court_matrices[i] is not None:
                filtered_ball = enhanced_detector.filter_ball_with_court(
                    (ball_track[i][0], ball_track[i][1]), 
                    court_matrices[i]
                )
                if filtered_ball[0] is not None:
                    x, y = int(filtered_ball[0]), int(filtered_ball[1])
                    # Green circle for court-validated ball
                    cv2.circle(frame, (x, y), 12, (0, 255, 0), 3)
                    cv2.circle(frame, (x, y), 4, (0, 255, 0), -1)
                else:
                    # Red circle for filtered out ball
                    x, y = int(ball_track[i][0]), int(ball_track[i][1])
                    cv2.circle(frame, (x, y), 12, (0, 0, 255), 3)
                    cv2.circle(frame, (x, y), 4, (0, 0, 255), -1)
            else:
                # Yellow circle for unfiltered ball
                cv2.circle(frame, (x, y), 12, (0, 255, 255), 3)
                cv2.circle(frame, (x, y), 4, (0, 255, 255), -1)
        
        # Add comprehensive info overlay
        overlay_y = 30
        cv2.putText(frame, f'Frame: {i+1}/{len(frames)}', (10, overlay_y),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        cv2.putText(frame, f'Ball: {"YES" if i < len(ball_track) and ball_track[i][0] is not None else "NO"}', 
                   (10, overlay_y + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 
                   (0, 255, 0) if i < len(ball_track) and ball_track[i][0] is not None else (0, 0, 255), 2)
        
        cv2.putText(frame, f'Court: {"YES" if i < len(court_keypoints) and court_keypoints[i] is not None else "NO"}', 
                   (10, overlay_y + 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                   (0, 255, 0) if i < len(court_keypoints) and court_keypoints[i] is not None else (0, 0, 255), 2)
        
        cv2.putText(frame, f'Pose: {"YES" if pose_results.pose_landmarks else "NO"}', 
                   (10, overlay_y + 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                   (0, 255, 0) if pose_results.pose_landmarks else (0, 0, 255), 2)
        
        # Write frame to output video
        out.write(frame)
        
        # Progress indicator
        if (i + 1) % 30 == 0:
            print(f"Processed {i + 1}/{len(frames)} frames...")
    
    out.release()
    pose.close()
    
    return {
        'total_frames': len(frames),
        'ball_detections': ball_detections,
        'court_detections': court_detections,
        'pose_detections': pose_detections,
        'ball_detection_rate': (ball_detections / len(frames)) * 100,
        'court_detection_rate': (court_detections / len(frames)) * 100,
        'pose_detection_rate': (pose_detections / len(frames)) * 100
    }

@app.route('/upload_video', methods=['POST'])
def upload_video():
    """Upload and process video with all features"""
    try:
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        file = request.files['video']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Allowed: mp4, avi, mov, mkv'}), 400
        
        # Generate unique filenames
        unique_id = str(uuid.uuid4())[:8]
        input_filename = f"input_{unique_id}_{secure_filename(file.filename)}"
        output_filename = f"processed_{unique_id}.mp4"
        
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], input_filename)
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # Save uploaded file
        file.save(input_path)
        
        # Process video with all features
        print("Starting comprehensive video processing...")
        stats = process_video_with_all_features(input_path, output_path)
        
        # Clean up input file
        os.remove(input_path)
        
        return jsonify({
            'success': True,
            'processed_video_id': unique_id,
            'download_url': f'/download_video/{unique_id}',
            'stats': stats,
            'message': f'Video processed with all features! Ball: {stats["ball_detections"]}, Court: {stats["court_detections"]}, Pose: {stats["pose_detections"]}'
        })
        
    except Exception as e:
        import traceback
        print(f"Full error: {traceback.format_exc()}")
        if 'input_path' in locals() and os.path.exists(input_path):
            os.remove(input_path)
        if 'output_path' in locals() and os.path.exists(output_path):
            os.remove(output_path)
        return jsonify({'error': str(e)}), 500

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/download_video/<video_id>', methods=['GET'])
def download_video(video_id):
    """Download the processed video"""
    try:
        output_filename = f"processed_{video_id}.mp4"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        if not os.path.exists(output_path):
            return jsonify({'error': 'Video not found'}), 404
        
        return send_file(
            output_path,
            as_attachment=True,
            download_name=f"tennis_analysis_{video_id}.mp4",
            mimetype='video/mp4'
        )
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/analyze_shot', methods=['POST'])
def analyze_shot():
    """Analyze a batch of frames after a stroke to determine shot outcome.
    Expects JSON with:
      - frames: array of base64-encoded frames (post-stroke, capturing ball flight)
      - stroke_type: string (forehand, backhand, serve, etc.)
      - court_calibration: optional cached court homography matrix
    Returns:
      - ball_trajectory: array of {x, y, frame_index} detections
      - court_detected: boolean
      - shot_outcome: {in_court, landed_position, estimated_speed_mph, confidence}
    """
    try:
        data = request.json
        frames_b64 = data.get('frames', [])
        stroke_type = data.get('stroke_type', 'unknown')
        cached_court = data.get('court_calibration')

        if len(frames_b64) < 3:
            return jsonify({'error': 'Need at least 3 frames'}), 400

        # Decode frames
        frames = []
        for fb64 in frames_b64:
            frame = base64_to_cv2(fb64)
            if frame is not None:
                frames.append(frame)

        if len(frames) < 3:
            return jsonify({'error': 'Could not decode enough frames'}), 400

        # Run ball detection on all frames
        ball_track = ball_detector.infer_model(frames)

        # Run court detection on first frame (court doesn't move)
        court_matrix = None
        court_kps = None
        if cached_court is not None:
            court_matrix = np.array(cached_court, dtype=np.float64)
        else:
            try:
                matrices, keypoints = court_detector.infer_model([frames[0]])
                court_matrix = matrices[0]
                court_kps = keypoints[0]
            except Exception as e:
                print(f"Court detection failed: {e}")

        # Build ball trajectory
        trajectory = []
        for i, (bx, by) in enumerate(ball_track):
            if bx is not None and by is not None:
                trajectory.append({
                    'x': float(bx),
                    'y': float(by),
                    'frame_index': i
                })

        # Classify shot outcome from trajectory
        shot_outcome = classify_shot_outcome(
            trajectory, court_matrix, court_reference, frames[0].shape
        )

        # Format court keypoints for caching
        formatted_court = None
        if court_matrix is not None:
            formatted_court = court_matrix.tolist()

        return jsonify({
            'ball_trajectory': trajectory,
            'ball_detection_rate': len(trajectory) / max(len(ball_track), 1),
            'court_detected': court_matrix is not None,
            'court_calibration': formatted_court,
            'shot_outcome': shot_outcome,
            'frames_analyzed': len(frames),
            'stroke_type': stroke_type
        })

    except Exception as e:
        import traceback
        print(f"Shot analysis error: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500


def classify_shot_outcome(trajectory, court_matrix, court_ref, frame_shape):
    """Determine if a shot landed in or out based on ball trajectory and court geometry."""
    result = {
        'in_court': None,
        'landed_position': None,
        'ball_direction': None,
        'net_clearance': None,
        'confidence': 0.0
    }

    if len(trajectory) < 3:
        result['confidence'] = 0.0
        return result

    # Analyze ball direction (is it moving away from player?)
    first_detections = trajectory[:min(5, len(trajectory))]
    last_detections = trajectory[max(0, len(trajectory)-5):]

    avg_start_y = sum(d['y'] for d in first_detections) / len(first_detections)
    avg_end_y = sum(d['y'] for d in last_detections) / len(last_detections)

    # In most camera setups, ball moving "up" in frame = traveling toward far court
    # Ball moving "down" = traveling toward camera/near court
    y_delta = avg_end_y - avg_start_y
    result['ball_direction'] = 'away' if y_delta < -20 else 'toward' if y_delta > 20 else 'lateral'

    # Estimate if ball crossed the net (approximate: net is typically at ~40-50% of frame height)
    frame_height = frame_shape[0]
    net_y = frame_height * 0.45  # Approximate net position

    # Check if any detection crosses the net region
    crossed_net = False
    for det in trajectory:
        if det['y'] < net_y and avg_start_y > net_y:
            crossed_net = True
            break
    result['net_clearance'] = crossed_net

    # If we have court homography, determine real-world landing position
    if court_matrix is not None and len(last_detections) > 0:
        try:
            last_ball = last_detections[-1]
            ball_px = np.array([[[last_ball['x'], last_ball['y']]]], dtype=np.float64)

            # Transform pixel coordinates to court coordinates (meters)
            inv_matrix = cv2.invert(court_matrix)[1]
            if inv_matrix is not None:
                court_pos = cv2.perspectiveTransform(ball_px, inv_matrix)
                cx, cy = float(court_pos[0][0][0]), float(court_pos[0][0][1])
                result['landed_position'] = {'x_meters': cx, 'y_meters': cy}

                # Tennis court: 23.77m long, singles 8.23m wide, doubles 10.97m wide
                in_length = 0 <= cy <= 23.77
                in_width = -5.485 <= cx <= 5.485  # doubles width / 2
                result['in_court'] = in_length and in_width
                result['confidence'] = 0.6  # Moderate confidence with homography
            else:
                result['confidence'] = 0.2
        except Exception as e:
            print(f"Court transform error: {e}")
            result['confidence'] = 0.2
    else:
        # Without court detection, use heuristic: ball detected in reasonable area
        result['confidence'] = 0.3
        if crossed_net and result['ball_direction'] == 'away':
            result['in_court'] = True  # Best guess

    return result


@app.route('/health', methods=['GET'])
def health_check():
    """Comprehensive health check"""
    return jsonify({
        'status': 'healthy',
        'device': device,
        'ball_model_loaded': ball_detector.model is not None,
        'court_model_loaded': court_detector.model is not None,
        'features': ['ball_detection', 'court_detection', 'pose_detection']
    })

if __name__ == '__main__':
    print(f"Starting enhanced tennis analysis API on device: {device}")
    print("Features: Ball Detection + Court Detection + Pose Detection")
    from werkzeug.serving import WSGIRequestHandler
    WSGIRequestHandler.timeout = 600
    app.run(host='0.0.0.0', port=5001, debug=True)