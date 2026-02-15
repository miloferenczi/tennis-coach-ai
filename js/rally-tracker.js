/**
 * RallyTracker - Point and rally lifecycle tracking
 *
 * Tracks rally boundaries (start/end), stroke counts per rally,
 * serve vs feed classification, and session-level rally statistics.
 * Powered by SceneAnalyzer state transitions.
 */
class RallyTracker {
  constructor() {
    this.currentRally = null;        // active rally or null
    this.completedRallies = [];      // finished rally objects
    this.sessionStats = {
      totalRallies: 0,
      totalServePoints: 0,
      totalFeeds: 0,
      totalStrokesInRallies: 0
    };
    this.rallyCounter = 0;
    this.lastRallyAnalysis = null;   // most recent Gemini rally analysis
  }

  /**
   * Called by SceneAnalyzer.onStateChange callback.
   */
  onStateChange(oldState, newState, sceneData) {
    if (newState === 'serving' && (oldState === 'between_points' || oldState === 'unknown' || oldState === 'warmup')) {
      // New serve point starting
      this.startRally('serve', sceneData?.courtSide || 'unknown');
    } else if (newState === 'rallying' && !this.currentRally) {
      // Rallying started without a serve → likely a feed/drill
      this.startRally('feed', sceneData?.courtSide || 'unknown');
    } else if (newState === 'between_points' && this.currentRally) {
      // Point ended
      this.endRally();
    } else if (newState === 'idle' && this.currentRally) {
      // Extended idle — end any active rally
      this.endRally();
    }
  }

  /**
   * Start a new rally.
   * @param {string} origin - 'serve' or 'feed'
   * @param {string} courtSide - 'deuce', 'ad', or 'unknown'
   */
  startRally(origin, courtSide) {
    // End any existing rally first
    if (this.currentRally) {
      this.endRally();
    }

    this.rallyCounter++;
    this.currentRally = {
      number: this.rallyCounter,
      strokes: [],
      startTime: Date.now(),
      endTime: null,
      origin: origin,           // 'serve' or 'feed'
      courtSide: courtSide,
      duration: 0,
      avgQuality: 0
    };

    console.log(`RallyTracker: rally #${this.rallyCounter} started (${origin}, ${courtSide})`);
  }

  /**
   * Add a stroke to the current rally.
   * Auto-starts a rally if none is active (fallback for when SceneAnalyzer is disabled).
   */
  addStroke(strokeData) {
    if (!this.currentRally) {
      // Auto-start as feed if no rally active
      this.startRally('feed', 'unknown');
    }

    this.currentRally.strokes.push({
      type: strokeData.type || strokeData.strokeType,
      quality: strokeData.quality?.overall ?? strokeData.quality ?? 0,
      timestamp: Date.now(),
      strokeInRally: this.currentRally.strokes.length + 1
    });
  }

  /**
   * End the current rally, compute stats, push to completed list.
   * If Gemini is enabled and rally had 3+ strokes, fire async tactical analysis.
   */
  endRally() {
    if (!this.currentRally) return;

    const rally = this.currentRally;
    rally.endTime = Date.now();
    rally.duration = rally.endTime - rally.startTime;

    // Compute average quality
    if (rally.strokes.length > 0) {
      const totalQ = rally.strokes.reduce((sum, s) => sum + s.quality, 0);
      rally.avgQuality = Math.round(totalQ / rally.strokes.length);
    }

    this.completedRallies.push(rally);

    // Update session stats
    this.sessionStats.totalRallies++;
    this.sessionStats.totalStrokesInRallies += rally.strokes.length;
    if (rally.origin === 'serve') {
      this.sessionStats.totalServePoints++;
    } else {
      this.sessionStats.totalFeeds++;
    }

    console.log(`RallyTracker: rally #${rally.number} ended (${rally.strokes.length} strokes, ${rally.avgQuality} avg quality, ${(rally.duration / 1000).toFixed(1)}s)`);

    // Fire async Gemini rally analysis if available and rally was substantial
    if (rally.strokes.length >= 3 && typeof tennisAI !== 'undefined' && tennisAI.sceneAnalyzer?.enabled) {
      const rallySnapshot = { ...rally };
      const timeWindow = { startTime: rally.startTime, endTime: rally.endTime };
      tennisAI.sceneAnalyzer.analyzeRally(rallySnapshot, timeWindow).then(result => {
        if (result && typeof tennisAI !== 'undefined') {
          rallySnapshot.geminiAnalysis = result;
          this.lastRallyAnalysis = result;
          // Queue rally analysis for next batch coaching prompt
          if (tennisAI.batchAccumulator) {
            tennisAI.batchAccumulator.addRallyAnalysis({
              rallyNumber: rallySnapshot.number,
              strokeCount: rallySnapshot.strokes.length,
              avgQuality: rallySnapshot.avgQuality,
              origin: rallySnapshot.origin,
              analysis: result
            });
          } else if (tennisAI.gptVoiceCoach?.isConnected) {
            // Fallback: send directly to GPT (backward compat)
            tennisAI.gptVoiceCoach.analyzeStroke({
              type: 'rally_analysis',
              rallyNumber: rallySnapshot.number,
              strokeCount: rallySnapshot.strokes.length,
              avgQuality: rallySnapshot.avgQuality,
              origin: rallySnapshot.origin,
              analysis: result
            });
          }
        }
      }).catch(e => {
        console.warn('RallyTracker: Gemini rally analysis failed', e);
      });
    }

    this.currentRally = null;
  }

  /**
   * Get the most recent Gemini rally analysis (for session summary).
   */
  getLastRallyAnalysis() {
    return this.lastRallyAnalysis || null;
  }

  /**
   * Get comprehensive session statistics for rally data.
   */
  getSessionStats() {
    const rallies = this.completedRallies;
    const active = this.currentRally;

    if (rallies.length === 0 && !active) {
      return {
        totalRallies: 0,
        totalPoints: 0,
        totalFeeds: 0,
        avgRallyLength: 0,
        longestRally: 0,
        servePercentage: 0,
        strokeDistribution: {},
        avgPointQuality: 0,
        recentTrend: 'none',
        currentRallyStrokes: active ? active.strokes.length : 0
      };
    }

    const lengths = rallies.map(r => r.strokes.length);
    const avgLength = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    const longestRally = lengths.length > 0 ? Math.max(...lengths) : 0;

    const servePoints = rallies.filter(r => r.origin === 'serve').length;
    const servePercentage = rallies.length > 0 ? Math.round((servePoints / rallies.length) * 100) : 0;

    // Stroke type distribution across all rallies
    const strokeDist = {};
    for (const r of rallies) {
      for (const s of r.strokes) {
        strokeDist[s.type] = (strokeDist[s.type] || 0) + 1;
      }
    }

    // Average quality across all rallies
    const qualScores = rallies.filter(r => r.avgQuality > 0).map(r => r.avgQuality);
    const avgPointQuality = qualScores.length > 0
      ? Math.round(qualScores.reduce((a, b) => a + b, 0) / qualScores.length)
      : 0;

    // Recent trend: compare last 3 rallies vs previous 3
    let recentTrend = 'stable';
    if (rallies.length >= 6) {
      const recent3 = rallies.slice(-3).reduce((s, r) => s + r.avgQuality, 0) / 3;
      const prev3 = rallies.slice(-6, -3).reduce((s, r) => s + r.avgQuality, 0) / 3;
      if (recent3 > prev3 + 3) recentTrend = 'improving';
      else if (recent3 < prev3 - 3) recentTrend = 'declining';
    }

    return {
      totalRallies: rallies.length,
      totalPoints: servePoints,
      totalFeeds: rallies.length - servePoints,
      avgRallyLength: Math.round(avgLength * 10) / 10,
      longestRally,
      servePercentage,
      strokeDistribution: strokeDist,
      avgPointQuality,
      recentTrend,
      currentRallyStrokes: active ? active.strokes.length : 0
    };
  }

  /**
   * Format rally context for GPT system prompt.
   */
  formatForCoachingPrompt() {
    const stats = this.getSessionStats();
    if (stats.totalRallies === 0 && stats.currentRallyStrokes === 0) return '';

    let block = '\nRALLY CONTEXT:\n';
    if (stats.totalRallies > 0) {
      block += `- Rallies completed: ${stats.totalRallies}`;
      if (stats.totalPoints > 0) block += ` (${stats.totalPoints} serve points, ${stats.totalFeeds} feeds)`;
      block += `\n`;
      block += `- Average rally length: ${stats.avgRallyLength} strokes\n`;
      block += `- Longest rally: ${stats.longestRally} strokes\n`;
      if (stats.avgPointQuality > 0) {
        block += `- Average point quality: ${stats.avgPointQuality}/100\n`;
      }
      if (stats.recentTrend !== 'stable' && stats.recentTrend !== 'none') {
        block += `- Recent trend: ${stats.recentTrend}\n`;
      }
    }

    if (this.currentRally) {
      block += `- Currently in rally #${this.currentRally.number} (${this.currentRally.origin}, stroke #${this.currentRally.strokes.length + 1})\n`;
    }

    return block;
  }

  /**
   * Format per-stroke rally context for the GPT stroke prompt.
   */
  formatForStrokePrompt(strokeData) {
    if (!this.currentRally) return '';

    const rally = this.currentRally;
    const strokeNum = rally.strokes.length; // already added by the time prompt is built
    let line = `RALLY: #${rally.number}, stroke ${strokeNum} of this ${rally.origin} point`;
    if (rally.courtSide !== 'unknown') {
      line += ` (${rally.courtSide} court)`;
    }
    return line + '\n';
  }

  /**
   * Clear all rally data.
   */
  reset() {
    if (this.currentRally) {
      this.endRally();
    }
    this.currentRally = null;
    this.completedRallies = [];
    this.sessionStats = {
      totalRallies: 0,
      totalServePoints: 0,
      totalFeeds: 0,
      totalStrokesInRallies: 0
    };
    this.rallyCounter = 0;
    this.lastRallyAnalysis = null;
  }
}
