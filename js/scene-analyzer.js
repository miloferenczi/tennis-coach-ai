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

    // Create offscreen canvas for frame capture
    this.captureCanvas = document.createElement('canvas');
    this.captureCanvas.width = 320;
    this.captureCanvas.height = 180;
    this.captureCtx = this.captureCanvas.getContext('2d');
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
6. confidence: 0.0 to 1.0`
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
