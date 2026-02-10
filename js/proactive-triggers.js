/**
 * ProactiveTriggers - Detects patterns that should trigger unsolicited coaching
 *
 * Triggers:
 * 1. 3x same fault → pattern alert ("I'm noticing a pattern...")
 * 2. Quality spike → praise
 * 3. Curriculum target hit → celebrate
 * 4. Fatigue detected → rest suggestion
 * 5. Personal best → call out
 */
class ProactiveTriggers {
  constructor() {
    this.recentFaults = [];          // last N fault IDs
    this.maxFaultHistory = 10;
    this.personalBestQuality = 0;
    this.triggerCooldowns = {};      // trigger_id → last fire timestamp
    this.cooldownMs = 30000;         // 30s cooldown per trigger type
  }

  /**
   * Check if any proactive trigger fires for this stroke.
   * @param {Object} strokeData - full stroke data
   * @param {Object} sessionStats - from enhanced-tennis-analyzer
   * @returns {{ type: string, message: string }|null}
   */
  check(strokeData, sessionStats) {
    const now = Date.now();
    const quality = strokeData.quality?.overall ?? strokeData.quality ?? 0;

    // Track faults
    const faults = strokeData.biomechanicalEvaluation?.detectedFaults || [];
    for (const f of faults) {
      this.recentFaults.push(f.id || f.name);
      if (this.recentFaults.length > this.maxFaultHistory) {
        this.recentFaults.shift();
      }
    }

    // 1. Pattern alert: 3x same fault in recent history
    if (!this.isOnCooldown('pattern', now)) {
      const faultCounts = {};
      for (const fid of this.recentFaults.slice(-6)) {
        faultCounts[fid] = (faultCounts[fid] || 0) + 1;
      }
      for (const [faultId, count] of Object.entries(faultCounts)) {
        if (count >= 3) {
          this.triggerCooldowns['pattern'] = now;
          return {
            type: 'pattern_alert',
            message: `PATTERN DETECTED: "${faultId.replace(/([A-Z])/g, ' $1').trim()}" has appeared ${count} times in your last few strokes. This needs focused attention.`
          };
        }
      }
    }

    // 2. Personal best quality
    if (quality > this.personalBestQuality && this.personalBestQuality > 0 && !this.isOnCooldown('personal_best', now)) {
      this.personalBestQuality = quality;
      this.triggerCooldowns['personal_best'] = now;
      return {
        type: 'personal_best',
        message: `PERSONAL BEST this session! Quality score of ${Math.round(quality)} — that's your highest yet today. What did that feel like?`
      };
    }
    if (quality > this.personalBestQuality) {
      this.personalBestQuality = quality;
    }

    // 3. Quality spike (15+ points above session average)
    if (sessionStats && sessionStats.scores && sessionStats.scores.length >= 5) {
      const avg = sessionStats.scores.reduce((a, b) => a + b, 0) / sessionStats.scores.length;
      if (quality > avg + 15 && !this.isOnCooldown('spike', now)) {
        this.triggerCooldowns['spike'] = now;
        return {
          type: 'quality_spike',
          message: `That ${strokeData.type || 'stroke'} was ${Math.round(quality - avg)} points above your session average! What felt different?`
        };
      }
    }

    // 4. Curriculum target hit
    if (typeof improvementTracker !== 'undefined' && !this.isOnCooldown('curriculum', now)) {
      const plan = improvementTracker.getCoachingPlan();
      if (plan?.focusAreas) {
        for (const focus of plan.focusAreas) {
          if (focus.target && focus.metric && focus.strokeType) {
            if (strokeData.type === focus.strokeType) {
              const currentVal = this.getMetricFromStroke(strokeData, focus.metric);
              if (currentVal !== null && currentVal >= focus.target) {
                this.triggerCooldowns['curriculum'] = now;
                return {
                  type: 'target_hit',
                  message: `TARGET HIT! Your ${focus.metric} reached ${Math.round(currentVal)} — you hit the ${focus.target} goal from your plan!`
                };
              }
            }
          }
        }
      }
    }

    // 5. Fatigue detection: quality trending down over recent strokes
    if (sessionStats && sessionStats.scores && sessionStats.scores.length >= 10 && !this.isOnCooldown('fatigue', now)) {
      const scores = sessionStats.scores;
      const recent5 = scores.slice(-5);
      const prev5 = scores.slice(-10, -5);
      const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
      const prevAvg = prev5.reduce((a, b) => a + b, 0) / prev5.length;

      if (prevAvg - recentAvg > 8) {
        this.triggerCooldowns['fatigue'] = now;
        return {
          type: 'fatigue',
          message: `Your quality has dropped about ${Math.round(prevAvg - recentAvg)} points over the last few strokes (from ${Math.round(prevAvg)} to ${Math.round(recentAvg)}). This might be fatigue — consider taking a short break, getting some water, and resetting.`
        };
      }
    }

    return null;
  }

  /**
   * Extract a metric value from stroke data by name.
   */
  getMetricFromStroke(strokeData, metricName) {
    const map = {
      'hipShoulderSeparation': strokeData.technique?.hipShoulderSeparation,
      'rotation': strokeData.technique?.shoulderRotation ? Math.abs(strokeData.technique.shoulderRotation) : null,
      'elbowAngle': strokeData.technique?.elbowAngleAtContact,
      'smoothness': strokeData.smoothness
    };
    return map[metricName] ?? null;
  }

  /**
   * Check if a trigger type is on cooldown.
   */
  isOnCooldown(triggerType, now) {
    const last = this.triggerCooldowns[triggerType] || 0;
    return (now - last) < this.cooldownMs;
  }

  /**
   * Reset state.
   */
  reset() {
    this.recentFaults = [];
    this.personalBestQuality = 0;
    this.triggerCooldowns = {};
  }
}
