# Comprehensive Calibration System - Status Report

## System Components

| Component | Status | Model | Notes |
|-----------|--------|-------|-------|
| Ball Tracking | ✅ Working | `model_best.pt` (TrackNet) | 65-70% detection rate on test video |
| Court Detection (Auto) | ⚠️ Limited | `model_tennis_court_det.pt` | Requires broadcast-style footage |
| Court Detection (Manual) | ✅ Working | N/A | 4-point calibration tool |
| Bounce Detection | ❌ Disabled | `ctb_regr_bounce.cbm` | CatBoost not compatible with Python 3.14 |
| Pose Detection | ✅ Working | MediaPipe Heavy | Body-relative normalization implemented |
| Shot Outcome Classification | ✅ Working | Uses homography | Determines if shots land in/out |

## Key Features

### 1. Body-Relative Normalization
- **Old**: Raw pixel velocities (camera-dependent)
- **New**: Velocities normalized to torso length (camera-independent)
- **Unit**: "torso-lengths per second" - comparable across different videos

### 2. Camera Angle Detection
- Automatically detects viewing angle from shoulder positions
- Filters out unsuitable angles (extreme side views)
- Validates measurements are from usable footage

### 3. Manual Court Calibration (NEW)
- User clicks 4 corners of the court
- System computes homography to real-world coordinates
- Works with any camera angle where court is visible
- Calibration can be saved and reused for same camera position

### 4. Shot Outcome Tracking
- Segments video into individual shots based on ball trajectory
- Determines landing position in real-world meters
- Classifies outcome: in/out/unknown
- **Only successful shots (landed in) count for calibration benchmarks**

### 5. Ball Speed in Real Units
- Converts pixel movement to meters using court homography
- Reports ball speed in m/s and mph
- Key metric for shot quality assessment

## Recommended Workflow

### For Amateur/Phone-Recorded Tennis Video

**Step 1: Create manual court calibration**
```bash
cd server
python3 calibrate_court_manual.py ../calibration_videos/your_video.mp4
```
- Click the 4 corners of the singles court in order:
  1. YOUR baseline - LEFT corner
  2. YOUR baseline - RIGHT corner
  3. FAR baseline - RIGHT corner
  4. FAR baseline - LEFT corner
- Press ENTER to confirm, ESC to cancel, R to reset
- Outputs `your_video_court_calibration.json`

**Step 2: Run comprehensive calibration with manual court calibration**
```bash
source venv/bin/activate
python3 calibrate_comprehensive.py \
  --video ../calibration_videos/your_video.mp4 \
  --court-calibration your_video_court_calibration.json \
  --output your_calibration.json
```

This provides:
- ✅ Body-relative velocity (torso-lengths/sec)
- ✅ Ball speed (m/s, mph)
- ✅ Shot outcomes (in/out)
- ✅ Landing positions in meters
- ✅ Elbow angles, hip-shoulder separation, knee bend
- ✅ Camera angle validation

### For Broadcast Tennis Footage (Full Auto)

If using broadcast footage with full court visible:
```bash
python3 calibrate_comprehensive.py \
  --video broadcast.mp4 \
  --ball-model ../model_weights/model_best.pt \
  --court-model ../model_weights/model_tennis_court_det.pt \
  --output full_calibration.json
```

## Addressing the 3.0 NTRP > 5.0 NTRP Anomaly

The original calibration showed intermediate players (3.0 NTRP) with higher acceleration than advanced players (5.0 NTRP). This was caused by:

1. **Wild swings vs controlled power**: Less skilled players swing wildly, producing high acceleration on misses
2. **No outcome filtering**: Failed shots were included in calibration
3. **Camera differences**: Different videos had different camera setups

The new system addresses these through:
1. **Body-relative normalization**: Comparable across camera setups
2. **Outcome filtering**: Only successful shots (landed in) count for calibration
3. **Camera validation**: Unsuitable viewing angles are flagged
4. **Manual calibration**: Works with any amateur footage where court is visible

## Output Structure

```json
{
  "detection_stats": {
    "ball_detection_rate": 0.692,
    "court_detection_rate": 1.0,
    "court_calibration_source": "manual",  // or "automatic"
    "shots_analyzed": 2
  },
  "summary": {
    "total_shots": 2,
    "successful_shots": 2,
    "success_rate": 1.0,
    "successful_shots_only": {
      "velocity_normalized": { "mean": 114.87, "p25": 82.73, "p75": 147.01 },
      "ball_speed_mph": { "mean": 50.0, ... }
    }
  },
  "shots": [
    {
      "stroke_type": "Forehand",
      "outcome": "in",
      "ball_speed_mph": 50.0,
      "landing_position_meters": [3.35, 8.21],
      "velocity_normalized": 179.14,
      "hip_shoulder_separation": 38.83,
      "knee_bend": 169.59
    }
  ]
}
```

## Known Limitations

1. **Bounce detection disabled**: CatBoost requires Python ≤3.11
2. **Ball tracking accuracy**: ~65-70% detection rate means some shots may be missed
3. **Manual calibration required**: For amateur footage, automatic court detection usually fails
4. **Fixed camera assumption**: Manual calibration assumes camera doesn't move during video

## Files

| File | Purpose |
|------|---------|
| `calibrate_comprehensive.py` | Main calibration script |
| `calibrate_court_manual.py` | Interactive 4-point court calibration |
| `court_detector_robust.py` | Multi-strategy court detection (fallback) |
| `test_court_calibration.json` | Sample manual calibration file |
| `test_with_manual_calibration.json` | Sample output with full metrics |
