/**
 * SceneAnalyzer - Gemini 2.5 Flash multimodal scene analysis
 *
 * Sends periodic camera frames to Gemini for scene-level understanding:
 * ball visibility, player positioning, court state, point boundaries.
 * Fully optional — app works without a Gemini key.
 */
class SceneAnalyzer {
  constructor() {
    this.geminiApiKey = null;
    this.captureInterval = 5000; // 5 seconds
    this.frameBuffer = [];       // last 3 captured frames as base64 JPEG
    this.lastAnalysis = null;
    this.gameState = 'unknown';  // unknown | warmup | between_points | serving | rallying | idle
    this.stateConfidence = 0;
    this.stateHoldFrames = 0;    // hysteresis counter
    this.pendingState = null;    // state waiting for confirmation
    this.isAnalyzing = false;    // prevents overlapping API calls
    this.analysisTimer = null;
    this.enabled = false;
    this.captureCanvas = null;
    this.captureCtx = null;
    this.onStateChange = null;   // callback(oldState, newState, sceneData)
    this.lastUpdateTime = 0;
    this.shotContext = 'none';
    this.ballVisible = false;
    this.courtSide = 'unknown';
    this.playerCount = 0;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 5;

    // Create offscreen canvas for scene capture (320x180)
    this.captureCanvas = document.createElement('canvas');
    this.captureCanvas.width = 320;
    this.captureCanvas.height = 180;
    this.captureCtx = this.captureCanvas.getContext('2d');

    // High-res canvas for stroke visual analysis (640x360)
    this.strokeCanvas = document.createElement('canvas');
    this.strokeCanvas.width = 640;
    this.strokeCanvas.height = 360;
    this.strokeCtx = this.strokeCanvas.getContext('2d');

    // Rolling frame buffer for stroke analysis: last 60 frames at 640x360
    this.rollingFrameBuffer = [];
    this.maxRollingFrames = 60;
    this.isAnalyzingStroke = false;   // prevents overlapping stroke analysis calls
  }

  /**
   * Initialize with Gemini key from Supabase Edge Function.
   * Call after auth is confirmed. Falls back gracefully if no key.
   */
  async initializeWithAuth() {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated()) {
      const key = await supabaseClient.getGeminiKey();
      if (key) {
        this.setApiKey(key);
        return true;
      }
    }
    return false;
  }

  /**
   * Set or clear the Gemini API key. Enables/disables the analyzer.
   */
  setApiKey(key) {
    if (key && key.trim().length > 0) {
      this.geminiApiKey = key.trim();
      this.enabled = true;
      this.consecutiveErrors = 0;
      console.log('SceneAnalyzer: enabled');
    } else {
      this.geminiApiKey = null;
      this.enabled = false;
      this.stop();
      console.log('SceneAnalyzer: disabled (no API key)');
    }
  }

  /**
   * Capture a frame from the video element, add to buffer, trigger analysis.
   */
  captureFrame(videoElement) {
    if (!this.enabled || !videoElement || videoElement.readyState < 2) return;

    try {
      this.captureCtx.drawImage(videoElement, 0, 0, 320, 180);
      const dataUrl = this.captureCanvas.toDataURL('image/jpeg', 0.7);
      // Strip the data:image/jpeg;base64, prefix
      const base64 = dataUrl.split(',')[1];

      this.frameBuffer.push(base64);
      if (this.frameBuffer.length > 3) {
        this.frameBuffer.shift();
      }

      // Trigger analysis when we have 3 frames
      if (this.frameBuffer.length >= 3 && !this.isAnalyzing) {
        this.analyze();
      }
    } catch (e) {
      console.warn('SceneAnalyzer: frame capture failed', e);
    }
  }

  /**
   * Start periodic frame capture.
   */
  start(videoElement) {
    if (!this.enabled || !videoElement) return;

    this.stop(); // clear any existing timer
    this.analysisTimer = setInterval(() => {
      this.captureFrame(videoElement);
    }, this.captureInterval);

    console.log('SceneAnalyzer: started (interval=' + this.captureInterval + 'ms)');
  }

  /**
   * Capture a high-res frame (640x360) into the rolling buffer.
   * Called every frame from onResults() during analysis.
   */
  captureHighResFrame(videoElement) {
    if (!this.enabled || !videoElement || videoElement.readyState < 2) return;

    try {
      this.strokeCtx.drawImage(videoElement, 0, 0, 640, 360);
      const dataUrl = this.strokeCanvas.toDataURL('image/jpeg', 0.75);
      const base64 = dataUrl.split(',')[1];

      this.rollingFrameBuffer.push({ base64, timestamp: Date.now() });
      if (this.rollingFrameBuffer.length > this.maxRollingFrames) {
        this.rollingFrameBuffer.shift();
      }
    } catch (e) {
      // Silently fail — frame capture is best-effort
    }
  }

  /**
   * Analyze a stroke visually using Gemini.
   * Extracts 5 evenly-spaced frames from the rolling buffer and sends to Gemini
   * with a stroke-specific prompt. Returns structured visual analysis.
   *
   * @param {string} strokeType - e.g. 'Forehand', 'Backhand', 'Serve'
   * @param {Array} detectedFaults - biomechanical faults already detected by MediaPipe
   * @returns {Promise<Object|null>} Visual analysis result or null on failure
   */
  async analyzeStroke(strokeType, detectedFaults, options = {}) {
    if (!this.enabled || !this.geminiApiKey) return null;
    if (this.isAnalyzingStroke) return null;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) return null;
    if (this.rollingFrameBuffer.length < 5) return null;

    this.isAnalyzingStroke = true;

    // Filter to frames from the last 2 seconds to exclude stale non-stroke frames
    const cutoff = Date.now() - 2000;
    let buf = this.rollingFrameBuffer.filter(f => f.timestamp >= cutoff);
    if (buf.length < 5) buf = this.rollingFrameBuffer; // fallback to full buffer
    const indices = [
      0,
      Math.floor(buf.length * 0.25),
      Math.floor(buf.length * 0.5),
      Math.floor(buf.length * 0.75),
      buf.length - 1
    ];
    const frames = indices.map(i => buf[i].base64);

    const faultList = (detectedFaults || []).map(f => f.name || f.id).join(', ') || 'none';
    const isServe = strokeType.toLowerCase().includes('serve');

    // Build context additions
    const phaseLabels = options.phaseLabels?.join(' → ') || 'preparation → loading → acceleration → contact → follow-through';
    const focusLine = options.focusAreas?.length
      ? `\nThis player is specifically working on: ${options.focusAreas.join(', ')}. Pay special attention to visual indicators of these focus areas.`
      : '';

    // Branch prompt for serves vs groundstrokes
    let promptText;
    if (isServe) {
      promptText = `You are an expert tennis coach analyzing a serve motion.
These 5 frames show the serve from preparation to follow-through (chronological order).
Frame phases: ${phaseLabels}

The skeleton-based analysis already detected these faults: ${faultList}${focusLine}

Analyze this serve motion:
1. Toss placement relative to body (in front, behind, left, right)
2. Trophy position depth — racquet fully behind head?
3. Visible knee drive and jump/leg extension at contact
4. Pronation visible at contact
5. Racket face angle at contact (flat/slice/kick indicators)
6. Positive observations

Be specific and concise.`;
    } else {
      promptText = `You are an expert tennis coach analyzing a ${strokeType} stroke.
These 5 frames show the stroke from preparation to follow-through (chronological order).
Frame phases: ${phaseLabels}

The skeleton-based analysis already detected these faults: ${faultList}${focusLine}

Analyze what the CAMERA can see that skeletons CANNOT:
1. Racket face angle at contact (open/closed/neutral)
2. Grip type if visible (eastern/semi-western/western/continental)
3. Contact point relative to body (in front/beside/behind, high/low)
4. Any visual faults not covered by the skeleton analysis
5. Positive observations about form

Be specific and concise.`;
    }

    // Build response schema (serve gets extra fields)
    const schemaProperties = {
      racketFace: {
        type: 'OBJECT',
        properties: {
          state: { type: 'STRING', enum: ['open', 'closed', 'neutral', 'unknown'] },
          atContact: { type: 'BOOLEAN' }
        },
        required: ['state']
      },
      contactPoint: {
        type: 'OBJECT',
        properties: {
          position: { type: 'STRING', enum: ['in_front', 'beside', 'behind_body', 'unknown'] },
          height: { type: 'STRING', enum: ['high', 'waist', 'low', 'unknown'] },
          relative_to_body: { type: 'STRING', enum: ['optimal', 'behind', 'too_far_front', 'unknown'] }
        },
        required: ['position']
      },
      gripType: { type: 'STRING', enum: ['eastern', 'semi_western', 'western', 'continental', 'unknown'] },
      bodyPosition: { type: 'STRING' },
      faults: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            description: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
            severity: { type: 'STRING', enum: ['low', 'medium', 'high'] }
          },
          required: ['id', 'description', 'confidence']
        }
      },
      positives: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      confidence: { type: 'NUMBER' }
    };

    // Add serve-specific schema fields
    if (isServe) {
      schemaProperties.tossPlacement = {
        type: 'OBJECT',
        properties: {
          position: { type: 'STRING', enum: ['in_front', 'behind', 'left', 'right', 'unknown'] },
          consistency: { type: 'STRING', enum: ['consistent', 'inconsistent', 'unknown'] }
        }
      };
      schemaProperties.trophyVisual = {
        type: 'OBJECT',
        properties: {
          depth: { type: 'STRING', enum: ['full', 'partial', 'shallow', 'unknown'] },
          elbowPosition: { type: 'STRING' }
        }
      };
      schemaProperties.legExtension = {
        type: 'OBJECT',
        properties: {
          jumpVisible: { type: 'BOOLEAN' },
          kneeDrive: { type: 'STRING', enum: ['strong', 'moderate', 'minimal', 'unknown'] }
        }
      };
    }

    const requestBody = {
      contents: [{
        parts: [
          ...frames.map(base64 => ({
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64
            }
          })),
          { text: promptText }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: schemaProperties,
          required: ['racketFace', 'contactPoint', 'confidence']
        },
        temperature: 0.2,
        maxOutputTokens: 500
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`SceneAnalyzer: stroke analysis API error ${response.status}`);
        this.consecutiveErrors++;
        this.isAnalyzingStroke = false;
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        this.consecutiveErrors++;
        this.isAnalyzingStroke = false;
        return null;
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        result = JSON.parse(cleaned);
      }

      this.consecutiveErrors = 0;
      this.isAnalyzingStroke = false;

      console.log('SceneAnalyzer: stroke visual analysis complete', {
        racketFace: result.racketFace?.state,
        contactPoint: result.contactPoint?.position,
        faults: (result.faults || []).length,
        confidence: result.confidence
      });

      return result;

    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        console.warn('SceneAnalyzer: stroke analysis timed out');
      } else {
        console.warn('SceneAnalyzer: stroke analysis failed', e);
      }
      this.consecutiveErrors++;
      this.isAnalyzingStroke = false;
      return null;
    }
  }

  /**
   * Analyze a completed rally using Gemini (up to 8 keyframes, tactical prompt).
   * Called from RallyTracker.endRally() when Gemini enabled and rally had 3+ strokes.
   *
   * @param {Object} rallyData - Rally object from RallyTracker
   * @returns {Promise<Object|null>} Tactical analysis result or null
   */
  async analyzeRally(rallyData) {
    if (!this.enabled || !this.geminiApiKey) return null;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) return null;
    if (this.rollingFrameBuffer.length < 5) return null;

    // Extract up to 8 evenly-spaced keyframes (1/sec of rally duration)
    const buf = this.rollingFrameBuffer;
    const frameCount = Math.min(8, buf.length);
    const step = Math.max(1, Math.floor(buf.length / frameCount));
    const frames = [];
    for (let i = 0; i < buf.length && frames.length < 8; i += step) {
      frames.push(buf[i].base64);
    }

    const strokeSummary = (rallyData.strokes || [])
      .map((s, i) => `${i + 1}. ${s.type} (quality ${s.quality})`)
      .join(', ');

    const requestBody = {
      contents: [{
        parts: [
          ...frames.map(base64 => ({
            inline_data: { mime_type: 'image/jpeg', data: base64 }
          })),
          {
            text: `You are an expert tennis coach reviewing a rally that just ended.
The rally was ${rallyData.origin === 'serve' ? 'a serve point' : 'a feed/drill rally'} with ${rallyData.strokes?.length || 0} strokes.
Stroke sequence: ${strokeSummary || 'unknown'}

Analyze these ${frames.length} keyframes from the rally and provide tactical insights:
1. Court positioning — was the player in good position throughout?
2. Shot selection — appropriate shot choices for the situation?
3. Movement patterns — good recovery between shots?
4. Point construction — building the point logically?
5. Key moment — what decided the outcome?`
          }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            positioning: { type: 'STRING' },
            shotSelection: { type: 'STRING' },
            movement: { type: 'STRING' },
            pointConstruction: { type: 'STRING' },
            keyMoment: { type: 'STRING' },
            overallAssessment: { type: 'STRING' },
            suggestion: { type: 'STRING' },
            confidence: { type: 'NUMBER' }
          },
          required: ['overallAssessment', 'suggestion', 'confidence']
        },
        temperature: 0.3,
        maxOutputTokens: 400
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        this.consecutiveErrors++;
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        this.consecutiveErrors++;
        return null;
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        result = JSON.parse(cleaned);
      }

      this.consecutiveErrors = 0;
      console.log('SceneAnalyzer: rally analysis complete', {
        assessment: result.overallAssessment?.substring(0, 60),
        confidence: result.confidence
      });

      return result;

    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        console.warn('SceneAnalyzer: rally analysis timed out');
      } else {
        console.warn('SceneAnalyzer: rally analysis failed', e);
      }
      this.consecutiveErrors++;
      return null;
    }
  }

  /**
   * Analyze session progress by comparing best and worst strokes (text-only, no images).
   * Called at session end. Returns a short textual comparison or null.
   */
  async analyzeSessionProgress(context) {
    if (!this.enabled || !this.geminiApiKey) return null;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) return null;

    const requestBody = {
      contents: [{
        parts: [{
          text: `You are a tennis coach reviewing a practice session. Compare the player's best and worst strokes:

BEST (${context.bestType}, quality ${context.bestQuality}/100): ${context.bestVisual}
WORST (${context.worstType}, quality ${context.worstQuality}/100): ${context.worstVisual}

${context.focusAreas?.length ? `Player focus areas: ${context.focusAreas.join(', ')}` : ''}

In 2-3 sentences: What visual difference explains the quality gap? What should they focus on next session?`
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 200
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);
      if (!response.ok) { this.consecutiveErrors++; return null; }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { this.consecutiveErrors++; return null; }

      this.consecutiveErrors = 0;
      console.log('SceneAnalyzer: session progress analysis complete');
      return text.trim();

    } catch (e) {
      clearTimeout(timeout);
      this.consecutiveErrors++;
      return null;
    }
  }

  /**
   * Analyze drill execution visually using Gemini.
   * Sends 3 frames from rolling buffer with drill-specific prompt.
   * @returns {Promise<string|null>} Text assessment or null
   */
  async analyzeDrill(drillFocus, repCount, totalReps, isComplete) {
    if (!this.enabled || !this.geminiApiKey) return null;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) return null;
    if (this.rollingFrameBuffer.length < 3) return null;

    const buf = this.rollingFrameBuffer;
    const indices = [0, Math.floor(buf.length / 2), buf.length - 1];
    const frames = indices.map(i => buf[i].base64);

    const phase = isComplete ? 'completed' : 'midpoint';
    const promptText = `You are a tennis coach watching a drill focused on: ${drillFocus}.
Rep ${repCount}/${totalReps} (${phase}).
Assess the player's execution of the drill focus in these 3 frames.
Give one specific adjustment in 1-2 sentences. Be encouraging but precise.`;

    const requestBody = {
      contents: [{
        parts: [
          ...frames.map(base64 => ({
            inline_data: { mime_type: 'image/jpeg', data: base64 }
          })),
          { text: promptText }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 150
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);
      if (!response.ok) { this.consecutiveErrors++; return null; }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { this.consecutiveErrors++; return null; }

      this.consecutiveErrors = 0;
      return text.trim();

    } catch (e) {
      clearTimeout(timeout);
      this.consecutiveErrors++;
      return null;
    }
  }

  /**
   * Stop frame capture and reset state.
   */
  stop() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    this.frameBuffer = [];
    this.isAnalyzing = false;
  }

  /**
   * Reset state machine to initial values.
   */
  reset() {
    this.stop();
    this.gameState = 'unknown';
    this.stateConfidence = 0;
    this.stateHoldFrames = 0;
    this.pendingState = null;
    this.lastAnalysis = null;
    this.shotContext = 'none';
    this.ballVisible = false;
    this.courtSide = 'unknown';
    this.playerCount = 0;
    this.lastUpdateTime = 0;
    this.rollingFrameBuffer = [];
    this.isAnalyzingStroke = false;
  }

  /**
   * POST last 3 frames to Gemini, parse structured JSON, update state machine.
   */
  async analyze() {
    if (this.isAnalyzing || this.frameBuffer.length < 3) return;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      console.warn('SceneAnalyzer: too many consecutive errors, pausing analysis');
      return;
    }

    this.isAnalyzing = true;

    const frames = [...this.frameBuffer]; // snapshot

    const requestBody = {
      contents: [{
        parts: [
          ...frames.map(base64 => ({
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64
            }
          })),
          {
            text: `You are analyzing a tennis practice/match scene from a phone camera.
Analyze the frames (in chronological order, ~5 seconds apart) and determine:

1. pointState: "serving" | "rallying" | "between_points" | "warmup" | "idle"
2. shotContext: "serve" | "return" | "rally_groundstroke" | "approach" | "volley" | "overhead" | "none"
3. ballVisible: true/false
4. courtSide: "deuce" | "ad" | "unknown"
5. playerCount: integer
6. courtPosition: { zone, lateralPosition, recoveryPosition }
7. confidence: 0.0 to 1.0`
          }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            pointState: { type: 'STRING', enum: ['serving', 'rallying', 'between_points', 'warmup', 'idle'] },
            shotContext: { type: 'STRING', enum: ['serve', 'return', 'rally_groundstroke', 'approach', 'volley', 'overhead', 'none'] },
            ballVisible: { type: 'BOOLEAN' },
            courtSide: { type: 'STRING', enum: ['deuce', 'ad', 'unknown'] },
            playerCount: { type: 'INTEGER' },
            courtPosition: {
              type: 'OBJECT',
              properties: {
                zone: { type: 'STRING', enum: ['baseline', 'no_mans_land', 'service_line', 'net', 'unknown'] },
                lateralPosition: { type: 'STRING', enum: ['wide_deuce', 'center', 'wide_ad', 'unknown'] },
                recoveryPosition: { type: 'STRING', enum: ['center', 'good', 'out_of_position', 'unknown'] }
              },
              required: ['zone']
            },
            confidence: { type: 'NUMBER' }
          },
          required: ['pointState', 'shotContext', 'ballVisible', 'courtSide', 'playerCount', 'confidence']
        },
        temperature: 0.1,
        maxOutputTokens: 200
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        console.warn(`SceneAnalyzer: Gemini API error ${response.status}`, errorText);
        this.consecutiveErrors++;
        this.isAnalyzing = false;
        return;
      }

      const data = await response.json();

      // Parse Gemini response
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.warn('SceneAnalyzer: no text in Gemini response');
        this.consecutiveErrors++;
        this.isAnalyzing = false;
        return;
      }

      let sceneData;
      try {
        sceneData = JSON.parse(text);
      } catch (e) {
        // Try stripping markdown code blocks
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        sceneData = JSON.parse(cleaned);
      }

      this.consecutiveErrors = 0;
      this.lastAnalysis = sceneData;
      this.lastUpdateTime = Date.now();

      // Update observable fields
      this.shotContext = sceneData.shotContext || 'none';
      this.ballVisible = !!sceneData.ballVisible;
      this.courtSide = sceneData.courtSide || 'unknown';
      this.playerCount = sceneData.playerCount || 0;

      // Update state machine with hysteresis
      this.updateStateMachine(sceneData);

    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        console.warn('SceneAnalyzer: Gemini API call timed out');
      } else {
        console.warn('SceneAnalyzer: analysis failed', e);
      }
      this.consecutiveErrors++;
    }

    this.isAnalyzing = false;
  }

  /**
   * State machine transitions with hysteresis.
   * Requires consistent readings before transitioning to prevent flicker.
   */
  updateStateMachine(sceneData) {
    const newState = sceneData.pointState;
    const confidence = sceneData.confidence || 0;

    if (!newState) return;

    // First reading — accept immediately
    if (this.gameState === 'unknown') {
      this.transitionTo(newState, sceneData);
      return;
    }

    // Same state — reset hysteresis
    if (newState === this.gameState) {
      this.pendingState = null;
      this.stateHoldFrames = 0;
      this.stateConfidence = confidence;
      return;
    }

    // Determine required hold frames and confidence threshold
    let requiredHold = 2;
    let requiredConfidence = 0.6;

    if (newState === 'idle') {
      requiredHold = 3;
      requiredConfidence = 0.8;
    } else if (this.gameState === 'rallying' && newState === 'between_points') {
      // Higher threshold to prevent premature point-end
      requiredConfidence = 0.7;
    } else if (this.gameState === 'warmup') {
      requiredConfidence = 0.7;
    }

    // Fast path: serving → rallying can happen on first reading (once serve detected)
    if (this.gameState === 'serving' && newState === 'rallying' && confidence > 0.5) {
      this.transitionTo(newState, sceneData);
      return;
    }

    // Hysteresis: need consistent readings
    if (confidence >= requiredConfidence) {
      if (this.pendingState === newState) {
        this.stateHoldFrames++;
        if (this.stateHoldFrames >= requiredHold) {
          this.transitionTo(newState, sceneData);
        }
      } else {
        this.pendingState = newState;
        this.stateHoldFrames = 1;
      }
    } else {
      // Low confidence — don't transition
      this.pendingState = null;
      this.stateHoldFrames = 0;
    }
  }

  /**
   * Execute a state transition and fire callback.
   */
  transitionTo(newState, sceneData) {
    const oldState = this.gameState;
    this.gameState = newState;
    this.stateConfidence = sceneData.confidence || 0;
    this.pendingState = null;
    this.stateHoldFrames = 0;

    console.log(`SceneAnalyzer: ${oldState} → ${newState} (conf: ${this.stateConfidence.toFixed(2)})`);

    if (this.onStateChange && oldState !== newState) {
      try {
        this.onStateChange(oldState, newState, sceneData);
      } catch (e) {
        console.error('SceneAnalyzer: onStateChange callback error', e);
      }
    }
  }

  /**
   * Notify the state machine that a serve was detected by pose analysis.
   * Can accelerate serving → rallying transition.
   */
  onServeDetected() {
    if (this.gameState === 'between_points' || this.gameState === 'unknown') {
      this.transitionTo('serving', {
        pointState: 'serving',
        shotContext: 'serve',
        confidence: 0.9,
        ballVisible: this.ballVisible,
        courtSide: this.courtSide,
        playerCount: this.playerCount
      });
    }
  }

  /**
   * Get current state snapshot for external consumers.
   */
  getState() {
    return {
      gameState: this.gameState,
      shotContext: this.shotContext,
      ballVisible: this.ballVisible,
      courtSide: this.courtSide,
      playerCount: this.playerCount,
      confidence: this.stateConfidence,
      lastUpdateTime: this.lastUpdateTime,
      enabled: this.enabled
    };
  }
}
