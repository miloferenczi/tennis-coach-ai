# ACE - AI Tennis Coach

ACE is a real-time AI tennis coaching app that runs entirely in the browser. Point your phone camera at yourself on a tennis court and get instant biomechanical analysis, voice coaching, and session-over-session improvement tracking.

## How It Works

```
Camera → MediaPipe Pose (33 landmarks) → Signal Filtering → Physics Analysis
  → Stroke Classification → Phase Detection → Biomechanical Evaluation
  → Coaching Decision Tree → GPT-4o Realtime Voice Feedback

Camera → Gemini 2.5 Flash → Visual Stroke Analysis (racket, grip, contact)
Camera → Gemini 2.5 Flash → Scene Understanding → Rally Tracking → Tactical Analysis
Camera → Ball Color Detection → Trajectory Analysis → Shot Outcome
```

All pose estimation, stroke analysis, and biomechanics run client-side. Voice coaching and visual analysis are proxied through Supabase Edge Functions (API keys never reach the browser). Both are optional — the app works fully without either.

## Features

### Stroke Detection & Classification
- Detects forehand, backhand, serve, volley, and overhead strokes in real-time
- Automatic handedness detection (left/right) from wrist speed comparison over 30 frames
- Handedness-aware stroke classification with rotation sign flipping — propagated to all analyzers (physics, kinetic chain, footwork, serve)
- **Landmark visibility filtering**: All landmark usage gated by `isLandmarkVisible()` threshold check — occluded landmarks degrade gracefully instead of producing false analysis

### Biomechanical Analysis
- **Phase detection**: Preparation, loading, acceleration, contact, follow-through — identified per stroke with frame-level precision
- **Per-phase evaluation**: Each phase scored against biomechanical checkpoints (arm preparation, hip-shoulder separation, elbow extension, weight transfer, follow-through completion)
- **Kinetic chain analysis**: Evaluates sequential activation from ground up (legs → hips → torso → arm)
- **Quality scoring**: 60% biomechanical form + 40% power (velocity + acceleration), capped at 100
- **Skill-level hysteresis**: NTRP self-report as anchor, exponential moving average smoothing, 5-consecutive-stroke reclassification threshold — no more stroke-to-stroke skill bouncing
- **Body-relative normalization**: All velocities measured in torso-lengths/sec after a 30-frame calibration period, making analysis camera-distance independent
- **Adaptive state persistence**: Skill level, handedness, per-stroke-type baselines, and user sequence history persist across sessions

### Footwork Analysis
- Stance detection: closed, neutral, semi-open, open
- Base width ratio (relative to shoulder width)
- Weight distribution tracking per phase via hip-midpoint center-of-mass proxy
- Weight transfer direction and magnitude
- Step-in patterns and recovery to ready position
- Composite footwork score (0-100)
- Faults: narrow base, no step-in, poor recovery, wrong stance for stroke type
- **Volley-specific faults**: grip too low, no split step, punching not swinging, contact too deep
- **Overhead faults**: poor positioning (not under ball), low contact point

### Serve Analysis
- Trophy position evaluation (elbow angle, shoulder tilt, knee bend, back arch)
- Leg drive measurement (knee bend change + hip vertical displacement)
- Toss arm assessment (arm straightness, height above shoulder)
- Contact height analysis (wrist position relative to nose)
- Trunk rotation and follow-through tracking
- Weighted serve score (0-100): trophy 25%, leg drive 20%, contact height 20%, shoulder tilt 10%, toss arm 10%, trunk rotation 10%, follow-through 5%

### Gemini Visual Analysis
- **Stroke visual analysis**: Sends 5 high-res frames (640x360) per stroke to Gemini via server-side proxy for racket face angle, grip type, contact point position — things skeleton analysis can't see
- **Phase-labeled frames**: Each frame sent to Gemini includes phase context ("Frame 1 (preparation phase)", "Frame 3 (contact point)") for more accurate visual analysis
- **Visual-biomechanical fusion**: Merges Gemini visual insights with MediaPipe biomechanics, deduplicates faults, and delivers async follow-up coaching to GPT (~1-2s after stroke)
- **Court position tracking**: Detects no-man's-land lingering, recovery quality, split-step at net from periodic scene analysis
- **Rally tactical analysis**: Sends keyframes filtered to actual rally time window (not entire buffer) for point construction, shot selection, and movement analysis
- **Scene state detection**: Serving, rallying, between points, warmup, idle — with hysteresis state machine
- Visual coaching issues: racket face open, contact behind body, wrong grip, no-man's-land lingering, poor recovery, no split step at net
- Cost: ~$0.47/session with all visual features enabled; ~$0.07 for scene analysis only
- Fully optional — everything works without a Gemini key

### Voice Coaching (GPT-4o Realtime)
- Real-time voice feedback via WebRTC with sub-second latency
- **WebRTC reconnection**: Automatic reconnection with exponential backoff (2s/4s/8s, max 3 attempts) on connection drops, with SpeechSynthesis fallback
- Sandwich coaching: acknowledge strength, give one correction, encourage
- **3 coach personalities**: Alex (warm, encouraging, "we" language), Jordan (precise, technical, references angles/metrics), Sam (high-energy, sports metaphors, competitive)
- Coaching decision tree with priority-ranked faults (10 = foundation, 7-9 = power, 4-6 = refinement)
- Strength detection: identifies what the player is doing well for positive reinforcement
- **Enriched prompts**: Phase durations, detected handedness, ball tracking outcomes, and footwork recovery quality all flow to GPT
- **Smart speech gating**: Never speaks during rallies, queues coaching, delivers max 1 sentence between points, fuller coaching during idle breaks. Stroke-count fallback when Gemini unavailable
- **Speech interruption**: Cancels in-flight GPT audio when a new stroke is detected
- **Proactive triggers**: Pattern alerts (3x same fault), personal bests, quality spikes, curriculum target celebrations, fatigue detection
- Adapts to player skill level, curriculum focus, and session goals
- Falls back to browser speech synthesis when no API key provided

### Pattern Mining & Insights
- **Common denominators**: Identifies shared traits in top 20% of strokes
- **Deterioration patterns**: Sliding window quality regression to detect fatigue signatures
- **Stroke matchups**: Quality gaps between stroke types (e.g., backhand when stretched wide)
- **Cross-session breakthroughs**: Statistically significant metric improvements
- **Hidden strengths**: Metrics above NTRP skill level
- Top 3 insights displayed in session summary; top insight spoken by GPT at session end

### Live Visual Feedback
- **Skeleton flash**: Green (>80) / yellow (60-80) / red (<60) border glow after each stroke
- **Floating score**: Quality number rises from contact point, 1.5s animation
- **Word labels**: "NICE!", "EARLY!", "ROTATE!" based on primary fault/strength

### Instant Replay
- Records last 45 frames of landmarks per stroke (max 30 replays in memory)
- Phase-colored skeleton rendering with fault highlights
- **Velocity-colored swing path**: Blue (slow) → cyan → green → yellow → red (fast) with acceleration-proportional width
- **Racket face indicator**: Perpendicular line at contact frame, colored by Gemini analysis (red=open, green=neutral, blue=closed)
- Playback at 0.25x, 0.5x, or 1x speed with looping, pause, and frame-step
- **Video export**: MediaRecorder → WebM with full overlays, shareable via Web Share API
- **Side-by-side comparison**: Split canvas, dual skeleton, quality delta display
- Stroke review grid in session summary (quality-colored tiles, click to replay)

### Structured Progression
- **Curriculum engine**: 4-week mesocycles (technique isolation → refinement → integration → testing)
- **Calendar-aware scheduling**: Tracks actual session dates, detects skipped weeks, auto-extends or regenerates the mesocycle if player falls behind
- Curriculum overrides coaching orchestrator priorities during technique weeks
- Curriculum context injected into GPT system prompt
- **Drill mode**: Auto-suggests curriculum-relevant drills with progressive difficulty (target increases 10% after 3 consecutive 80%+ sets)
- **Persistent drill history**: Drill performance (scores, difficulty, dates) tracked in coaching memory across sessions — enables "Last time you did shadow swing, your elbow angle improved from 95° to 110°"
- **Gemini drill assessment**: Sends midpoint and completion context to GPT for drill-specific coaching

### Cross-Session Improvement Tracking
- Per-stroke-type metric history (quality, form, power, rotation, hip separation, elbow angle, smoothness)
- **Per-stroke-type baselines**: User's average quality and consistency per stroke type, persisted across sessions for trend detection
- Fault history with resolution detection (tracks when faults stop appearing)
- GPT-authored coaching plans with up to 3 focus areas, specific drills, and measurable targets
- Plan progress tracked across sessions with target comparisons shown per stroke
- Session-end plan synthesis via text-only OpenAI API (cost-efficient, not through Realtime audio channel)

### Session Summary
- **Hero insight**: Most interesting finding from pattern mining, displayed prominently
- **Quality sparkline**: SVG chart showing quality progression over time
- **Notable strokes**: Best/worst per type with clickable replay tiles
- **Gemini tactical summary**: Point construction and shot selection analysis from rally review
- **vs Last Session**: Cross-session quality deltas per stroke type
- **Within-session progress**: First-to-last quality improvement per stroke type
- **Curriculum drill suggestion**: Auto-recommended drill based on current training block
- **Shareable session card**: 1080x1920 canvas PNG with stats, sparkline, insight, and branding — Web Share API on mobile, download fallback

### Ball Tracking
- Browser-based ball color detection at 160x90 resolution
- Trajectory tracking and shot outcome classification (in/out, net clearance)
- Calibrateable ball color detection for different lighting conditions
- No server required

### Rally Tracking
- Point lifecycle management: serve points vs feed/drill rallies
- Per-rally stroke counting and quality tracking
- Session statistics: total rallies, average length, longest rally, serve percentage
- Rally context injected into GPT prompts ("this is stroke #3 of a serve point")
- Rally indicator in status bar showing current game state

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

### Error Handling & Resilience
- **Global error handler**: `window.onerror` + `onunhandledrejection` catch uncaught exceptions and show recovery toast
- **WebRTC reconnection**: Automatic reconnection with exponential backoff (2s → 4s → 8s, max 3 attempts) when voice coaching connection drops
- **Camera error handling**: Per-error-type user-facing messages (permission denied, camera in use, no camera found)
- **Graceful degradation**: All Gemini features silently skip without API key; voice coaching falls back to browser speech synthesis

### Additional Features
- **Ghost overlay**: Compare your form against reference poses
- **Challenge mode**: Structured challenges with scoring
- **Diagnostic logger**: Debug output for pose data quality and analysis pipeline
- **Calibration tool**: Threshold calibration from recorded video
- **PWA support**: Installable as a home screen app (manifest.json + service worker)
- **Video analysis mode**: Upload and analyze recorded video files

## Architecture

### Frontend (Single-Page PWA)
- `index.html` — Main app (~8500 lines): TennisAI class, UI, onboarding, session management
- 35 JavaScript modules in `/js/`:

| Module | Purpose |
|--------|---------|
| `landmark-filter.js` | Visibility filtering utility (`isLandmarkVisible`), torso-length normalization |
| `signal-filters.js` | One Euro filter + bone length constraints for pose data quality |
| `kalman-velocity-estimator.js` | Kalman filter for smooth velocity estimation |
| `physics-analyzer.js` | Velocity, acceleration, rotation, smoothness from pose landmarks (handedness-aware) |
| `stroke-classifier.js` | Classifies stroke type from motion characteristics |
| `phase-detector.js` | Identifies swing phases (prep/load/accel/contact/follow-through) |
| `kinetic-chain-analyzer.js` | Evaluates sequential body segment activation (handedness-aware) |
| `motion-sequence-analyzer.js` | Phase-level biomechanical metrics, timing, adaptive baselines |
| `biomechanical-checkpoints.js` | Per-phase fault detection against technique standards |
| `footwork-analyzer.js` | Stance, base width, weight transfer, steps, recovery |
| `serve-analyzer.js` | Serve-specific biomechanics (trophy, leg drive, contact height) |
| `enhanced-tennis-analyzer.js` | Main orchestrator: wires all analyzers, skill hysteresis, adaptive state persistence |
| `coaching-orchestrator.js` | Decision tree traversal, strength detection, feedback timing |
| `gpt-voice-coach.js` | GPT-4o Realtime WebRTC connection, prompt construction |
| `coach-notebook.js` | Persistent coaching notes across sessions |
| `coaching-memory.js` | Structured cross-session memory, cue effectiveness, drill history tracking |
| `improvement-tracker.js` | Cross-session metric tracking, coaching plans, drill performance history |
| `player-profile.js` | Persistent player identity, skill progression, milestones |
| `session-storage.js` | Session persistence, stroke records, summary generation |
| `professional-references.js` | Reference data by NTRP skill level for comparison |
| `ball-tracking-client.js` | Browser-based ball color detection and trajectory tracking |
| `batch-coaching-accumulator.js` | Stroke accumulation, batch summaries, stroke-count flush fallback |
| `supabase-client.js` | Auth, profile management, Gemini/OpenAI proxy calls, subscription enforcement |
| `scene-analyzer.js` | Gemini 2.5 Flash scene analysis via server-side proxy + visual stroke analysis + rally analysis |
| `visual-analysis-merger.js` | Merges Gemini visual + MediaPipe biomechanical results |
| `court-position-analyzer.js` | Court position tracking, no-man's-land, recovery quality |
| `rally-tracker.js` | Rally lifecycle, point boundaries, Gemini tactical analysis |
| `stroke-replay.js` | Replay with velocity-colored swing path, video export, side-by-side |
| `live-feedback-overlay.js` | Post-stroke visual flash, floating score, word labels |
| `insight-miner.js` | Pattern mining: common denominators, deterioration, matchups |
| `speech-gate.js` | Smart speech timing: queue during rallies, brevity between points, stroke-count fallback |
| `proactive-triggers.js` | Unprompted coaching: patterns, personal bests, fatigue |
| `curriculum-engine.js` | 4-week training mesocycles with calendar-aware scheduling |
| `share-card-generator.js` | Canvas-based shareable session card (1080x1920) |
| `session-video-manager.js` | Stroke bookmarking: best/worst/first/last per type |
| `ghost-overlay.js` | Reference pose overlay for form comparison |
| `challenge-mode.js` | Structured challenges with scoring |
| `drill-mode.js` | Curriculum-aware drills with progressive difficulty |
| `calibration-tool.js` | Threshold calibration from video |
| `threshold-updater.js` | Dynamic threshold adjustment |
| `diagnostic-logger.js` | Debug logging for analysis pipeline |
| `sport-loader.js` | Multi-sport config loader (currently tennis) |
| `video-analyzer.js` | Recorded video upload and analysis |

### Backend (Supabase)
- **Auth**: Email magic link via Supabase Auth
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Edge Functions** (Deno, deployed to Supabase):

| Function | Purpose | Auth |
|----------|---------|------|
| `get-realtime-token` | Provisions ephemeral OpenAI Realtime tokens | Required (subscription check) |
| `gemini-proxy` | Proxies Gemini API calls (key stays server-side, model allowlist) | Required (subscription check) |
| `chat-completion` | Proxies OpenAI chat completions for text-only tasks (plan synthesis) | Required |
| `get-gemini-key` | Legacy: returns Gemini key for pro/trial users | Required (free blocked) |
| `get-guest-token` | IP-rate-limited guest tokens for unauthenticated trial | No (IP limited) |
| `submit-telemetry` | Anonymized session telemetry | Required |

- **CORS**: All edge functions restricted to `ALLOWED_ORIGIN` env var (no wildcard)
- **Subscription enforcement**: Server-side tier checks in all cost-incurring functions
- **RLS protection**: Check constraint + DB trigger prevents client-side subscription tier escalation

### Backend (Development/Calibration Only)
- `server/ball_detection_api.py` — Flask server on port 5001 for calibration workflows
- Model weights in `/model_weights/` (TrackNet ball detection, court detection)
- Not required for normal app usage

### Configuration
- `sports/tennis/config.json` — Tennis-specific parameters
- `tennis_coaching_tree.json` — Coaching decision tree with 27 issues across 8 categories (groundstroke, serve, volley, overhead, footwork, visual)
- `supabase/schema.sql` — Database schema, RLS policies, subscription constraints
- `manifest.json` + `sw.js` — PWA configuration

## Getting Started

1. Set up Supabase:
   ```bash
   # Link to your Supabase project
   supabase link --project-ref <your-project-ref>

   # Apply schema
   supabase db push

   # Deploy edge functions
   supabase functions deploy get-realtime-token
   supabase functions deploy gemini-proxy
   supabase functions deploy chat-completion
   supabase functions deploy get-gemini-key
   supabase functions deploy get-guest-token
   supabase functions deploy submit-telemetry

   # Set secrets
   supabase secrets set OPENAI_API_KEY=sk-...
   supabase secrets set GEMINI_API_KEY=AI...
   supabase secrets set ALLOWED_ORIGIN=https://your-domain.com
   ```

2. Serve `index.html` over HTTPS (required for camera access):
   ```bash
   npx serve .
   ```

3. Open on your phone browser and go through onboarding (sport, NTRP level, goals, coach selection, sign up)

4. Position your phone so the camera can see your full body on court

5. Tap REC to start analysis — swing away

## API Keys & Security

API keys are configured as environment variables on the Supabase Edge Functions — they never reach the client browser.

| Service | Env Var | Purpose | Cost | Required |
|---------|---------|---------|------|----------|
| OpenAI | `OPENAI_API_KEY` | GPT-4o Realtime voice coaching + text plan synthesis | ~$0.06/min audio | No |
| Google Gemini | `GEMINI_API_KEY` | Visual analysis + scene + rally (proxied) | ~$0.47/30-min session | No |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Auth, database, edge functions | Free tier available | Yes |
| CORS | `ALLOWED_ORIGIN` | Restricts edge function access to production domain | — | Yes |

The app works fully without OpenAI or Gemini keys — voice coaching falls back to browser speech synthesis, and all Gemini features degrade gracefully.

### Subscription Tiers

| Tier | Strokes/Session | Coaching Observations | Sessions/Month | Price |
|------|----------------|----------------------|----------------|-------|
| Free | 10 | 2 | 1 | $0 |
| Trial (7-day) | Unlimited | Unlimited | Unlimited | $0 |
| Pro | Unlimited | Unlimited | Unlimited | $14.99/mo or $99.99/yr |

Free tier limits are enforced both client-side and server-side (edge functions check `subscription_tier` before returning tokens).

## Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│ Phone Camera │────>│ MediaPipe    │────>│ LandmarkFilter    │
│              │     │ Pose (33 lm) │     │ (One Euro + Bone) │
└──────┬──────┘     └──────────────┘     └────────┬──────────┘
       │                                           │
       │            ┌─────────────────────────────┘
       │            v
       │  ┌───────────────────┐     ┌──────────────────────┐
       │  │ PhysicsAnalyzer   │────>│ StrokeClassifier     │
       │  │ (vel, accel, rot) │     │ (FH/BH/serve/volley) │
       │  └───────────────────┘     └──────────┬───────────┘
       │                                        │
       │            ┌──────────────────────────┘
       │            v
       │  ┌───────────────────┐     ┌──────────────────────┐
       │  │ PhaseDetector     │────>│ BiomechanicalCheck   │
       │  │ MotionSequence    │     │ FootworkAnalyzer     │
       │  │ ServeAnalyzer     │     │ KineticChainAnalyzer │
       │  └───────────────────┘     └──────────┬───────────┘
       │                                        │
       │            ┌──────────────────────────┘
       │            v
       │  ┌───────────────────┐     ┌──────────────────────┐
       │  │ CoachingOrch.     │────>│ GPT-4o Realtime      │
       │  │ (decision tree,   │     │ (voice feedback,     │
       │  │  strengths,       │     │  sandwich coaching,  │
       │  │  fault priority)  │     │  session notebook)   │
       │  └───────────────────┘     └──────────────────────┘
       │
       │  ┌───────────────────┐     ┌──────────────────────┐
       └─>│ Gemini 2.5 Flash  │────>│ Visual Merger        │──> GPT follow-up
          │ (5 frames/stroke, │     │ (dedupe faults,      │
          │  scene analysis,  │     │  racket/grip/contact) │
          │  rally analysis)  │     └──────────────────────┘
          └────────┬──────────┘
                   │
                   v
          ┌───────────────────┐     ┌──────────────────────┐
          │ CourtPositionAnlz │     │ RallyTracker         │
          │ (zone, recovery)  │     │ (point lifecycle,    │
          └───────────────────┘     │  tactical analysis)  │
                                    └──────────────────────┘
```

## Storage

Authenticated users store data in Supabase (PostgreSQL). localStorage is used as fallback for unauthenticated users and for client-side state.

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `profiles` | Player profile, NTRP level, goals, coach preference, subscription tier |
| `sessions` | Session history with stroke data and summaries |
| `structured_session_memory` | Cross-session coaching memory for GPT context |
| `coaching_effectiveness` | Cue effectiveness tracking (which coaching tips worked) |
| `guest_trials` | IP-based rate limiting for unauthenticated trial (24h window) |

### localStorage Keys

| Key | Content |
|-----|---------|
| `ace_player_profile` | Player profile, skill level, milestones |
| `ace_improvement_tracker` | Cross-session metrics, coaching plans, drill history |
| `ace_analyzer_state` | Skill level, handedness, per-stroke-type baselines, sequence history |
| `ace_coach_notebook` | GPT-synthesized session notes |
| `ace_curriculum` | 4-week training mesocycle state |
| `ace_user_email` | Cached email for returning user detection |
| `ace_user_display_name` | Cached display name for welcome-back screen |
| `techniqueai_sessions` | Session history (last 50) |
| `techniqueai_current_session` | Active session stroke data |

## License

This project builds on [TennisProject](https://github.com/yastrebksv/TennisProject) by yastrebksv for ball detection and court detection model architectures.
