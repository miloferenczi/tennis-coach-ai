# Tennis ACE AI — Codebase Improvement Final Report

**Date:** 2026-02-14
**Team:** tennis-ace-improve (4 evaluator-executor pairs)
**Total changes:** +2,141 / -364 lines across 25 files (2 new edge functions, 1 new SQL migration)

---

## Summary by Pair

### Pair 1: Model Quality & Self-Improvement
**Starting score:** 5.4/10 | **Ending score:** ~7.8/10 | **Iterations:** 1 + team-lead fixes

| Criterion | Before | After |
|-----------|--------|-------|
| MediaPipe landmark robustness | 5 | 8 |
| Shot classification accuracy | 6 | 8* |
| Handedness handling | 6 | 8 |
| Quality scoring sanity | 7 | 9 |
| Feedback loop closure | 5 | 8* |
| Adaptive threshold persistence | 4 | 8* |
| Extensibility to other sports | 5 | 5 |

*Items marked with \* were raised from 7→8 by team-lead iteration 2 fixes (physics-analyzer handedness, motion-sequence persistence).*

**Key changes:**
- `isLandmarkVisible()` utility gating all landmark usage across 8 files
- KineticChainAnalyzer + PhysicsAnalyzer handedness-aware (dominant side selection)
- Quality scores capped at 100
- Skill-level hysteresis with NTRP anchor, EMA (alpha=0.15), 5-consecutive reclassification
- Adaptive state persistence: skill level, handedness, per-stroke-type baselines, user history
- Cross-domain wiring in index.html (script tag, init, session end)

**Remaining gap:** Extensibility (5/10) — SportLoader exists but all analysis logic is tennis-specific. Future sprint.

---

### Pair 2: Coaching Quality
**Starting score:** 8.2/10 | **Ending score:** 8.4/10 | **Iterations:** 2

| Criterion | Score |
|-----------|-------|
| Decision tree correctness | 9 |
| Cross-session progress tracking | 9 |
| Drill recommendation quality | 8 |
| Progression logic | 9 |
| Personalization depth | 8 |
| Coaching cue actionability | 8 |
| Stroke type coverage | 8 |

**Key changes:**
- Progressive drill difficulty with persistent history in ImprovementTracker
- 4 volley coaching tree nodes (punchingNotSwinging, volleyGripTooLow, volleyTooDeep, noSplitStepBeforeVolley)
- 2 overhead coaching tree nodes (poorOverheadPositioning, lowOverheadContactPoint)
- Stroke-count-based batch flush fallback (no Gemini dependency)
- Calendar-driven curriculum with session-based week detection and auto-extend
- Drill history tracking in coaching memory with drill-metric correlation

---

### Pair 3: LLM Usage & Voice
**Starting score:** 8.0/10 | **Ending score:** 9.0/10 | **Iterations:** 1

| Criterion | Score |
|-----------|-------|
| Gemini prompt quality | 9 |
| GPT voice prompt quality | 9 |
| Coach personality differentiation | 9 |
| Data flow completeness | 9 |
| Latency acceptability | 9 |
| Cost efficiency | 9 |

**Key changes:**
- Rally frame selection bug fixed (time-window filtering)
- Plan synthesis moved to text-only chat completions API via new `chat-completion` edge function (~10-20x cheaper)
- Coach personalities expanded to substantive 3-4 sentence blueprints (Alex/Jordan/Sam)
- 4 missing data flows added to GPT: phase durations, handedness, ball tracking, footwork recovery
- Per-frame phase labels in Gemini visual prompts

---

### Pair 4: Launch Readiness
**Starting score:** 4.0/10 | **Ending score:** 8.1/10 | **Iterations:** 1 + team-lead fixes

| Criterion | Before | After |
|-----------|--------|-------|
| API key security | 2 | 8 |
| XSS/injection prevention | 3 | 8* |
| CORS and CSP configuration | 3 | 8 |
| RLS restrictions | 5 | 9 |
| Error handling & resilience | 4 | 8 |
| Subscription enforcement | 3 | 8 |
| Privacy & data handling | 6 | 8 |

*XSS raised from 7→8 by team-lead fixing 2 remaining innerHTML vectors in profile tab + adding escapeHtml utility.*

**Key changes:**
- New `gemini-proxy` edge function (API key stays server-side, model allowlist validation)
- New `chat-completion` edge function (OpenAI text API proxy)
- CORS restricted to `ALLOWED_ORIGIN` env var across all 6 edge functions
- innerHTML XSS fixes with escapeHtml() and textContent/DOM API
- RLS check constraint + trigger preventing subscription tier escalation
- Server-side subscription enforcement in all cost-incurring edge functions
- Global error handler (window.onerror + onunhandledrejection → toast)
- WebRTC reconnection with exponential backoff (2s/4s/8s, max 3 attempts)
- Camera error handling with per-error-type user messages

---

## Files Changed

| File | Lines Changed | Domain |
|------|--------------|--------|
| index.html | +413 | Cross-cutting (XSS, error handling, wiring) |
| js/enhanced-tennis-analyzer.js | +242 | Model |
| js/gpt-voice-coach.js | +245 | LLM |
| js/scene-analyzer.js | +262 | LLM |
| js/supabase-client.js | +215 | Launch |
| tennis_coaching_tree.json | +209 | Coaching |
| js/curriculum-engine.js | +138 | Coaching |
| js/motion-sequence-analyzer.js | +135 | Model |
| js/coaching-memory.js | +132 | Coaching |
| js/kinetic-chain-analyzer.js | +95 | Model |
| js/improvement-tracker.js | +75 | Coaching |
| js/physics-analyzer.js | +64 | Model |
| supabase/functions/get-realtime-token/index.ts | +47 | Launch |
| supabase/schema.sql | +44 | Launch |
| supabase/functions/get-gemini-key/index.ts | +38 | Launch |
| js/biomechanical-checkpoints.js | +31 | Model |
| js/coaching-orchestrator.js | +30 | Coaching |
| supabase/functions/get-guest-token/index.ts | +26 | Launch |
| js/batch-coaching-accumulator.js | +20 | Coaching |
| js/serve-analyzer.js | +14 | Model |
| js/footwork-analyzer.js | +12 | Model |
| js/stroke-classifier.js | +10 | Model |
| js/rally-tracker.js | +3 | LLM |
| supabase/functions/chat-completion/index.ts | NEW | LLM/Launch |
| supabase/functions/gemini-proxy/index.ts | NEW | Launch |

---

## New Edge Functions

1. **`gemini-proxy`** — Auth-gated Gemini API proxy. Keeps API key server-side. Model allowlist validation.
2. **`chat-completion`** — Auth-gated OpenAI chat completions proxy. Used for plan synthesis (text-only, ~10-20x cheaper than Realtime).

---

## Cross-Cutting Issues (Punch List)

| Priority | Issue | Affected Pairs |
|----------|-------|---------------|
| P2 | Sport extensibility (5/10) — all analysis hardcoded for tennis | Model |
| P2 | `get-gemini-key` still returns raw key to pro/trial users (legacy fallback) | Launch |
| P2 | No CSP meta tag (acceptable for MVP, add before scale) | Launch |
| P3 | `get-realtime-token` allows free tier (client-side limited) — acceptable for short-lived tokens | Launch |

---

## Blockers Requiring Human Review

**None.** No pair exited with any criterion below 6.

---

## Overall Score Summary

| Pair | Before | After | Delta |
|------|--------|-------|-------|
| Model Quality | 5.4 | 7.8 | +2.4 |
| Coaching Quality | 8.2 | 8.4 | +0.2 |
| LLM Usage | 8.0 | 9.0 | +1.0 |
| Launch Readiness | 4.0 | 8.1 | +4.1 |
| **Weighted Average** | **6.4** | **8.3** | **+1.9** |
