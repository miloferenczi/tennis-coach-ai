/**
 * AdaptiveThresholds — Per-player metric threshold personalization
 *
 * After 5+ sessions, computes player-specific threshold offsets from the
 * coaching tree defaults. "This player's natural elbow angle is 155, not 170."
 *
 * Stores computed thresholds in improvement_tracker.adaptive_thresholds.
 */
class AdaptiveThresholds {
  constructor() {
    this.thresholds = {}; // { metricName: { playerMedian, defaultValue, offset, sessions } }
    this.minSessions = 5;
    this.isLoaded = false;
  }

  /**
   * Initialize from ImprovementTracker data (which loads from Supabase or localStorage).
   */
  async init() {
    if (typeof improvementTracker !== 'undefined' && improvementTracker.isLoaded) {
      // Load persisted thresholds from tracker data
      const raw = improvementTracker.data?.adaptiveThresholds;
      if (raw && typeof raw === 'object') {
        this.thresholds = raw;
      }
    }
    this.isLoaded = true;
  }

  /**
   * Recompute adaptive thresholds from ImprovementTracker session history.
   * Called at session end after improvementTracker.recordSession().
   */
  recompute() {
    if (typeof improvementTracker === 'undefined' || !improvementTracker.isLoaded) return;

    const strokeMetrics = improvementTracker.data?.strokeMetrics;
    if (!strokeMetrics) return;

    // Collect all session entries across stroke types
    const metricSamples = {
      rotation: [],
      hipSep: [],
      elbowAngle: [],
      smoothness: [],
      quality: [],
      formScore: []
    };

    let totalSessions = 0;

    for (const [strokeType, sessions] of Object.entries(strokeMetrics)) {
      if (!Array.isArray(sessions)) continue;
      totalSessions = Math.max(totalSessions, sessions.length);

      for (const s of sessions) {
        if (s.avgRotation != null) metricSamples.rotation.push(s.avgRotation);
        if (s.avgHipSep != null) metricSamples.hipSep.push(s.avgHipSep);
        if (s.avgElbowAngle != null) metricSamples.elbowAngle.push(s.avgElbowAngle);
        if (s.avgSmoothness != null) metricSamples.smoothness.push(s.avgSmoothness);
        if (s.avgQuality != null) metricSamples.quality.push(s.avgQuality);
        if (s.avgFormScore != null) metricSamples.formScore.push(s.avgFormScore);
      }
    }

    // Need 5+ sessions before we adapt
    if (totalSessions < this.minSessions) return;

    // Get skill level for default targets
    let skillLevel = 'intermediate';
    if (typeof playerProfile !== 'undefined') {
      const ctx = playerProfile.getCoachingContext();
      if (ctx.skillLevel) skillLevel = ctx.skillLevel;
    }
    const defaults = this._getDefaults(skillLevel);

    // Compute per-metric thresholds
    for (const [metric, samples] of Object.entries(metricSamples)) {
      if (samples.length < 5) continue;

      const median = this._median(samples);
      const defaultVal = defaults[metric];
      if (defaultVal == null) continue;

      const offset = median - defaultVal;

      this.thresholds[metric] = {
        playerMedian: Math.round(median * 10) / 10,
        defaultValue: defaultVal,
        offset: Math.round(offset * 10) / 10,
        sessions: samples.length
      };
    }

    // Persist to improvement_tracker
    this._persist();
  }

  /**
   * Get an adjusted threshold value for a given metric.
   * Blends the coaching tree default toward the player's actual median.
   * @param {string} metricName
   * @param {number} defaultValue - coaching tree default
   * @returns {number} adjusted value
   */
  getAdjustedThreshold(metricName, defaultValue) {
    const entry = this.thresholds[metricName];
    if (!entry || entry.sessions < 5) return defaultValue;

    // Blend: 70% default + 30% player median (don't fully override coaching standards)
    const blendWeight = 0.3;
    return defaultValue + (entry.offset * blendWeight);
  }

  /**
   * Get all adjusted thresholds as an object for condition evaluation.
   * Returns only metrics with enough data.
   * @returns {Object} { metricName: adjustedValue }
   */
  getAllAdjusted() {
    const result = {};
    for (const [metric, entry] of Object.entries(this.thresholds)) {
      if (entry.sessions >= 5) {
        result[metric] = entry;
      }
    }
    return result;
  }

  /**
   * Format ~200 char block for GPT system prompt.
   */
  formatForSystemPrompt() {
    const adapted = Object.entries(this.thresholds)
      .filter(([_, e]) => e.sessions >= 5 && Math.abs(e.offset) > 2);

    if (adapted.length === 0) return '';

    const metricLabels = {
      rotation: 'body rotation',
      hipSep: 'hip-shoulder separation',
      elbowAngle: 'elbow angle',
      smoothness: 'swing smoothness',
      quality: 'quality score',
      formScore: 'form score'
    };

    let block = '\nPLAYER-SPECIFIC BASELINES (adapted from their history):\n';
    for (const [metric, entry] of adapted) {
      const label = metricLabels[metric] || metric;
      const dir = entry.offset > 0 ? 'above' : 'below';
      block += `- ${label}: personal median ${entry.playerMedian} (${Math.abs(entry.offset)} ${dir} standard), across ${entry.sessions} samples\n`;
    }
    block += 'Coach relative to their baseline — improvements from their personal median are meaningful.\n';

    return block;
  }

  /**
   * Format brief context for batch prompts.
   */
  formatForBatchPrompt(summaries) {
    const adapted = Object.entries(this.thresholds)
      .filter(([_, e]) => e.sessions >= 5 && Math.abs(e.offset) > 2);

    if (adapted.length === 0) return '';

    let block = 'ADAPTIVE BASELINES: ';
    const parts = [];
    for (const [metric, entry] of adapted.slice(0, 3)) {
      parts.push(`${metric} median=${entry.playerMedian}`);
    }
    block += parts.join(', ');
    block += '. Judge improvement relative to these.';
    return block;
  }

  /**
   * Get default targets by skill level.
   */
  _getDefaults(skillLevel) {
    const targets = {
      beginner:     { rotation: 15, hipSep: 20, elbowAngle: 135, smoothness: 50, quality: 50, formScore: 45 },
      intermediate: { rotation: 20, hipSep: 35, elbowAngle: 145, smoothness: 65, quality: 65, formScore: 60 },
      advanced:     { rotation: 25, hipSep: 45, elbowAngle: 155, smoothness: 75, quality: 75, formScore: 70 },
      elite:        { rotation: 30, hipSep: 55, elbowAngle: 160, smoothness: 85, quality: 85, formScore: 80 }
    };
    return targets[skillLevel] || targets.intermediate;
  }

  /**
   * Compute median of an array.
   */
  _median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Persist thresholds via ImprovementTracker's data and save method.
   */
  async _persist() {
    if (typeof improvementTracker === 'undefined') return;
    improvementTracker.data.adaptiveThresholds = this.thresholds;
    await improvementTracker.save();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdaptiveThresholds;
} else {
  window.AdaptiveThresholds = AdaptiveThresholds;
}
