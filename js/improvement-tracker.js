/**
 * ImprovementTracker — Cross-session metric tracking and coaching plan storage
 * Records per-stroke-type metrics deterministically, surfaces trends and targets
 * for GPT prompts, and stores GPT-authored coaching plans.
 */
class ImprovementTracker {
  constructor() {
    this.storageKey = 'ace_improvement_tracker';
    this.maxSessionsPerType = 10;
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.version === 1) return parsed;
      }
    } catch (e) {
      console.error('ImprovementTracker: failed to load', e);
    }
    return this.createEmpty();
  }

  createEmpty() {
    return {
      version: 1,
      strokeMetrics: {},
      faultHistory: {},
      coachingPlan: null
    };
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch (e) {
      console.error('ImprovementTracker: failed to save', e);
    }
  }

  /**
   * Record session metrics from stroke array and summary.
   * Called at session end with the full stroke array from sessionStorage.
   */
  recordSession(strokes, summary) {
    if (!strokes || strokes.length === 0) return;

    // Group strokes by type
    const byType = {};
    for (const s of strokes) {
      if (!s.type) continue;
      if (!byType[s.type]) byType[s.type] = [];
      byType[s.type].push(s);
    }

    const sessionFaults = [];

    for (const [type, typeStrokes] of Object.entries(byType)) {
      if (typeStrokes.length < 3) continue; // Skip types with insufficient sample

      const entry = {
        date: Date.now(),
        strokeCount: typeStrokes.length,
        avgQuality: this.avg(typeStrokes.map(s => s.quality)),
        avgFormScore: this.avg(typeStrokes.map(s => s.qualityBreakdown?.biomechanical).filter(v => v != null)),
        avgPowerScore: this.avg(typeStrokes.map(s => s.qualityBreakdown?.power).filter(v => v != null)),
        avgRotation: this.avg(typeStrokes.map(s => Math.abs(s.physics?.rotation || 0))),
        avgHipSep: this.avg(typeStrokes.map(s => s.technique?.hipShoulderSeparation).filter(v => v != null)),
        avgElbowAngle: this.avg(typeStrokes.map(s => s.technique?.elbowAngle).filter(v => v != null)),
        avgSmoothness: this.avg(typeStrokes.map(s => s.physics?.smoothness).filter(v => v != null)),
        faults: this.collectFaults(typeStrokes)
      };

      if (!this.data.strokeMetrics[type]) {
        this.data.strokeMetrics[type] = [];
      }
      this.data.strokeMetrics[type].push(entry);

      // Trim to max sessions
      if (this.data.strokeMetrics[type].length > this.maxSessionsPerType) {
        this.data.strokeMetrics[type] = this.data.strokeMetrics[type].slice(-this.maxSessionsPerType);
      }

      // Collect faults for history tracking
      for (const fault of entry.faults) {
        if (!sessionFaults.includes(fault)) sessionFaults.push(fault);
      }
    }

    // Update fault history
    this.recordFaults(sessionFaults);

    this.save();
  }

  /**
   * Collect unique fault names from a set of strokes
   */
  collectFaults(strokes) {
    const faultSet = new Set();
    for (const s of strokes) {
      if (s.biomechanical?.faults) {
        for (const f of s.biomechanical.faults) {
          faultSet.add(f);
        }
      }
    }
    return Array.from(faultSet);
  }

  /**
   * Update fault history — increment sessionCount, update lastSeen,
   * mark resolved if absent for 3+ consecutive sessions.
   */
  recordFaults(sessionFaults) {
    const now = Date.now();

    // Update existing faults
    for (const [faultId, record] of Object.entries(this.data.faultHistory)) {
      if (sessionFaults.includes(faultId)) {
        record.lastSeen = now;
        record.sessionCount++;
        record.resolved = false;
        record.absentCount = 0;
      } else {
        record.absentCount = (record.absentCount || 0) + 1;
        if (record.absentCount >= 3 && !record.resolved) {
          record.resolved = true;
        }
      }
    }

    // Add new faults
    for (const faultId of sessionFaults) {
      if (!this.data.faultHistory[faultId]) {
        this.data.faultHistory[faultId] = {
          firstSeen: now,
          lastSeen: now,
          sessionCount: 1,
          resolved: false,
          absentCount: 0
        };
      }
    }
  }

  /**
   * Get progress data for a specific stroke type.
   * Returns last 5 sessions with trend and velocity.
   */
  getProgressForStroke(strokeType) {
    const sessions = this.data.strokeMetrics[strokeType];
    if (!sessions || sessions.length === 0) return null;

    const recent = sessions.slice(-5);
    const qualities = recent.map(s => s.avgQuality);

    return {
      sessions: recent,
      trend: this.computeTrend(qualities),
      velocityPerSession: this.computeVelocity(qualities)
    };
  }

  /**
   * Linear regression trend of quality scores.
   */
  computeTrend(values) {
    if (values.length < 2) return 'stable';

    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    if (slope > 0.5) return 'improving';
    if (slope < -0.5) return 'declining';
    return 'stable';
  }

  /**
   * Points-per-session improvement rate.
   */
  computeVelocity(values) {
    if (values.length < 2) return 0;
    const slope = (values[values.length - 1] - values[0]) / (values.length - 1);
    return Math.round(slope * 10) / 10;
  }

  /**
   * Format ~500 char block for GPT system prompt with plan and progress.
   */
  formatForSystemPrompt() {
    let block = '';

    // Coaching plan focus areas
    const plan = this.data.coachingPlan;
    if (plan?.focusAreas?.length > 0) {
      block += '\nIMPROVEMENT PLAN:\nFocus areas:\n';
      plan.focusAreas.forEach((f, i) => {
        block += `${i + 1}. ${f.area}`;
        if (f.why) block += ` -- ${f.why}`;
        if (f.drill) block += `. Drill: ${f.drill}`;
        block += '\n';
      });
    }

    // Cross-session progress
    const strokeTypes = Object.keys(this.data.strokeMetrics);
    if (strokeTypes.length > 0) {
      block += '\nProgress (recent sessions):\n';
      for (const type of strokeTypes) {
        const progress = this.getProgressForStroke(type);
        if (!progress || progress.sessions.length < 2) continue;

        const qualities = progress.sessions.map(s => Math.round(s.avgQuality));
        const arrow = qualities.join(' -> ');
        let trend = '';
        if (progress.velocityPerSession > 0) trend = ` (+${progress.velocityPerSession}/session)`;
        else if (progress.velocityPerSession < 0) trend = ` (${progress.velocityPerSession}/session)`;
        else trend = ' (stable)';

        block += `- ${type}: ${arrow} quality${trend}\n`;
      }
    }

    // Active (unresolved) faults
    const activeFaults = Object.entries(this.data.faultHistory)
      .filter(([_, r]) => !r.resolved && r.sessionCount >= 2)
      .map(([id, r]) => `${id.replace(/([A-Z])/g, ' $1').trim()} (${r.sessionCount} sessions)`)
      .slice(0, 3);
    if (activeFaults.length > 0) {
      block += `\nRecurring faults: ${activeFaults.join(', ')}\n`;
    }

    return block;
  }

  /**
   * Format ~200 char block for per-stroke prompt with plan progress.
   */
  formatForStrokePrompt(strokeType, currentMetrics) {
    const plan = this.data.coachingPlan;
    if (!plan?.focusAreas?.length) return '';

    // Find a focus area for this stroke type
    const focus = plan.focusAreas.find(f => f.strokeType === strokeType);
    if (!focus) return '';

    let line = `PLAN PROGRESS: ${focus.area}`;

    // Include current value if we can match the metric
    if (currentMetrics && focus.metric) {
      const current = currentMetrics[focus.metric];
      if (current != null) {
        line += ` -- this stroke: ${Math.round(current)}`;
      }
    }

    // Include session average and target
    const progress = this.getProgressForStroke(strokeType);
    if (progress && progress.sessions.length > 0) {
      const latest = progress.sessions[progress.sessions.length - 1];
      const metricMap = {
        hipShoulderSeparation: 'avgHipSep',
        rotation: 'avgRotation',
        elbowAngle: 'avgElbowAngle',
        smoothness: 'avgSmoothness'
      };
      const avgKey = metricMap[focus.metric];
      if (avgKey && latest[avgKey] != null) {
        line += ` (session avg: ${Math.round(latest[avgKey])}`;
        if (focus.target) line += `, target: ${focus.target}`;
        if (focus.baseline) line += `, baseline: ${focus.baseline}`;
        line += ')';
      } else if (focus.target) {
        line += ` (target: ${focus.target})`;
      }
    }

    return line;
  }

  /**
   * Store GPT-authored coaching plan from session-end synthesis.
   */
  updateCoachingPlan(plan) {
    if (!plan || !plan.focusAreas) return;
    this.data.coachingPlan = {
      updatedAt: Date.now(),
      focusAreas: plan.focusAreas.slice(0, 3),
      sessionGoal: plan.sessionGoal || null
    };
    this.save();
  }

  /**
   * Get the current coaching plan.
   */
  getCoachingPlan() {
    return this.data.coachingPlan;
  }

  /**
   * Get form targets for the player's skill level.
   * Injected into GPT prompt so it knows what to coach toward.
   */
  getFormTargets(skillLevel) {
    const targets = {
      beginner:     { rotation: 15, hipSep: 20, elbowAngle: 135, smoothness: 50 },
      intermediate: { rotation: 20, hipSep: 35, elbowAngle: 145, smoothness: 65 },
      advanced:     { rotation: 25, hipSep: 45, elbowAngle: 155, smoothness: 75 },
      elite:        { rotation: 30, hipSep: 55, elbowAngle: 160, smoothness: 85 }
    };
    return targets[skillLevel] || targets.intermediate;
  }

  /**
   * Get a brief summary of top progress for greeting prompt.
   */
  getTopProgress() {
    const types = Object.keys(this.data.strokeMetrics);
    if (types.length === 0) return null;

    const progressItems = [];
    for (const type of types) {
      const progress = this.getProgressForStroke(type);
      if (!progress || progress.sessions.length < 2) continue;

      const first = progress.sessions[0].avgQuality;
      const last = progress.sessions[progress.sessions.length - 1].avgQuality;
      const diff = Math.round(last - first);
      if (diff !== 0) {
        progressItems.push(`${type} quality ${diff > 0 ? '+' : ''}${diff} over ${progress.sessions.length} sessions`);
      }
    }

    return progressItems.length > 0 ? progressItems.join(', ') : null;
  }

  /**
   * Compute average of an array, returning 0 for empty arrays.
   */
  avg(values) {
    if (!values || values.length === 0) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  /**
   * Clear all tracking data.
   */
  reset() {
    this.data = this.createEmpty();
    this.save();
  }
}

const improvementTracker = new ImprovementTracker();
