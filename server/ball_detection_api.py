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

# Initialize models
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
ball_detector = BallDetector('ball_Detection_weights.pt', device)
court_detector = CourtDetectorNet('model_tennis_court_det.pt', device)  # Add court model path
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