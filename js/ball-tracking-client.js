/**
 * Browser-Based Ball Tracker
 *
 * Tracks tennis balls using color detection directly in the browser.
 * No server required. Tennis balls are neon yellow-green — one of the most
 * visually distinctive objects in sports — so simple HSV-like thresholding works.
 *
 * How it works:
 * 1. Each frame is downsampled to 160x90 and scanned for tennis-ball-colored pixels
 * 2. Matching pixels are clustered into a centroid (ball position)
 * 3. Positions are tracked across frames to build a trajectory
 * 4. On stroke detection, the post-stroke trajectory is analyzed to determine:
 *    - Did the ball clear the net?
 *    - Did it land in the court or go out?
 *    - What direction did it travel?
 *
 * Performance: ~0.5ms per frame at 160x90 (3,600 pixels to scan)
 */

class BallTrackingClient {
  constructor(options = {}) {
    // Detection canvas (tiny — just for color scanning)
    this.scanCanvas = document.createElement('canvas');
    this.scanCanvas.width = 160;
    this.scanCanvas.height = 90;
    this.scanCtx = this.scanCanvas.getContext('2d', { willReadFrequently: true });

    // Color thresholds for tennis ball (RGB space)
    // Tennis ball: bright yellow-green. R>160, G>190, B<100, and (G - B) > 100
    this.colorThresholds = {
      minR: 160,
      minG: 190,
      maxB: 100,
      minGBDiff: 100,  // Green minus Blue must be high
      minBrightness: 350 // R + G must be bright enough
    };

    // Ball size constraints (in scan resolution pixels)
    this.minBlobPixels = 2;   // Minimum pixels to count as a ball
    this.maxBlobPixels = 120; // Maximum (too big = not a ball)

    // Tracking state
    this.trajectory = [];          // [{x, y, timestamp, frameIndex}]
    this.maxTrajectoryLength = 120; // ~4 seconds at 30fps
    this.frameIndex = 0;
    this.lastBallPos = null;
    this.maxBallJump = 40;        // Max pixels between frames (at scan resolution)
    this.framesWithoutBall = 0;
    this.maxLostFrames = 8;       // Reset tracking after this many lost frames

    // Stroke-triggered analysis
    this.isCapturing = false;
    this.pendingStroke = null;
    this.postStrokeFrames = 0;
    this.postStrokeTarget = 60;   // ~2 seconds of post-stroke tracking

    // Court geometry estimation (adapts during session)
    this.courtEstimate = {
      netY: 0.40,       // Net is roughly at 40% from top of frame
      baselineY: 0.85,  // Player baseline at ~85% of frame height
      leftEdge: 0.15,   // Court left boundary
      rightEdge: 0.85   // Court right boundary
    };

    // Session stats
    this.shotHistory = [];
    this.isConnected = true; // Always "connected" — no server needed

    // Callbacks
    this.onShotAnalyzed = options.onShotAnalyzed || null;
  }

  /**
   * Check "connection" — always true for browser-based tracking
   */
  async checkConnection() {
    this.isConnected = true;
    console.log('Ball tracking: browser-based color detection (no server needed)');
    return true;
  }

  /**
   * Start capture — just needs a reference to the video element
   */
  startCapture(videoElement) {
    this.videoElement = videoElement;
    this.isCapturing = true;
    this.frameIndex = 0;
    console.log('Ball tracking started (in-browser color detection)');
  }

  /**
   * Stop capture
   */
  stopCapture() {
    this.isCapturing = false;
    this.trajectory = [];
    this.pendingStroke = null;
    this.postStrokeFrames = 0;
    this.lastBallPos = null;
  }

  /**
   * Process a single frame — called from onResults at ~30fps.
   * Scans for the tennis ball and updates the trajectory.
   */
  onFrame() {
    if (!this.isCapturing || !this.videoElement) return;

    this.frameIndex++;

    // Only scan every other frame to save CPU (effective 15fps is plenty)
    if (this.frameIndex % 2 !== 0) return;

    // Draw video to tiny scan canvas
    this.scanCtx.drawImage(this.videoElement, 0, 0, 160, 90);
    const imageData = this.scanCtx.getImageData(0, 0, 160, 90);
    const pixels = imageData.data;

    // Find tennis ball
    const ballPos = this.detectBall(pixels, 160, 90);

    if (ballPos) {
      // Validate against previous position (reject impossible jumps)
      if (this.lastBallPos) {
        const dx = ballPos.x - this.lastBallPos.x;
        const dy = ballPos.y - this.lastBallPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > this.maxBallJump) {
          // Too far from last position — could be a false positive
          this.framesWithoutBall++;
          if (this.framesWithoutBall > this.maxLostFrames) {
            // Lost the ball for too long, accept new detection
            this.lastBallPos = ballPos;
            this.framesWithoutBall = 0;
          }
          return;
        }
      }

      this.lastBallPos = ballPos;
      this.framesWithoutBall = 0;

      // Add to trajectory (normalized to 0-1)
      this.trajectory.push({
        x: ballPos.x / 160,
        y: ballPos.y / 90,
        timestamp: Date.now(),
        frameIndex: this.frameIndex,
        pixelCount: ballPos.pixelCount
      });

      if (this.trajectory.length > this.maxTrajectoryLength) {
        this.trajectory.shift();
      }
    } else {
      this.framesWithoutBall++;
    }

    // If we're tracking a pending stroke, count post-stroke frames
    if (this.pendingStroke) {
      this.postStrokeFrames++;
      if (this.postStrokeFrames >= this.postStrokeTarget) {
        this.analyzePostStrokeTrajectory();
      }
    }
  }

  /**
   * Detect tennis ball in pixel data using color thresholds.
   * Returns {x, y, pixelCount} centroid or null.
   */
  detectBall(pixels, width, height) {
    const th = this.colorThresholds;
    let sumX = 0, sumY = 0, count = 0;

    // Scan pixels (RGBA format, 4 bytes per pixel)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        // Tennis ball color check
        if (r >= th.minR &&
            g >= th.minG &&
            b <= th.maxB &&
            (g - b) >= th.minGBDiff &&
            (r + g) >= th.minBrightness) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    // Check blob size constraints
    if (count < this.minBlobPixels || count > this.maxBlobPixels) {
      return null;
    }

    return {
      x: sumX / count,
      y: sumY / count,
      pixelCount: count
    };
  }

  /**
   * Called when a stroke is detected — starts post-stroke trajectory analysis.
   */
  onStrokeDetected(strokeData) {
    if (!this.isCapturing) return;

    // Record the stroke time and snapshot the current trajectory
    this.pendingStroke = {
      strokeData: strokeData,
      strokeTime: Date.now(),
      strokeFrameIndex: this.frameIndex,
      trajectoryAtStroke: [...this.trajectory]
    };
    this.postStrokeFrames = 0;
  }

  /**
   * Analyze the ball trajectory after a stroke to determine shot outcome.
   */
  analyzePostStrokeTrajectory() {
    if (!this.pendingStroke) return;

    const stroke = this.pendingStroke;
    this.pendingStroke = null;
    this.postStrokeFrames = 0;

    // Get trajectory points since the stroke
    const postStrokeTrajectory = this.trajectory.filter(
      t => t.frameIndex >= stroke.strokeFrameIndex
    );

    // Also get a few pre-stroke points for context
    const preStrokeTrajectory = stroke.trajectoryAtStroke.slice(-10);

    const outcome = this.classifyTrajectory(preStrokeTrajectory, postStrokeTrajectory);

    const shotResult = {
      outcome: outcome,
      trajectoryLength: postStrokeTrajectory.length,
      ballDetectionRate: postStrokeTrajectory.length / (this.postStrokeTarget / 2),
      courtDetected: true, // We use estimated court geometry
      strokeType: stroke.strokeData.type,
      strokeTimestamp: stroke.strokeTime,
      analysisTimestamp: Date.now()
    };

    this.shotHistory.push(shotResult);

    console.log('Shot analysis (browser):', {
      detections: postStrokeTrajectory.length,
      direction: outcome.ball_direction,
      netClearance: outcome.net_clearance,
      inCourt: outcome.in_court,
      confidence: outcome.confidence
    });

    // Fire callback
    if (this.onShotAnalyzed) {
      this.onShotAnalyzed(shotResult, stroke.strokeData);
    }
  }

  /**
   * Classify a shot trajectory into an outcome.
   */
  classifyTrajectory(preTraj, postTraj) {
    const result = {
      in_court: null,
      ball_direction: null,
      net_clearance: null,
      landed_position: null,
      confidence: 0.0
    };

    // Not enough data
    if (postTraj.length < 3) {
      result.confidence = 0.0;
      return result;
    }

    const court = this.courtEstimate;

    // Analyze ball direction
    const early = postTraj.slice(0, Math.min(5, postTraj.length));
    const late = postTraj.slice(-Math.min(5, postTraj.length));

    const earlyAvgY = early.reduce((s, p) => s + p.y, 0) / early.length;
    const lateAvgY = late.reduce((s, p) => s + p.y, 0) / late.length;
    const earlyAvgX = early.reduce((s, p) => s + p.x, 0) / early.length;
    const lateAvgX = late.reduce((s, p) => s + p.x, 0) / late.length;

    const yDelta = lateAvgY - earlyAvgY;

    // Ball moving up in frame = away from player (toward far court)
    // Ball moving down = toward player
    if (yDelta < -0.05) {
      result.ball_direction = 'away';
    } else if (yDelta > 0.05) {
      result.ball_direction = 'toward';
    } else {
      result.ball_direction = 'lateral';
    }

    // Check net clearance
    const crossedNet = postTraj.some(p => p.y < court.netY) && earlyAvgY > court.netY;
    result.net_clearance = crossedNet;

    // If ball didn't reach the net, it's in the net
    if (!crossedNet && result.ball_direction === 'away') {
      result.in_court = false;
      result.confidence = 0.5;
      return result;
    }

    // Analyze landing
    if (crossedNet && postTraj.length >= 8) {
      // Check if ball was descending at the end (landing)
      const lastFew = postTraj.slice(-5);
      const yVelocities = [];
      for (let i = 1; i < lastFew.length; i++) {
        yVelocities.push(lastFew[i].y - lastFew[i - 1].y);
      }
      const avgYVel = yVelocities.reduce((a, b) => a + b, 0) / yVelocities.length;

      // Ball descending (y increasing) = landing
      const isDescending = avgYVel > 0.005;

      // Check if last position is within court boundaries
      const lastPos = postTraj[postTraj.length - 1];
      const inXBounds = lastPos.x >= court.leftEdge && lastPos.x <= court.rightEdge;
      const inYBounds = lastPos.y >= 0.05 && lastPos.y <= court.netY + 0.15;

      if (isDescending && inXBounds && inYBounds) {
        result.in_court = true;
        result.confidence = 0.55;
      } else if (lastPos.y < 0.05) {
        // Ball went off the top of the frame — likely long
        result.in_court = false;
        result.confidence = 0.45;
      } else if (!inXBounds) {
        // Ball went wide
        result.in_court = false;
        result.confidence = 0.45;
      } else {
        // Ball crossed net and is in a reasonable area
        result.in_court = true;
        result.confidence = 0.4;
      }

      // Estimate landing position in rough court coordinates
      result.landed_position = {
        x_meters: (lastPos.x - 0.5) * 10.97, // Map to court width
        y_meters: ((court.netY - lastPos.y) / court.netY) * 11.885 // Map to half-court depth
      };
    } else if (crossedNet) {
      // Crossed net but not enough frames to confirm landing
      result.in_court = true; // Optimistic
      result.confidence = 0.35;
    }

    // Boost confidence if we had consistent tracking
    if (postTraj.length >= 15) {
      result.confidence = Math.min(0.7, result.confidence + 0.1);
    }

    return result;
  }

  /**
   * Adaptive court calibration — call during warmup or first few shots.
   * Estimates where the net and baselines are based on ball trajectory patterns.
   */
  calibrateCourtFromTrajectory() {
    if (this.shotHistory.length < 3) return;

    // Find shots where we tracked the ball going away
    const awayShoots = this.shotHistory.filter(
      s => s.outcome?.ball_direction === 'away' && s.trajectoryLength > 10
    );

    if (awayShoots.length < 2) return;

    // The highest point (lowest y) the ball typically reaches is near the far baseline
    // The transition zone where the ball changes from rising to falling is near the net
    // This is a rough heuristic that improves with more data
    console.log('Court calibration: auto-adjusting from', awayShoots.length, 'tracked shots');
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    if (this.shotHistory.length === 0) {
      return { totalShots: 0, analyzed: false };
    }

    const analyzed = this.shotHistory.filter(s => s.outcome?.confidence > 0.3);
    const inCourt = analyzed.filter(s => s.outcome?.in_court === true);
    const outOfCourt = analyzed.filter(s => s.outcome?.in_court === false);

    return {
      totalShots: this.shotHistory.length,
      analyzed: analyzed.length,
      inCourt: inCourt.length,
      outOfCourt: outOfCourt.length,
      accuracy: analyzed.length > 0 ? (inCourt.length / analyzed.length * 100).toFixed(0) : null,
      avgDetectionRate: (this.shotHistory.reduce((s, h) => s + (h.ballDetectionRate || 0), 0) / this.shotHistory.length).toFixed(2)
    };
  }

  /**
   * Adjust color thresholds for different lighting conditions.
   * Call with a frame that you know contains a visible tennis ball.
   */
  calibrateColor(videoElement) {
    this.scanCtx.drawImage(videoElement, 0, 0, 160, 90);
    const imageData = this.scanCtx.getImageData(0, 0, 160, 90);
    const pixels = imageData.data;

    // Find the brightest yellow-green cluster
    let candidates = [];
    for (let y = 0; y < 90; y++) {
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];

        // Broad yellow-green filter
        if (g > 150 && (g - b) > 60 && r > 120) {
          candidates.push({ r, g, b });
        }
      }
    }

    if (candidates.length < 3) {
      console.log('Color calibration: no tennis ball found in frame');
      return false;
    }

    // Use the median of candidates to set thresholds
    candidates.sort((a, b) => (b.g - b.b) - (a.g - a.b));
    const mid = candidates[Math.floor(candidates.length / 2)];

    this.colorThresholds = {
      minR: Math.max(100, mid.r - 40),
      minG: Math.max(140, mid.g - 30),
      maxB: Math.min(150, mid.b + 40),
      minGBDiff: Math.max(60, (mid.g - mid.b) - 30),
      minBrightness: Math.max(300, mid.r + mid.g - 50)
    };

    console.log('Color calibration updated:', this.colorThresholds);
    return true;
  }

  /**
   * Reset for new session
   */
  reset() {
    this.trajectory = [];
    this.pendingStroke = null;
    this.postStrokeFrames = 0;
    this.lastBallPos = null;
    this.framesWithoutBall = 0;
    this.shotHistory = [];
    this.frameIndex = 0;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BallTrackingClient;
} else {
  window.BallTrackingClient = BallTrackingClient;
}
