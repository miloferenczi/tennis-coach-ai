/**
 * BatchCoachingAccumulator - Collects per-stroke analysis results grouped by stroke type.
 * GPT only speaks at natural breaks (between points, idle) after observing 10+ strokes of a type.
 * Live visual overlays (scores, word labels) remain per-stroke.
 * Drill mode bypasses this entirely — drills keep per-stroke GPT coaching.
 */
class BatchCoachingAccumulator {
  constructor(options = {}) {
    this.batchThreshold = options.batchThreshold || 10;
    this.trialThreshold = options.trialThreshold || 3;
    this.isTrialMode = options.isTrialMode || false;

    // stroke type → array of stroke entries
    this.buckets = {};
    // watermarks: stroke type → index of last delivered stroke
    this.watermarks = {};
    // queued proactive triggers and rally analyses for next batch prompt
    this.pendingTriggers = [];
    this.pendingRallyAnalyses = [];
    // reference to last added entry (for async visual attachment)
    this._lastEntry = null;
  }

  /**
   * Add a stroke to the accumulator.
   * @param {string} strokeType - e.g. 'forehand', 'backhand', 'serve'
   * @param {Object} data - extracted stroke analysis fields
   * @returns {Object} the stored entry (for async visual attachment)
   */
  addStroke(strokeType, data) {
    if (!this.buckets[strokeType]) {
      this.buckets[strokeType] = [];
    }

    const entry = {
      quality: data.quality || 0,
      formScore: data.formScore || null,
      powerScore: data.powerScore || null,
      faults: (data.faults || []).map(f => ({
        id: f.id || f.faultId,
        name: f.name || f.faultName || f.id,
        fix: f.fix || f.correction || ''
      })),
      strengths: data.strengths || [],
      orchestratorIssue: data.orchestratorIssue || null,
      metrics: {
        hipSep: data.hipSep ?? null,
        elbowAngle: data.elbowAngle ?? null,
        rotation: data.rotation ?? null,
        smoothness: data.smoothness ?? null,
        velocity: data.velocity ?? null,
        acceleration: data.acceleration ?? null
      },
      footwork: data.footwork || null,
      serveAnalysis: data.serveAnalysis || null,
      visualAnalysis: null, // attached async after Gemini returns
      timestamp: Date.now()
    };

    this.buckets[strokeType].push(entry);
    this._lastEntry = entry;
    return entry;
  }

  /**
   * Get stroke types that have enough undelivered strokes to form a batch.
   * @returns {string[]} stroke types ready for batch coaching
   */
  getReadyBatches() {
    const threshold = this.isTrialMode ? this.trialThreshold : this.batchThreshold;
    const ready = [];

    for (const type of Object.keys(this.buckets)) {
      const watermark = this.watermarks[type] || 0;
      const undelivered = this.buckets[type].length - watermark;
      if (undelivered >= threshold) {
        ready.push(type);
      }
    }
    return ready;
  }

  /**
   * Build an aggregated summary for a stroke type's undelivered strokes.
   * @param {string} strokeType
   * @returns {Object} summary with averages, trends, fault frequencies, etc.
   */
  buildBatchSummary(strokeType) {
    const all = this.buckets[strokeType] || [];
    const watermark = this.watermarks[strokeType] || 0;
    const strokes = all.slice(watermark);

    if (strokes.length === 0) return null;

    // Quality stats
    const qualities = strokes.map(s => s.quality);
    const avgQuality = qualities.reduce((a, b) => a + b, 0) / qualities.length;
    const minQuality = Math.min(...qualities);
    const maxQuality = Math.max(...qualities);

    // Trend: first half vs second half
    const mid = Math.floor(strokes.length / 2);
    const firstHalf = qualities.slice(0, mid);
    const secondHalf = qualities.slice(mid);
    const firstAvg = firstHalf.length ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : avgQuality;
    const secondAvg = secondHalf.length ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : avgQuality;
    const trend = secondAvg - firstAvg; // positive = improving

    // Form/power averages
    const formScores = strokes.filter(s => s.formScore != null).map(s => s.formScore);
    const powerScores = strokes.filter(s => s.powerScore != null).map(s => s.powerScore);
    const avgForm = formScores.length ? formScores.reduce((a, b) => a + b, 0) / formScores.length : null;
    const avgPower = powerScores.length ? powerScores.reduce((a, b) => a + b, 0) / powerScores.length : null;

    // Fault frequencies (top 3)
    const faultCounts = {};
    strokes.forEach(s => {
      s.faults.forEach(f => {
        const key = f.id || f.name;
        if (!faultCounts[key]) faultCounts[key] = { id: f.id, name: f.name, fix: f.fix, count: 0 };
        faultCounts[key].count++;
      });
    });
    const topFaults = Object.values(faultCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Orchestrator issue frequencies
    const issueCounts = {};
    strokes.forEach(s => {
      if (s.orchestratorIssue) {
        const key = s.orchestratorIssue.id || s.orchestratorIssue.name;
        if (!issueCounts[key]) issueCounts[key] = { ...s.orchestratorIssue, count: 0 };
        issueCounts[key].count++;
      }
    });
    const topIssue = Object.values(issueCounts).sort((a, b) => b.count - a.count)[0] || null;

    // Strength frequencies
    const strengthCounts = {};
    strokes.forEach(s => {
      (s.strengths || []).forEach(str => {
        strengthCounts[str] = (strengthCounts[str] || 0) + 1;
      });
    });
    const consistentStrengths = Object.entries(strengthCounts)
      .filter(([, count]) => count >= strokes.length * 0.4)
      .map(([name]) => name);

    // Metric averages
    const metricAvgs = {};
    for (const key of ['hipSep', 'elbowAngle', 'rotation', 'smoothness', 'velocity', 'acceleration']) {
      const vals = strokes.filter(s => s.metrics[key] != null).map(s => s.metrics[key]);
      metricAvgs[key] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
    }

    // Visual analysis patterns (from Gemini results attached async)
    const visualInsights = this._aggregateVisualAnalyses(strokes);

    // Footwork averages
    const footworkData = this._aggregateFootwork(strokes);

    // Serve metric averages (if serve)
    const serveData = strokeType === 'serve' ? this._aggregateServeAnalyses(strokes) : null;

    return {
      strokeType,
      count: strokes.length,
      avgQuality: +avgQuality.toFixed(1),
      minQuality,
      maxQuality,
      trend: +trend.toFixed(1),
      avgForm: avgForm != null ? +avgForm.toFixed(1) : null,
      avgPower: avgPower != null ? +avgPower.toFixed(1) : null,
      topFaults,
      topIssue,
      consistentStrengths,
      metricAvgs,
      visualInsights,
      footwork: footworkData,
      serve: serveData
    };
  }

  /**
   * Mark a stroke type as delivered (advance watermark).
   * @param {string} strokeType
   */
  markDelivered(strokeType) {
    if (this.buckets[strokeType]) {
      this.watermarks[strokeType] = this.buckets[strokeType].length;
    }
  }

  /**
   * Build summaries for ALL stroke types regardless of threshold (for session end).
   * @returns {Object[]} array of batch summaries
   */
  getAllBatchSummaries() {
    const summaries = [];
    for (const type of Object.keys(this.buckets)) {
      const watermark = this.watermarks[type] || 0;
      if (this.buckets[type].length > watermark) {
        const summary = this.buildBatchSummary(type);
        if (summary) summaries.push(summary);
      }
    }
    return summaries;
  }

  /**
   * Queue a proactive trigger for inclusion in next batch prompt.
   */
  addTrigger(trigger) {
    this.pendingTriggers.push({
      ...trigger,
      timestamp: Date.now()
    });
  }

  /**
   * Queue a rally analysis for inclusion in next batch prompt.
   */
  addRallyAnalysis(analysis) {
    this.pendingRallyAnalyses.push({
      ...analysis,
      timestamp: Date.now()
    });
  }

  /**
   * Reset all state (on session reset).
   */
  reset() {
    this.buckets = {};
    this.watermarks = {};
    this.pendingTriggers = [];
    this.pendingRallyAnalyses = [];
    this._lastEntry = null;
  }

  // --- Private helpers ---

  _aggregateVisualAnalyses(strokes) {
    const withVisual = strokes.filter(s => s.visualAnalysis);
    if (withVisual.length === 0) return null;

    // Common racket face state
    const racketFaces = {};
    withVisual.forEach(s => {
      const rf = s.visualAnalysis.racketFace || s.visualAnalysis.racketFaceAtContact;
      if (rf) racketFaces[rf] = (racketFaces[rf] || 0) + 1;
    });

    // Common grip
    const grips = {};
    withVisual.forEach(s => {
      const g = s.visualAnalysis.grip || s.visualAnalysis.gripType;
      if (g) grips[g] = (grips[g] || 0) + 1;
    });

    // Visual faults appearing 2+ times
    const vFaultCounts = {};
    withVisual.forEach(s => {
      const vf = s.visualAnalysis.visualFaults || s.visualAnalysis.issues || [];
      (Array.isArray(vf) ? vf : []).forEach(f => {
        const key = typeof f === 'string' ? f : f.issue || f.name;
        if (key) vFaultCounts[key] = (vFaultCounts[key] || 0) + 1;
      });
    });
    const recurringVisualFaults = Object.entries(vFaultCounts)
      .filter(([, count]) => count >= 2)
      .map(([name, count]) => ({ name, count }));

    const topRacketFace = Object.entries(racketFaces).sort((a, b) => b[1] - a[1])[0];
    const topGrip = Object.entries(grips).sort((a, b) => b[1] - a[1])[0];

    return {
      sampleCount: withVisual.length,
      commonRacketFace: topRacketFace ? topRacketFace[0] : null,
      commonGrip: topGrip ? topGrip[0] : null,
      recurringVisualFaults
    };
  }

  _aggregateFootwork(strokes) {
    const withFootwork = strokes.filter(s => s.footwork);
    if (withFootwork.length === 0) return null;

    const scores = withFootwork.map(s => s.footwork.score ?? s.footwork.compositeScore ?? 0);
    const stances = {};
    withFootwork.forEach(s => {
      const st = s.footwork.stance || s.footwork.stanceType;
      if (st) stances[st] = (stances[st] || 0) + 1;
    });
    const topStance = Object.entries(stances).sort((a, b) => b[1] - a[1])[0];

    return {
      avgScore: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
      commonStance: topStance ? topStance[0] : null
    };
  }

  _aggregateServeAnalyses(strokes) {
    const withServe = strokes.filter(s => s.serveAnalysis);
    if (withServe.length === 0) return null;

    const avg = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

    return {
      avgScore: avg(withServe.map(s => s.serveAnalysis.score ?? 0)),
      avgTrophy: avg(withServe.filter(s => s.serveAnalysis.trophy != null).map(s => s.serveAnalysis.trophy)),
      avgLegDrive: avg(withServe.filter(s => s.serveAnalysis.legDrive != null).map(s => s.serveAnalysis.legDrive)),
      avgContactHeight: avg(withServe.filter(s => s.serveAnalysis.contactHeight != null).map(s => s.serveAnalysis.contactHeight)),
      avgShoulderTilt: avg(withServe.filter(s => s.serveAnalysis.shoulderTilt != null).map(s => s.serveAnalysis.shoulderTilt))
    };
  }
}
