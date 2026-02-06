# TechniqueAI Server - Ball & Court Detection Backend

Python backend providing ball tracking, court detection, and bounce prediction for tennis video analysis.

## Features

- **Ball Detection** - TrackNet neural network for tracking tennis ball
- **Court Detection** - 14-point court keypoint detection
- **Bounce Detection** - CatBoost model predicting ball bounces
- **Person Detection** - Player tracking on court
- **Video Processing** - Full video analysis pipeline with overlays

## Requirements

**Note:** Model weights need to be downloaded separately:
- `ball_detection_weights.pt` - TrackNet ball detection model
- `model_tennis_court_det.pt` - Court keypoint detection model

See the original repos for weights:
- Ball detection: https://github.com/yastrebksv/TrackNet
- Court detection: https://github.com/yastrebksv/TennisCourtDetector

## Setup

```bash
cd server
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Usage

### Flask API (real-time detection)

```bash
python ball_detection_api.py
```

Endpoints:
- `POST /detect_ball` - Basic ball detection
- `POST /detect_ball_enhanced` - Ball detection with court context
- `POST /upload_video` - Process full video
- `GET /download_video/<id>` - Download processed video
- `GET /health` - Health check

### CLI Video Processing

```bash
python main.py \
  --path_ball_track_model ball_detection_weights.pt \
  --path_court_model model_tennis_court_det.pt \
  --path_bounce_model ctb_regr_bounce.cbm \
  --path_input_video input.mp4 \
  --path_output_video output.mp4
```

## Directory Structure

```
server/
├── ball_detection/      # Ball tracking neural network
│   ├── ball_detector.py
│   ├── bounce_detector.py
│   ├── court_detection_net.py
│   ├── court_reference.py
│   └── tracknet.py
├── court_detection/     # Court keypoint detection
│   ├── main.py
│   ├── tracknet.py
│   ├── dataset.py
│   └── utils.py
├── demos/               # Demo GIFs
├── ball_detection_api.py  # Flask API
├── main.py              # CLI video processor
├── person_detector.py   # Player detection
├── ctb_regr_bounce.cbm  # Bounce prediction model
└── requirements.txt
```

## Integration with Frontend

The Flask API can be called from the main TechniqueAI app to add ball/court detection overlays to the video analysis. Currently requires 1280x720 video resolution for optimal court detection.
