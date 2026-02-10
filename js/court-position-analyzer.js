/**
 * CourtPositionAnalyzer - Tracks player court positioning from scene analysis
 *
 * Processes court position data from Gemini's extended scene analysis to detect:
 * - No-man's-land lingering (between baseline and service line)
 * - Recovery quality (returning to center after shots)
 * - Split-step detection at net
 * - Position relative to court zones
 */
class CourtPositionAnalyzer {
  constructor() {
    this.positionHistory = [];       // recent position readings
    this.maxHistory = 20;
    this.noMansLandFrames = 0;       // consecutive frames in no-man's land
    this.noMansLandThreshold = 3;    // frames before flagging
    this.lastRecoveryPosition = null;
    this.recoveryQuality = null;
    this.splitStepDetected = false;
  }

  /**
   * Update with new scene analysis data containing court position info.
   * @param {Object} sceneData - from Gemini scene analysis (extended)
   */
  update(sceneData) {
    if (!sceneData || !sceneData.courtPosition) return;

    const pos = sceneData.courtPosition;
    this.positionHistory.push({
      zone: pos.zone || 'unknown',            // baseline, no_mans_land, service_line, net
      lateralPosition: pos.lateralPosition || 'center',  // wide_deuce, center, wide_ad
      recoveryPosition: pos.recoveryPosition || 'unknown',
      timestamp: Date.now()
    });

    if (this.positionHistory.length > this.maxHistory) {
      this.positionHistory.shift();
    }

    // Track no-man's-land lingering
    if (pos.zone === 'no_mans_land') {
      this.noMansLandFrames++;
    } else {
      this.noMansLandFrames = 0;
    }

    // Track recovery quality
    if (pos.recoveryPosition === 'center' || pos.recoveryPosition === 'good') {
      this.recoveryQuality = 'good';
      this.lastRecoveryPosition = pos;
    } else if (pos.recoveryPosition === 'out_of_position') {
      this.recoveryQuality = 'poor';
    }

    // Net-specific: split step
    if (pos.zone === 'net' || pos.zone === 'service_line') {
      this.splitStepDetected = !!pos.splitStepDetected;
    }
  }

  /**
   * Get coaching-orchestrator-compatible metrics.
   */
  getMetrics() {
    return {
      courtZone: this.getCurrentZone(),
      lingeringNoMansLand: this.noMansLandFrames >= this.noMansLandThreshold,
      noMansLandFrames: this.noMansLandFrames,
      recoveryQuality: this.recoveryQuality,
      splitStepAtNet: this.splitStepDetected,
      positionScore: this.calculatePositionScore()
    };
  }

  /**
   * Get the most recent court zone.
   */
  getCurrentZone() {
    if (this.positionHistory.length === 0) return 'unknown';
    return this.positionHistory[this.positionHistory.length - 1].zone;
  }

  /**
   * Calculate a composite position score (0-100).
   */
  calculatePositionScore() {
    if (this.positionHistory.length < 3) return 70; // default

    let score = 70;

    // Penalize no-man's-land lingering
    if (this.noMansLandFrames >= this.noMansLandThreshold) {
      score -= 20;
    } else if (this.noMansLandFrames > 0) {
      score -= this.noMansLandFrames * 5;
    }

    // Reward good recovery
    const recentRecoveries = this.positionHistory.slice(-5)
      .filter(p => p.recoveryPosition === 'center' || p.recoveryPosition === 'good');
    if (recentRecoveries.length >= 3) {
      score += 15;
    }

    // Reward split step at net
    if (this.splitStepDetected) {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Format court position data for GPT prompt.
   */
  formatForPrompt() {
    const metrics = this.getMetrics();
    if (metrics.courtZone === 'unknown') return '';

    let block = 'COURT POSITION:\n';
    block += `- Zone: ${metrics.courtZone}\n`;

    if (metrics.lingeringNoMansLand) {
      block += `- WARNING: lingering in no-man's land (${metrics.noMansLandFrames} readings)\n`;
    }

    if (metrics.recoveryQuality) {
      block += `- Recovery: ${metrics.recoveryQuality}\n`;
    }

    if (metrics.splitStepAtNet) {
      block += `- Split step: detected\n`;
    }

    block += `- Position score: ${metrics.positionScore}/100\n`;

    return block;
  }

  /**
   * Reset all state.
   */
  reset() {
    this.positionHistory = [];
    this.noMansLandFrames = 0;
    this.lastRecoveryPosition = null;
    this.recoveryQuality = null;
    this.splitStepDetected = false;
  }
}
