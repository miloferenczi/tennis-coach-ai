# TechniqueAI Calibration & Quality System - Comprehensive Plan

## Problem Statement

Current calibration measured "how fast people at different levels move" but not "what makes strokes effective." The data shows anomalies (3.0 NTRP acceleration > 5.0 NTRP) because:

1. **No shot outcome tracking** - A wild swing that goes out registers the same as a controlled winner
2. **No camera normalization** - Different camera angles/distances give different velocity values
3. **No validation** - Numbers were accepted without sanity checks
4. **Meaningless units** - "9.25 normalized units/sec" tells a player nothing

## What Quality Coaching Requires

### Shot Quality = Outcome + Technique Efficiency

A good shot is defined by:
- **Outcome**: Did it go in? Where did it land? How fast? What spin?
- **Technique**: Did the body mechanics efficiently produce that outcome?

### Real Coaching Feedback Examples
- "That forehand landed 3 feet inside the baseline with good pace" ✓
- "Your wrist velocity was 9.25 normalized units per second" ✗
- "You're losing power because your elbow collapses before contact - that's why your shots are landing short" ✓

---

## Phase 1: Camera Normalization Strategy

### Problem
Different camera setups produce different raw values:
- Side view vs. behind vs. elevated
- Distance from player
- Resolution, lens distortion
- Player size in frame

### Solution: Body-Relative Measurements

Use player's own body as the scale reference:

```
Body Reference Points (from MediaPipe):
- Torso length = distance(shoulder_midpoint, hip_midpoint)
- Arm span = distance(left_wrist, right_wrist) with arms extended
- Leg length = distance(hip, ankle)

Normalized Velocity = raw_pixel_velocity / torso_length_pixels * fps

Result: "Arm moved 2.3 torso-lengths per second"
```

### Camera Angle Detection

Detect viewing angle from pose geometry:
- **Side view**: shoulders nearly equal Y, large X difference
- **Behind view**: shoulders nearly equal X, small Y difference
- **Angle estimate**: atan2(shoulder_dx, shoulder_dy)

Flag videos where camera angle is too extreme for reliable measurement.

### Validation Checks
- Player height should be consistent across frames (unless moving toward/away from camera)
- Body proportions should match human norms (arm/torso ratio ~1.0-1.2)
- Reject frames where pose confidence is low

---

## Phase 2: Integrated Shot Analysis Pipeline

### Components Required

1. **Pose Detection** (MediaPipe) - Body mechanics
2. **Ball Tracking** (TrackNet) - Ball position each frame
3. **Court Detection** (CourtDetectorNet) - Court boundaries + homography
4. **Shot Segmentation** - Detect start/end of each shot
5. **Outcome Classification** - In/out, placement, speed

### Shot Segmentation Algorithm

```
For each frame:
  1. Track ball position
  2. Detect ball direction change (indicates contact)
  3. Track ball until:
     - Bounces (sudden Y velocity change)
     - Goes out of frame
     - Another contact detected

Shot = {
  contact_frame: int,
  contact_position: (x, y),  # in video coordinates
  landing_frame: int,
  landing_position: (x, y),  # in video coordinates
  landing_court_position: (x, y),  # in real-world court coordinates
  outcome: 'in' | 'out' | 'net' | 'unknown',
  ball_speed_mps: float,  # meters per second
  pose_at_contact: {...},  # full pose data
  stroke_type: 'forehand' | 'backhand' | 'serve' | etc
}
```

### Court Coordinate Transformation

Using the homography matrix from court detection:
```python
# Transform ball position to court reference coordinates
court_pos = cv2.perspectiveTransform(ball_pos, homography_matrix)

# Convert to real-world meters
COURT_LENGTH_M = 23.77
COURT_WIDTH_M = 10.97
COURT_REF_HEIGHT = 2408
COURT_REF_WIDTH = 1117

x_meters = court_pos[0] / COURT_REF_WIDTH * COURT_WIDTH_M
y_meters = court_pos[1] / COURT_REF_HEIGHT * COURT_LENGTH_M

# Determine in/out
is_in = (0 <= x_meters <= COURT_WIDTH_M) and (0 <= y_meters <= COURT_LENGTH_M/2)
```

### Ball Speed Calculation

```python
# Between frames
distance_pixels = sqrt((x2-x1)^2 + (y2-y1)^2)

# Convert to meters using court scale
pixels_per_meter = court_width_pixels / 10.97

distance_meters = distance_pixels / pixels_per_meter
time_seconds = 1 / fps

ball_speed_mps = distance_meters / time_seconds
ball_speed_mph = ball_speed_mps * 2.237
```

---

## Phase 3: Calibration Data Validation

### Sanity Checks

1. **Monotonic skill progression**: Metrics should generally increase with skill level
   - Pro velocity > Advanced > Intermediate > Beginner
   - If not, investigate the specific video

2. **Outcome filtering**: Only include shots that landed IN
   - Current data includes errors, shanks, wild misses
   - These inflate acceleration numbers for lower-skill players

3. **Consistency check**: Standard deviation should be reasonable
   - Very high std suggests mixed quality or measurement issues

4. **Cross-reference with research**: Published biomechanics studies show:
   - Pro forehand racquet speed: 70-90 mph (31-40 m/s)
   - Pro serve speed: 110-140 mph (49-63 m/s)
   - Our body-relative metrics should correlate

### Filtering Criteria

For calibration, only include shots where:
- Ball tracking confidence > 80%
- Shot landed in the court
- Pose detection confidence > 80% at contact frame
- Camera angle within acceptable range (not extreme side/overhead view)
- Player fully visible in frame

---

## Phase 4: Revised Metrics System

### Primary Metrics (Outcome-Based)

| Metric | Unit | How Measured |
|--------|------|--------------|
| Ball Speed | mph / m/s | Ball tracking + court scale |
| Shot Depth | % of court | Landing position / service line |
| Placement Accuracy | feet from target | Landing vs intended zone |
| Consistency | % in | Successful shots / total attempts |

### Secondary Metrics (Technique Efficiency)

| Metric | Unit | How Measured |
|--------|------|--------------|
| Racquet Speed | body-lengths/sec | Wrist velocity / torso length |
| Hip-Shoulder Separation | degrees | Angle between hip and shoulder lines |
| Elbow Extension | degrees | Angle at elbow at contact |
| Kinetic Chain Timing | ms | Sequence of hip→shoulder→elbow→wrist |
| Power Efficiency | ball_speed / racquet_effort | Outcome per unit of body movement |

### Coaching Value

**Power Efficiency** is key: A player with lower racquet speed but higher ball speed is more efficient. A player with high racquet speed but low ball speed is wasting energy (poor contact, timing issues).

---

## Phase 5: Implementation Tasks

### Task 1: Build Integrated Analysis Script
Create `server/calibrate_with_outcomes.py` that:
- Runs pose detection
- Runs ball tracking
- Runs court detection
- Segments individual shots
- Classifies outcomes (in/out/net)
- Calculates body-relative metrics
- Outputs comprehensive shot data

### Task 2: Re-Calibrate with Filtered Data
- Re-process calibration videos with outcome filtering
- Only include successful (in) shots
- Validate metrics increase with skill level

### Task 3: Camera Normalization Module
- Add body-relative scaling to all metrics
- Detect and flag problematic camera angles
- Output normalized, comparable values

### Task 4: Real-World Metric Conversion
- Convert to meaningful units (mph, meters, degrees)
- Add context ("your shot was 45 mph, pros hit 65-80 mph")

### Task 5: Update Frontend Integration
- Update coaching feedback to reference outcomes
- "Your last 5 forehands: 4 in, 1 out. The out shot had 20% less hip rotation."

---

## Success Criteria

1. **Calibration data makes sense**: Higher skill = better metrics (monotonic)
2. **Metrics correlate with outcomes**: Higher technique scores = more shots in
3. **Feedback is actionable**: User knows what to fix and why
4. **Cross-video consistency**: Same player, different videos = similar metrics

---

## Required Model Weights

The server needs these pretrained models:
- `ball_detection_weights.pt` - TrackNet for ball tracking
- `model_tennis_court_det.pt` - Court keypoint detection
- `ctb_regr_bounce.cbm` - Bounce detection (optional)

Download from:
- https://github.com/yastrebksv/TrackNet
- https://github.com/yastrebksv/TennisCourtDetector

---

## Immediate Next Steps

1. Check if model weights are available
2. Build integrated calibration script
3. Test on one video to validate pipeline
4. Re-run calibration with outcome filtering
5. Validate results make sense
