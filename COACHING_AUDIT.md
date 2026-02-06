# TechniqueAI Coaching Pipeline Audit

## Executive Summary

The current system has **sophisticated architecture** but **unvalidated fundamentals**. The code is well-structured with phase detection, kinetic chain analysis, and professional references - but these are built on fabricated thresholds and unused components.

**Critical Finding:** The motion-sequence-analyzer.js (851 lines of phase-by-phase analysis) is **never called** from the main analysis flow.

---

## Architecture Analysis

### Data Flow
```
MediaPipe Pose (33 landmarks @ 30fps)
        ↓
    PhysicsAnalyzer
    ├── Wrist velocity (normalized 0-1)
    ├── Acceleration
    ├── Body rotation (shoulder angle delta)
    └── Swing path
        ↓
    StrokeClassifier
    ├── isValidStroke() → velocity > 0.025 && acceleration > 0.008
    ├── classifyStroke() → forehand/backhand/serve/volley
    └── assessStrokeQuality() → weighted score
        ↓
    EnhancedTennisAnalyzer
    ├── buildStrokeData() → contact frame + metrics
    ├── proReferences.compareWithProfessional()
    └── coachingOrchestrator.analyzeStroke()
        ↓
    GPTVoiceCoach
    └── formatEnhancedStrokePrompt() → GPT-4o
```

---

## Critical Issues

### 1. Stroke Detection is Unreliable

**Current Logic:**
```javascript
// stroke-classifier.js:448
isValidStroke(velocity, acceleration) {
    return velocity.magnitude > 0.025 && acceleration.magnitude > 0.008;
}
```

**Problems:**
- Single-frame threshold check (no pattern validation)
- Will trigger on any fast arm movement
- Will miss slow, technically correct strokes
- No validation of stroke shape/phases

**Evidence Needed:** What velocity values are we actually seeing? Are pros at 0.055 and beginners at 0.025?

---

### 2. Professional Reference Data is Fabricated

**Current State (professional-references.js:76-88):**
```javascript
'Forehand': {
    professional: {
        averageVelocity: 0.055,      // ← Made up
        peakVelocity: 0.075,          // ← Made up
        averageAcceleration: 0.018,   // ← Made up
        averageRotation: 25,          // ← Made up
        ...
    }
}
```

**Problems:**
- No citation or source for any values
- "Professional" metrics not derived from actual pro footage
- Swing path generation is mathematical formulas, not real motion capture

**Impact:** Skill level estimation, percentile ranking, and "pro comparison" features are all based on fiction.

---

### 3. Motion Sequence Analyzer is Dead Code

**File:** `motion-sequence-analyzer.js` (851 lines)
**Status:** Never called from main analysis flow

**Contains:**
- Phase-by-phase analysis (preparation, loading, acceleration, contact, follow-through)
- Split step detection
- Weight transfer analysis
- Hip-shoulder separation tracking
- Kinetic chain analysis

**Why it matters:** This is exactly what we need for proper biomechanical coaching, but it's not being used.

---

### 4. Quality Scoring is Arbitrary

**Current Weights (stroke-classifier.js:19-24):**
```javascript
qualityWeights: {
    velocity: 0.35,      // Why 35%?
    acceleration: 0.25,  // Why 25%?
    rotation: 0.20,      // Why 20%?
    smoothness: 0.20     // Why 20%?
}
```

**Problems:**
- Weights have no biomechanical basis
- A slow, smooth stroke could score higher than a fast, slightly jerky one
- No consideration of contact point, preparation, or follow-through

---

### 5. No Camera Calibration

**Problem:** All measurements are in normalized coordinates (0-1) relative to camera frame.

**Implications:**
- Standing closer = appears faster (higher velocity)
- Different body proportions = different metrics
- Camera angle affects all measurements

**Missing:**
- User height/arm length calibration
- Camera distance estimation
- Perspective correction

---

### 6. Coaching Decision Tree Thresholds Unvalidated

**Example (tennis_coaching_tree.json:33-39):**
```json
"latePreparation": {
    "detection": {
        "primary": {
            "preparationTime": { "min": 0.60 }
        }
    }
}
```

**Questions:**
- How was 0.60 determined?
- What does "preparationTime" actually measure in the code?
- Is this threshold correct for beginners vs advanced?

---

### 7. Stroke Classification is Simplistic

**Current Logic (stroke-classifier.js:50-65):**
```javascript
classifyStroke(velocity, acceleration, rotation, verticalMotion) {
    if (this.isServe(velocity, verticalMotion)) return 'Serve';
    else if (this.isOverhead(velocity, verticalMotion)) return 'Overhead';
    else if (this.isVolley(velocity, verticalMotion)) return 'Volley';
    else if (this.isForehand(rotation, velocity)) return 'Forehand';
    else if (this.isBackhand(rotation, velocity)) return 'Backhand';
    else return 'Groundstroke';
}
```

**Problems:**
- Rotation > 15° = Forehand, Rotation < -15° = Backhand (too simplistic)
- Doesn't account for:
  - User stance (open vs closed)
  - Camera angle
  - Left-handed players
  - Two-handed backhands

---

## What's Actually Working

### Strengths:

1. **Good Data Collection** - PhysicsAnalyzer properly tracks 30 frames of pose history
2. **Solid Architecture** - Clean separation of concerns, well-structured code
3. **Coaching Decision Tree** - Good logic for prioritizing issues and cooldowns
4. **GPT Integration** - Proper prompt engineering with context

### Partially Working:

1. **Phase Detection** - Logic exists but isn't used
2. **Kinetic Chain Analysis** - Code exists but isn't called
3. **Professional References** - Structure is good, data is bad

---

## Metrics Currently Tracked

| Metric | Source | Reliability | Notes |
|--------|--------|-------------|-------|
| Wrist Velocity | PhysicsAnalyzer | Medium | Normalized, uncalibrated |
| Acceleration | PhysicsAnalyzer | Medium | Derived from velocity |
| Body Rotation | PhysicsAnalyzer | Medium | Shoulder angle delta |
| Elbow Angle | EnhancedTennisAnalyzer | High | Direct from landmarks |
| Hip-Shoulder Sep | EnhancedTennisAnalyzer | High | Direct from landmarks |
| Knee Bend | EnhancedTennisAnalyzer | High | Direct from landmarks |
| Stance | EnhancedTennisAnalyzer | Medium | Heuristic detection |
| Weight Transfer | EnhancedTennisAnalyzer | Low | Very rough estimate |
| Smoothness | StrokeClassifier | Medium | Path curvature analysis |
| Contact Point | EnhancedTennisAnalyzer | High | Wrist position at peak |

---

## Metrics We Should Track (But Don't)

| Metric | Importance | Why |
|--------|------------|-----|
| Preparation Timing | Critical | When shoulder turn starts relative to ball |
| Racket Lag | High | Racket behind wrist at contact |
| Follow-Through Completion | High | Did swing finish properly |
| Split Step | High | Movement quality indicator |
| Recovery Position | Medium | Post-shot positioning |
| Head Stability | Medium | Eye on ball indicator |

---

## Recommendations

### Phase 2: Foundation Fixes

1. **Activate Motion Sequence Analyzer**
   - Wire it into the main analysis flow
   - Use phase detection to validate strokes
   - Extract phase-specific metrics

2. **Build Stroke Validation**
   - Valid stroke = proper phase sequence (not just velocity spike)
   - Reject movements that don't show preparation → contact → follow-through

3. **Define Biomechanical Checkpoints**
   - Based on tennis coaching science, not guesses
   - Focus on measurable, detectable issues
   - Document the "why" for each threshold

4. **Create Calibration System**
   - Record user doing baseline swings
   - Establish personal metric ranges
   - Account for camera setup

5. **Add Diagnostic Logging**
   - Log raw metrics for every detected stroke
   - Visualize metric distributions
   - Identify actual value ranges

---

## Next Steps

1. **Immediate:** Wire motion-sequence-analyzer.js into main flow
2. **Short-term:** Define biomechanical checkpoint system
3. **Medium-term:** Build calibration flow
4. **Longer-term:** Validate with real tennis footage
