/**
 * CoachingMemory — Structured cross-session coaching memory with effectiveness tracking.
 *
 * Replaces shallow free-text notebook with:
 * 1. Structured session memory (per-stroke-type metrics, coaching moments, observations)
 * 2. Coaching effectiveness tracking (which cues work, which don't)
 * 3. Date-specific references ("Last Tuesday your rotation was 14deg")
 * 4. Persisted visual patterns from Gemini
 *
 * Loads last 5 structured_session_memory entries + effectiveness aggregates from Supabase.
 * Falls back to localStorage when unauthenticated.
 */
class CoachingMemory {
  constructor() {
    this.recentMemory = [];       // Last 5 structured session memories
    this.effectivenessData = {};  // issueId → { cue, effective, count, avgDelta }
    this.isLoaded = false;

    // Active coaching tracking (within current session)
    this._pendingCoaching = null; // { issueId, cue, strokeType, preMetrics, strokesSince, targetMetric }
    this._postCoachingStrokes = [];
    this._coachingMoments = [];   // All coaching moments this session
    this._sessionStrokeCount = 0;

    // localStorage fallback key
    this._lsKey = 'ace_coaching_memory';
  }

  _useSupabase() {
    return typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated();
  }

  // ================================================================
  // Initialization
  // ================================================================

  async init() {
    try {
      if (this._useSupabase()) {
        const [memory, effectiveness] = await Promise.all([
          supabaseClient.getRecentStructuredMemory(5),
          supabaseClient.getCoachingEffectivenessAggregates()
        ]);
        this.recentMemory = memory || [];
        this.effectivenessData = effectiveness || {};
      } else {
        this._loadFromLocalStorage();
      }
      this.isLoaded = true;
    } catch (e) {
      console.error('CoachingMemory: init failed', e);
      this._loadFromLocalStorage();
      this.isLoaded = true;
    }
  }

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(this._lsKey);
      if (raw) {
        const data = JSON.parse(raw);
        this.recentMemory = data.recentMemory || [];
        this.effectivenessData = data.effectivenessData || {};
      }
    } catch (e) {
      console.error('CoachingMemory: localStorage load failed', e);
    }
  }

  _saveToLocalStorage() {
    try {
      localStorage.setItem(this._lsKey, JSON.stringify({
        recentMemory: this.recentMemory.slice(-5),
        effectivenessData: this.effectivenessData
      }));
    } catch (e) {
      // Silently fail — localStorage may be full
    }
  }

  // ================================================================
  // GPT Prompt Formatting
  // ================================================================

  /**
   * ~1200 chars for GPT system prompt. Replaces coachNotebook.formatForSystemPrompt().
   * Includes: dated sessions, metric trajectories, effective/ineffective cues, visual patterns.
   */
  formatForSystemPrompt() {
    if (this.recentMemory.length === 0) return '';

    let block = '\nCOACH\'S STRUCTURED MEMORY:\n';

    // Last 3 sessions with dates and metrics
    const sessions = this.recentMemory.slice(-3);
    for (const mem of sessions) {
      const date = new Date(mem.sessionDate);
      const dateStr = this._formatDate(date);
      block += `\n${dateStr} (session #${mem.sessionNumber}):\n`;

      const summaries = mem.strokeSummaries || {};
      for (const [type, data] of Object.entries(summaries)) {
        block += `  ${type}: ${data.count} strokes, quality=${data.avgQuality}`;
        if (data.avgFormScore) block += `, form=${data.avgFormScore}`;
        if (data.metrics?.rotation) block += `, rotation=${data.metrics.rotation}deg`;
        if (data.metrics?.hipSep) block += `, hipSep=${data.metrics.hipSep}deg`;
        block += '\n';
      }

      if (mem.observations?.standoutMoment) {
        block += `  Standout: ${mem.observations.standoutMoment}\n`;
      }
    }

    // Metric trajectories across sessions
    const trajectories = this._buildMetricTrajectories();
    if (trajectories) {
      block += '\nMETRIC TRENDS:\n' + trajectories;
    }

    // Effective/ineffective cues
    const cueBlock = this._buildCueEffectivenessBlock();
    if (cueBlock) {
      block += '\nCOACHING CUE EFFECTIVENESS:\n' + cueBlock;
    }

    // Visual patterns
    const lastVisual = this._getLatestVisualSummary();
    if (lastVisual) {
      block += '\nVISUAL PATTERNS:\n' + lastVisual;
    }

    // Drill history
    const drillBlock = this._buildDrillHistoryBlock();
    if (drillBlock) {
      block += '\nDRILL HISTORY:\n' + drillBlock;
    }

    block += '\nUse these structured memories to reference specific dates, metrics, and what worked. Be eerily perceptive.\n';
    return block;
  }

  /**
   * ~300 chars per-stroke context. References last session's same-type metrics.
   */
  formatForStrokePrompt(strokeType, currentMetrics) {
    if (this.recentMemory.length === 0) return '';

    // Find most recent session with this stroke type
    for (let i = this.recentMemory.length - 1; i >= 0; i--) {
      const mem = this.recentMemory[i];
      const prevData = mem.strokeSummaries?.[strokeType];
      if (!prevData) continue;

      const dateStr = this._formatDate(new Date(mem.sessionDate));
      let line = `MEMORY: Last session (${dateStr}) ${strokeType}: quality=${prevData.avgQuality}`;
      if (prevData.metrics?.rotation && currentMetrics?.rotation) {
        line += `, rotation was ${prevData.metrics.rotation}deg (now ${Math.round(currentMetrics.rotation)}deg)`;
      }
      if (prevData.metrics?.hipSep && currentMetrics?.hipShoulderSeparation) {
        line += `, hipSep was ${prevData.metrics.hipSep}deg (now ${Math.round(currentMetrics.hipShoulderSeparation)}deg)`;
      }
      line += '\n';

      // Add best cue for top fault
      const topFault = prevData.topFaults?.[0];
      if (topFault) {
        const cueInfo = this.effectivenessData[topFault.id || topFault.name];
        if (cueInfo) {
          if (cueInfo.effective) {
            line += `Effective cue for ${topFault.name}: "${cueInfo.bestCue}" (worked ${cueInfo.successRate}% of the time)\n`;
          } else {
            line += `Note: "${cueInfo.lastCue}" hasn't helped for ${topFault.name} — try a different approach\n`;
          }
        }
      }

      return line;
    }
    return '';
  }

  /**
   * Context for batch prompts. Whether current fault is persistent, best historical cue.
   */
  formatForBatchPrompt(batchSummary) {
    if (!batchSummary || this.recentMemory.length === 0) return '';

    let block = '';
    const topFault = batchSummary.topFaults?.[0];
    if (topFault) {
      const faultId = topFault.id || topFault.name;
      // Check persistence across sessions
      let sessionsWithFault = 0;
      for (const mem of this.recentMemory) {
        const typeData = mem.strokeSummaries?.[batchSummary.strokeType];
        if (typeData?.topFaults?.some(f => (f.id || f.name) === faultId)) {
          sessionsWithFault++;
        }
      }
      if (sessionsWithFault >= 2) {
        block += `PERSISTENT: "${topFault.name}" has appeared in ${sessionsWithFault} of last ${this.recentMemory.length} sessions.\n`;
      }

      const cueInfo = this.effectivenessData[faultId];
      if (cueInfo?.bestCue) {
        block += `Best historical cue for ${topFault.name}: "${cueInfo.bestCue}" (${cueInfo.effective ? 'effective' : 'try something different'})\n`;
      }
    }

    return block;
  }

  /**
   * Format drill history context for batch prompts.
   * Enables referencing specific drill outcomes.
   */
  formatDrillContextForPrompt(drillId) {
    if (typeof improvementTracker === 'undefined' || !improvementTracker.isLoaded) return '';

    const history = improvementTracker.getDrillHistory(drillId);
    if (!history || !history.completions || history.completions.length === 0) return '';

    const recent = history.completions.slice(-3);
    const scores = recent.map(c => c.score);
    const lastDate = this._formatDate(new Date(recent[recent.length - 1].date));

    let line = `DRILL HISTORY: ${drillId.replace(/_/g, ' ')} — `;
    line += `last ${recent.length} scores: ${scores.join(', ')}, `;
    line += `current difficulty: ${history.currentDifficulty}x, `;
    line += `last practiced: ${lastDate}\n`;

    return line;
  }

  // ================================================================
  // Coaching Effectiveness Tracking (within-session)
  // ================================================================

  /**
   * Called when GPT delivers coaching. Captures pre-coaching snapshot.
   * @param {string} issueId - coaching tree issue ID
   * @param {string} cue - the coaching cue delivered
   * @param {string} strokeType - stroke type being coached
   * @param {Object} preMetrics - avg metrics of last 3 strokes
   * @param {string} targetMetric - which specific metric this cue targets
   */
  onCoachingDelivered(issueId, cue, strokeType, preMetrics, targetMetric) {
    // Save any pending measurement first
    this._finalizePendingCoaching();

    this._pendingCoaching = {
      issueId,
      cue,
      strokeType,
      preMetrics: { ...preMetrics },
      targetMetric: targetMetric || issueId,
      strokesSince: 0,
      timestamp: Date.now()
    };
    this._postCoachingStrokes = [];
  }

  /**
   * Called after each stroke to track post-coaching metrics.
   * After 3-5 matching strokes, computes delta and saves effectiveness.
   */
  onStrokeAfterCoaching(strokeType, metrics) {
    this._sessionStrokeCount++;

    if (!this._pendingCoaching) return;
    if (strokeType.toLowerCase() !== this._pendingCoaching.strokeType.toLowerCase()) return;

    this._pendingCoaching.strokesSince++;
    this._postCoachingStrokes.push({ ...metrics });

    // Measure after 3-5 strokes of same type
    if (this._postCoachingStrokes.length >= 3) {
      this._finalizePendingCoaching();
    }
  }

  _finalizePendingCoaching() {
    if (!this._pendingCoaching || this._postCoachingStrokes.length < 3) {
      this._pendingCoaching = null;
      this._postCoachingStrokes = [];
      return;
    }

    const pc = this._pendingCoaching;
    const postMetrics = this._averageMetrics(this._postCoachingStrokes);

    const qualityDelta = (postMetrics.quality || 0) - (pc.preMetrics.quality || 0);
    const targetMetricDelta = this._computeTargetDelta(pc.targetMetric, pc.preMetrics, postMetrics);
    const effective = targetMetricDelta > 0.1 || qualityDelta > 5;

    const moment = {
      issueId: pc.issueId,
      cue: pc.cue,
      strokeType: pc.strokeType,
      preMetrics: pc.preMetrics,
      postMetrics,
      qualityDelta: +qualityDelta.toFixed(1),
      targetMetricDelta: targetMetricDelta != null ? +targetMetricDelta.toFixed(2) : null,
      effective,
      strokesBetween: pc.strokesSince
    };

    this._coachingMoments.push(moment);

    // Save to Supabase immediately (fire-and-forget)
    if (this._useSupabase()) {
      supabaseClient.saveCoachingEffectiveness({
        sessionId: supabaseClient._currentSessionId,
        coachingCue: pc.cue,
        issueId: pc.issueId,
        strokeType: pc.strokeType,
        preMetrics: pc.preMetrics,
        postMetrics,
        qualityDelta: moment.qualityDelta,
        targetMetricDelta: moment.targetMetricDelta,
        effective,
        strokesBetween: pc.strokesSince
      });
    }

    // Update in-memory effectiveness aggregates
    this._updateEffectivenessAggregate(pc.issueId, pc.cue, effective, qualityDelta);

    this._pendingCoaching = null;
    this._postCoachingStrokes = [];
  }

  _computeTargetDelta(targetMetric, pre, post) {
    // Map issue IDs to metric keys
    const metricMap = {
      insufficientRotation: 'rotation',
      collapsingElbow: 'elbowAngle',
      armOnlySwing: 'hipSep',
      poorFootwork: 'footworkScore',
      narrowBase: 'footworkScore',
      noKneeBend: 'elbowAngle',
      abbreviatedFollowThrough: 'smoothness',
      poorFollowThrough: 'smoothness'
    };
    const key = metricMap[targetMetric] || targetMetric;
    if (pre[key] != null && post[key] != null) {
      return post[key] - pre[key];
    }
    return null;
  }

  _averageMetrics(strokeMetrics) {
    if (strokeMetrics.length === 0) return {};
    const keys = Object.keys(strokeMetrics[0]);
    const result = {};
    for (const key of keys) {
      const vals = strokeMetrics.filter(m => m[key] != null).map(m => m[key]);
      if (vals.length > 0) {
        result[key] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
      }
    }
    return result;
  }

  _updateEffectivenessAggregate(issueId, cue, effective, qualityDelta) {
    if (!this.effectivenessData[issueId]) {
      this.effectivenessData[issueId] = {
        totalAttempts: 0,
        successCount: 0,
        bestCue: null,
        bestCueDelta: -Infinity,
        lastCue: cue,
        effective: false,
        successRate: 0
      };
    }
    const agg = this.effectivenessData[issueId];
    agg.totalAttempts++;
    if (effective) agg.successCount++;
    agg.lastCue = cue;
    agg.successRate = Math.round((agg.successCount / agg.totalAttempts) * 100);
    agg.effective = agg.successRate >= 50;

    if (qualityDelta > (agg.bestCueDelta || -Infinity)) {
      agg.bestCue = cue;
      agg.bestCueDelta = qualityDelta;
    }

    this._saveToLocalStorage();
  }

  // ================================================================
  // Session End: Build & Save Structured Memory
  // ================================================================

  /**
   * Build and save structured session memory at session end.
   * @param {Object} session - ended session data
   * @param {Array} strokes - stroke records
   * @param {string} coachNotesFreetext - GPT's free-text notes
   * @param {Object} geminiSummary - aggregated visual analysis (from VisualAnalysisMerger)
   * @param {Object} observations - structured observations from GPT
   */
  async buildAndSaveSessionMemory(session, strokes, coachNotesFreetext, geminiSummary, observations) {
    // Finalize any pending coaching measurement
    this._finalizePendingCoaching();

    const sessionNumber = (this.recentMemory.length > 0
      ? Math.max(...this.recentMemory.map(m => m.sessionNumber || 0)) + 1
      : 1);

    // Build per-stroke-type summaries
    const strokeSummaries = this._buildStrokeSummaries(strokes);

    const memoryEntry = {
      sessionId: supabaseClient?._currentSessionId || null,
      sessionDate: new Date().toISOString(),
      sessionNumber,
      strokeSummaries,
      coachingMoments: this._coachingMoments,
      observations: observations || {},
      visualSummary: geminiSummary || null,
      coachNotesFreetext: coachNotesFreetext || ''
    };

    // Save to Supabase
    if (this._useSupabase()) {
      await supabaseClient.saveStructuredSessionMemory(memoryEntry);
    }

    // Update local cache
    this.recentMemory.push(memoryEntry);
    if (this.recentMemory.length > 5) this.recentMemory.shift();
    this._saveToLocalStorage();

    // Reset session state
    this._coachingMoments = [];
    this._pendingCoaching = null;
    this._postCoachingStrokes = [];
    this._sessionStrokeCount = 0;
  }

  _buildStrokeSummaries(strokes) {
    if (!strokes || strokes.length === 0) return {};

    const byType = {};
    for (const s of strokes) {
      const type = s.type || s.strokeType || 'unknown';
      if (!byType[type]) byType[type] = [];
      byType[type].push(s);
    }

    const summaries = {};
    for (const [type, typeStrokes] of Object.entries(byType)) {
      const qualities = typeStrokes.map(s => s.quality).filter(q => q != null);
      const avgQuality = qualities.length ? +(qualities.reduce((a, b) => a + b, 0) / qualities.length).toFixed(1) : null;

      const formScores = typeStrokes.map(s => s.biomechanical?.overall).filter(v => v != null);
      const avgFormScore = formScores.length ? +(formScores.reduce((a, b) => a + b, 0) / formScores.length).toFixed(1) : null;

      // Metric averages
      const metricAvg = (accessor) => {
        const vals = typeStrokes.map(accessor).filter(v => v != null);
        return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
      };

      const metrics = {
        rotation: metricAvg(s => s.technique?.shoulderRotation ? Math.abs(s.technique.shoulderRotation) : null),
        hipSep: metricAvg(s => s.technique?.hipShoulderSeparation),
        elbowAngle: metricAvg(s => s.technique?.elbowAngleAtContact),
        smoothness: metricAvg(s => s.physics?.smoothness)
      };

      // Top faults
      const faultCounts = {};
      typeStrokes.forEach(s => {
        (s.biomechanical?.detectedFaults || []).forEach(f => {
          const id = f.id || f.name;
          if (!faultCounts[id]) faultCounts[id] = { id, name: f.name || id, count: 0 };
          faultCounts[id].count++;
        });
      });
      const topFaults = Object.values(faultCounts).sort((a, b) => b.count - a.count).slice(0, 3);

      // Top strengths
      const strengthCounts = {};
      typeStrokes.forEach(s => {
        (s.strengths || []).forEach(str => {
          strengthCounts[str] = (strengthCounts[str] || 0) + 1;
        });
      });
      const topStrengths = Object.entries(strengthCounts)
        .filter(([, count]) => count >= typeStrokes.length * 0.3)
        .map(([name]) => name);

      summaries[type] = {
        count: typeStrokes.length,
        avgQuality,
        avgFormScore,
        metrics,
        topFaults,
        topStrengths
      };
    }

    return summaries;
  }

  // ================================================================
  // Private Helpers
  // ================================================================

  _formatDate(date) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const diffDays = Math.round((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `Last ${days[date.getDay()]}`;
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }

  _buildMetricTrajectories() {
    if (this.recentMemory.length < 2) return '';

    const strokeTypes = new Set();
    this.recentMemory.forEach(m => {
      Object.keys(m.strokeSummaries || {}).forEach(t => strokeTypes.add(t));
    });

    let block = '';
    for (const type of strokeTypes) {
      const trajectory = [];
      for (const mem of this.recentMemory) {
        const data = mem.strokeSummaries?.[type];
        if (!data) continue;
        const dateStr = this._formatDate(new Date(mem.sessionDate));
        const parts = [`quality=${data.avgQuality}`];
        if (data.metrics?.rotation) parts.push(`rotation=${data.metrics.rotation}deg`);
        if (data.metrics?.hipSep) parts.push(`hipSep=${data.metrics.hipSep}deg`);
        trajectory.push(`${dateStr}: ${parts.join(', ')}`);
      }
      if (trajectory.length >= 2) {
        block += `${type}: ${trajectory.join(' → ')}\n`;
      }
    }
    return block;
  }

  _buildCueEffectivenessBlock() {
    const entries = Object.entries(this.effectivenessData);
    if (entries.length === 0) return '';

    let block = '';
    for (const [issueId, data] of entries) {
      if (data.totalAttempts < 2) continue;
      if (data.effective && data.bestCue) {
        block += `"${data.bestCue}" → ${issueId}: WORKS (${data.successRate}% success, ${data.totalAttempts} attempts)\n`;
      } else if (data.lastCue) {
        block += `"${data.lastCue}" → ${issueId}: NOT WORKING (${data.successRate}% success) — try a different approach\n`;
      }
    }
    return block;
  }

  /**
   * Build drill history block for GPT prompt.
   * Pulls from ImprovementTracker's persisted drillHistory.
   * Enables prompts like "Last time you did shadow swing drill, elbow improved from 95 to 110."
   */
  _buildDrillHistoryBlock() {
    if (typeof improvementTracker === 'undefined' || !improvementTracker.isLoaded) return '';

    const allDrills = improvementTracker.getAllDrillHistory();
    if (!allDrills || Object.keys(allDrills).length === 0) return '';

    let block = '';
    for (const [drillId, history] of Object.entries(allDrills)) {
      if (!history.completions || history.completions.length === 0) continue;

      const recent = history.completions.slice(-3);
      const scores = recent.map(c => c.score);
      const lastDate = new Date(recent[recent.length - 1].date);
      const dateStr = this._formatDate(lastDate);

      block += `- ${drillId.replace(/_/g, ' ')}: ${recent.length} recent completions, `;
      block += `scores: ${scores.join(' → ')}, `;
      block += `difficulty: ${history.currentDifficulty}x, `;
      block += `last: ${dateStr}\n`;
    }

    // Cross-reference drill outcomes with stroke metrics
    const drillMetricBlock = this._buildDrillMetricCorrelation(allDrills);
    if (drillMetricBlock) block += drillMetricBlock;

    return block;
  }

  /**
   * Correlate drill completions with metric improvements.
   * Looks for metric changes that coincide with drill practice.
   */
  _buildDrillMetricCorrelation(allDrills) {
    if (this.recentMemory.length < 2) return '';

    // Map drill IDs to relevant metrics
    const drillMetricMap = {
      'footwork_base': { metric: 'footworkScore', label: 'footwork score' },
      'serve_trophy_position': { metric: 'serveTrophyScore', label: 'trophy position' },
      'serve_leg_drive': { metric: 'serveLegDriveScore', label: 'leg drive' },
      'shadow_swing': { metric: 'rotation', label: 'rotation' },
      'contact_point': { metric: 'contactPointVariance', label: 'contact consistency' }
    };

    let block = '';
    for (const [drillId, history] of Object.entries(allDrills)) {
      const mapping = drillMetricMap[drillId];
      if (!mapping || !history.completions || history.completions.length < 2) continue;

      // Find sessions before and after drill practice
      const firstDrillDate = history.completions[0].date;
      const lastDrillDate = history.completions[history.completions.length - 1].date;

      const before = this.recentMemory.filter(m => new Date(m.sessionDate).getTime() <= firstDrillDate);
      const after = this.recentMemory.filter(m => new Date(m.sessionDate).getTime() >= lastDrillDate);

      if (before.length === 0 || after.length === 0) continue;

      // Check if the relevant metric improved
      const getMetric = (mem) => {
        for (const summaries of Object.values(mem.strokeSummaries || {})) {
          const val = summaries.metrics?.[mapping.metric];
          if (val != null) return val;
        }
        return null;
      };

      const beforeVal = getMetric(before[before.length - 1]);
      const afterVal = getMetric(after[after.length - 1]);

      if (beforeVal != null && afterVal != null && afterVal !== beforeVal) {
        const direction = afterVal > beforeVal ? 'improved' : 'declined';
        block += `  After ${drillId.replace(/_/g, ' ')} practice: ${mapping.label} ${direction} from ${Math.round(beforeVal)} to ${Math.round(afterVal)}\n`;
      }
    }

    return block;
  }

  /**
   * Record a drill session in coaching memory.
   * Called when a drill is completed.
   * @param {string} drillId - drill identifier
   * @param {number} score - 0-100 completion score
   * @param {number} difficulty - difficulty multiplier
   * @param {Object} metrics - key metrics during drill (e.g. { elbowAngle: 110, rotation: 25 })
   */
  recordDrillSession(drillId, score, difficulty, metrics) {
    // Store in the current session's coaching moments for memory persistence
    this._coachingMoments.push({
      type: 'drill_completion',
      drillId,
      score,
      difficulty,
      metrics: metrics || {},
      timestamp: Date.now()
    });
  }

  _getLatestVisualSummary() {
    for (let i = this.recentMemory.length - 1; i >= 0; i--) {
      const vs = this.recentMemory[i].visualSummary;
      if (!vs) continue;
      const parts = [];
      if (vs.dominantGrip) parts.push(`Dominant grip: ${vs.dominantGrip}`);
      if (vs.racketFacePattern) parts.push(`Racket face tendency: ${vs.racketFacePattern}`);
      if (vs.contactPointPattern) parts.push(`Contact point pattern: ${vs.contactPointPattern}`);
      if (parts.length > 0) return parts.join('\n') + '\n';
    }
    return '';
  }

  /**
   * Get pre-coaching metrics from the last N strokes of a given type.
   * Used by the batch flush handler to snapshot metrics before coaching.
   */
  getPreCoachingMetrics(strokeType, batchAccumulator) {
    if (!batchAccumulator) return {};
    const bucket = batchAccumulator.buckets[strokeType];
    if (!bucket || bucket.length === 0) return {};

    const recent = bucket.slice(-3);
    const avg = (key) => {
      const vals = recent.map(s => s.metrics?.[key]).filter(v => v != null);
      return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
    };

    return {
      quality: +(recent.reduce((a, s) => a + (s.quality || 0), 0) / recent.length).toFixed(1),
      rotation: avg('rotation'),
      hipSep: avg('hipSep'),
      elbowAngle: avg('elbowAngle'),
      smoothness: avg('smoothness'),
      velocity: avg('velocity')
    };
  }
}
