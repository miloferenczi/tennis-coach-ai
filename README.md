# ACE - AI Tennis Coach

ACE is a real-time AI tennis coaching app that runs entirely in the browser. Point your phone camera at yourself on a tennis court and get instant biomechanical analysis, voice coaching, and session-over-session improvement tracking.

## How It Works

```
Camera → MediaPipe Pose (33 landmarks) → Signal Filtering → Physics Analysis
  → Stroke Classification → Phase Detection → Biomechanical Evaluation
  → Coaching Decision Tree → GPT-4o Realtime Voice Feedback

Camera → Ball Color Detection → Trajectory Analysis → Shot Outcome
Camera → Gemini 2.5 Flash → Scene Understanding → Rally Tracking
```

No backend required for core functionality. All pose estimation, stroke analysis, and biomechanics run client-side. Voice coaching requires an OpenAI API key. Scene analysis requires a Google Gemini API key. Both are optional.

## Features

### Stroke Detection & Classification
- Detects forehand, backhand, serve, volley, and overhead strokes in real-time
- Automatic handedness detection (left/right) from wrist speed comparison over 30 frames
- Handedness-aware stroke classification with rotation sign flipping

### Biomechanical Analysis
- **Phase detection**: Preparation, loading, acceleration, contact, follow-through — identified per stroke with frame-level precision
- **Per-phase evaluation**: Each phase scored against biomechanical checkpoints (arm preparation, hip-shoulder separation, elbow extension, weight transfer, follow-through completion)
- **Kinetic chain analysis**: Evaluates sequential activation from ground up (legs → hips → torso → arm)
- **Quality scoring**: 60% biomechanical form + 40% power (velocity + acceleration)
- **Body-relative normalization**: All velocities measured in torso-lengths/sec after a 30-frame calibration period, making analysis camera-distance independent

### Footwork Analysis
- Stance detection: closed, neutral, semi-open, open
- Base width ratio (relative to shoulder width)
- Weight distribution tracking per phase via hip-midpoint center-of-mass proxy
- Weight transfer direction and magnitude
- Step-in patterns and recovery to ready position
- Composite footwork score (0-100)
- Faults: narrow base, no step-in, poor recovery, wrong stance for stroke type

### Serve Analysis
- Trophy position evaluation (elbow angle, shoulder tilt, knee bend, back arch)
- Leg drive measurement (knee bend change + hip vertical displacement)
- Toss arm assessment (arm straightness, height above shoulder)
- Contact height analysis (wrist position relative to nose)
- Trunk rotation and follow-through tracking
- Weighted serve score (0-100): trophy 25%, leg drive 20%, contact height 20%, shoulder tilt 10%, toss arm 10%, trunk rotation 10%, follow-through 5%

### Voice Coaching (GPT-4o Realtime)
- Real-time voice feedback via WebRTC with sub-second latency
- Sandwich coaching: acknowledge strength, give one correction, encourage
- Coaching decision tree with priority-ranked faults (10 = foundation, 7-9 = power, 4-6 = refinement)
- Strength detection: identifies what the player is doing well for positive reinforcement
- Fatigue awareness: adjusts coaching when quality scores decline
- Adapts to player skill level and session goals
- Falls back to browser speech synthesis when no API key provided

### Ball Tracking
- Browser-based ball color detection at 160x90 resolution
- Trajectory tracking and shot outcome classification (in/out, net clearance)
- Calibrateable ball color detection for different lighting conditions
- No server required

### Scene Analysis (Gemini 2.5 Flash)
- Periodic camera frame analysis (3 frames at 320x180 every 5 seconds)
- Scene state detection: serving, rallying, between points, warmup, idle
- Shot context classification: serve, return, rally groundstroke, approach, volley, overhead
- Ball visibility, court side (deuce/ad), and player count detection
- State machine with hysteresis to prevent flicker between states
- Cost: ~$0.07 per 30-minute session
- Fully optional — everything works without a Gemini key

### Rally Tracking
- Point lifecycle management: serve points vs feed/drill rallies
- Per-rally stroke counting and quality tracking
- Session statistics: total rallies, average length, longest rally, serve percentage
- Rally context injected into GPT prompts ("this is stroke #3 of a serve point")
- Rally indicator in status bar showing current game state

### Instant Replay
- Records last 45 frames of landmarks per stroke (max 30 replays in memory)
- Phase-colored skeleton rendering with fault highlights and wrist swing trail
- Playback at 0.25x, 0.5x, or 1x speed with looping, pause, and frame-step
- Replay button appears for 5 seconds after each stroke
- Stroke review grid in session summary (quality-colored tiles, click to replay)

### Cross-Session Improvement Tracking
- Per-stroke-type metric history (quality, form, power, rotation, hip separation, elbow angle, smoothness)
- Fault history with resolution detection (tracks when faults stop appearing)
- GPT-authored coaching plans with up to 3 focus areas, specific drills, and measurable targets
- Plan progress tracked across sessions with target comparisons shown per stroke
- Session-end plan synthesis via GPT with JSON structured output

### Player Profiles
- Persistent player profile with skill level progression
- Session history and milestone tracking
- Strongest stroke identification
- Weakness trending and improvement detection
- Returning player context provided to coach for personalized greetings

### Coach's Notebook
- GPT synthesizes session notes at end of each session
- Notes persist across sessions for coaching continuity
- Coach references past observations naturally in conversation

### Additional Features
- **Ghost overlay**: Compare your form against reference poses
- **Challenge mode**: Structured challenges with scoring
- **Drill mode**: Focused drills for specific skills (footwork, serve trophy position, serve leg drive)
- **Diagnostic logger**: Debug output for pose data quality and analysis pipeline
- **Calibration tool**: Threshold calibration from recorded video
- **PWA support**: Installable as a home screen app (manifest.json + service worker)
- **Video analysis mode**: Upload and analyze recorded video files

## Architecture

### Frontend (Single-Page PWA)
- `index.html` — Main app (~6000 lines): TennisAI class, UI, onboarding, session management
- 30 JavaScript modules in `/js/`:

| Module | Purpose |
|--------|---------|
| `signal-filters.js` | One Euro filter + bone length constraints for pose data quality |
| `kalman-velocity-estimator.js` | Kalman filter for smooth velocity estimation |
| `physics-analyzer.js` | Velocity, acceleration, rotation, smoothness from pose landmarks |
| `stroke-classifier.js` | Classifies stroke type from motion characteristics |
| `phase-detector.js` | Identifies swing phases (prep/load/accel/contact/follow-through) |
| `kinetic-chain-analyzer.js` | Evaluates sequential body segment activation |
| `motion-sequence-analyzer.js` | Phase-level biomechanical metrics and timing |
| `biomechanical-checkpoints.js` | Per-phase fault detection against technique standards |
| `footwork-analyzer.js` | Stance, base width, weight transfer, steps, recovery |
| `serve-analyzer.js` | Serve-specific biomechanics (trophy, leg drive, contact height) |
| `enhanced-tennis-analyzer.js` | Main orchestrator: wires all analyzers together |
| `coaching-orchestrator.js` | Decision tree traversal, strength detection, feedback timing |
| `gpt-voice-coach.js` | GPT-4o Realtime WebRTC connection, prompt construction |
| `coach-notebook.js` | Persistent coaching notes across sessions |
| `improvement-tracker.js` | Cross-session metric tracking and coaching plan management |
| `player-profile.js` | Persistent player identity, skill progression, milestones |
| `session-storage.js` | Session persistence, stroke records, summary generation |
| `professional-references.js` | Reference data by NTRP skill level for comparison |
| `ball-tracking-client.js` | Browser-based ball color detection and trajectory tracking |
| `scene-analyzer.js` | Gemini 2.5 Flash multimodal scene analysis |
| `rally-tracker.js` | Rally lifecycle, point boundaries, session rally stats |
| `stroke-replay.js` | Instant replay with phase-colored skeleton |
| `ghost-overlay.js` | Reference pose overlay for form comparison |
| `challenge-mode.js` | Structured challenges with scoring |
| `drill-mode.js` | Focused skill drills |
| `calibration-tool.js` | Threshold calibration from video |
| `threshold-updater.js` | Dynamic threshold adjustment |
| `diagnostic-logger.js` | Debug logging for analysis pipeline |
| `sport-loader.js` | Multi-sport config loader (currently tennis) |
| `video-analyzer.js` | Recorded video upload and analysis |

### Backend (Development/Calibration Only)
- `server/ball_detection_api.py` — Flask server on port 5001 for calibration workflows
- Model weights in `/model_weights/` (TrackNet ball detection, court detection)
- Not required for normal app usage

### Configuration
- `sports/tennis/config.json` — Tennis-specific parameters
- `tennis_coaching_tree.json` — Coaching decision tree with priority-ranked issues and drills
- `manifest.json` + `sw.js` — PWA configuration

## Getting Started

1. Serve `index.html` over HTTPS (required for camera access):
   ```bash
   # Using Python
   python -m http.server 8443

   # Or any static file server
   npx serve .
   ```

2. Open on your phone browser and go through onboarding:
   - **OpenAI API key** (optional): Enables real-time voice coaching
   - **Gemini API key** (optional): Enables scene analysis and rally tracking

3. Position your phone so the camera can see your full body on court

4. Tap REC to start analysis — swing away

## API Keys

| Service | Key | Purpose | Cost | Required |
|---------|-----|---------|------|----------|
| OpenAI | `sk-...` | GPT-4o Realtime voice coaching | ~$0.06/min audio | No |
| Google Gemini | `AI...` | Scene analysis + rally tracking | ~$0.07/30-min session | No |

Keys are stored in localStorage and persist across sessions. The app works fully without either key — voice coaching falls back to browser speech synthesis, and rally tracking falls back to auto-detecting rallies from stroke activity.

## Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│ Phone Camera │────>│ MediaPipe    │────>│ LandmarkFilter    │
│              │     │ Pose (33 lm) │     │ (One Euro + Bone) │
└─────────────┘     └──────────────┘     └────────┬──────────┘
                                                   │
                    ┌──────────────────────────────┘
                    v
        ┌───────────────────┐     ┌──────────────────────┐
        │ PhysicsAnalyzer   │────>│ StrokeClassifier     │
        │ (vel, accel, rot) │     │ (FH/BH/serve/volley) │
        └───────────────────┘     └──────────┬───────────┘
                                              │
                    ┌─────────────────────────┘
                    v
        ┌───────────────────┐     ┌──────────────────────┐
        │ PhaseDetector     │────>│ BiomechanicalCheck   │
        │ MotionSequence    │     │ FootworkAnalyzer     │
        │ ServeAnalyzer     │     │ KineticChainAnalyzer │
        └───────────────────┘     └──────────┬───────────┘
                                              │
                    ┌─────────────────────────┘
                    v
        ┌───────────────────┐     ┌──────────────────────┐
        │ CoachingOrch.     │────>│ GPT-4o Realtime      │
        │ (decision tree,   │     │ (voice feedback,     │
        │  strengths,       │     │  sandwich coaching,  │
        │  fault priority)  │     │  session notebook)   │
        └───────────────────┘     └──────────────────────┘

        ┌───────────────────┐     ┌──────────────────────┐
        │ Gemini 2.5 Flash  │────>│ RallyTracker         │
        │ (scene analysis)  │     │ (point lifecycle)    │
        └───────────────────┘     └──────────────────────┘
```

## Storage

All data persists in localStorage:

| Key | Content |
|-----|---------|
| `ace_openai_key` | OpenAI API key |
| `ace_gemini_key` | Gemini API key |
| `ace_player_profile` | Player profile, skill level, milestones |
| `ace_improvement_tracker` | Cross-session metrics, coaching plans |
| `ace_coach_notebook` | GPT-synthesized session notes |
| `techniqueai_sessions` | Session history (last 50) |
| `techniqueai_current_session` | Active session stroke data |

## License

This project builds on [TennisProject](https://github.com/yastrebksv/TennisProject) by yastrebksv for ball detection and court detection model architectures.
