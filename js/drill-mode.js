/**
 * DrillMode — Structured practice focused on a single metric
 * Counts reps, scores each against a target, shows per-rep results.
 */
class DrillMode {
  constructor() {
    this.isActive = false;
    this.currentDrill = null;

    this.drills = {
      hip_rotation_power: {
        id: 'hip_rotation_power',
        name: 'Hip Rotation Power',
        strokeType: 'Forehand',
        metric: 'hipShoulderSeparation',
        metricLabel: 'Hip-Shoulder Separation',
        unit: 'deg',
        targets: { beginner: 25, intermediate: 35, advanced: 45, elite: 55 },
        totalReps: 10,
        description: 'Focus on rotating your hips before your shoulders unwind'
      },
      full_extension: {
        id: 'full_extension',
        name: 'Full Extension',
        strokeType: null,
        acceptedTypes: ['Forehand', 'Backhand'],
        metric: 'elbowAngle',
        metricLabel: 'Elbow Extension',
        unit: 'deg',
        targets: { beginner: 135, intermediate: 145, advanced: 155, elite: 160 },
        totalReps: 10,
        description: 'Extend your arm fully through the contact zone'
      },
      smooth_acceleration: {
        id: 'smooth_acceleration',
        name: 'Smooth Acceleration',
        strokeType: null,
        acceptedTypes: null,
        metric: 'smoothness',
        metricLabel: 'Swing Smoothness',
        unit: '',
        targets: { beginner: 50, intermediate: 65, advanced: 75, elite: 85 },
        totalReps: 10,
        description: 'Accelerate smoothly through the ball without jerky movements'
      },
      explosive_serve: {
        id: 'explosive_serve',
        name: 'Explosive Serve',
        strokeType: 'Serve',
        metric: 'velocity',
        metricLabel: 'Racquet Speed',
        unit: 'tl/s',
        targets: { beginner: 60, intermediate: 100, advanced: 140, elite: 180 },
        totalReps: 8,
        description: 'Generate maximum racquet head speed through the trophy position'
      },
      footwork_base: {
        id: 'footwork_base',
        name: 'Stable Base',
        strokeType: null,
        acceptedTypes: ['Forehand', 'Backhand'],
        metric: 'footworkScore',
        metricLabel: 'Footwork Score',
        unit: '',
        targets: { beginner: 55, intermediate: 65, advanced: 75, elite: 85 },
        totalReps: 10,
        description: 'Focus on wide stance, stepping into the ball, and recovering to ready position'
      },
      serve_trophy_position: {
        id: 'serve_trophy_position',
        name: 'Trophy Position',
        strokeType: 'Serve',
        metric: 'serveTrophyScore',
        metricLabel: 'Trophy Score',
        unit: '',
        targets: { beginner: 40, intermediate: 55, advanced: 70, elite: 85 },
        totalReps: 8,
        description: 'Focus on proper trophy position: elbow at 90 degrees, shoulder tilt, knees bent'
      },
      serve_leg_drive: {
        id: 'serve_leg_drive',
        name: 'Serve Leg Drive',
        strokeType: 'Serve',
        metric: 'serveLegDriveScore',
        metricLabel: 'Leg Drive Score',
        unit: '',
        targets: { beginner: 35, intermediate: 50, advanced: 65, elite: 80 },
        totalReps: 8,
        description: 'Bend knees deeply during toss and drive up explosively through the ball'
      }
    };
  }

  /**
   * Start a drill.
   * @param {string} drillId - Predefined drill ID or 'auto'
   * @param {string} skillLevel - beginner/intermediate/advanced/elite
   */
  startDrill(drillId, skillLevel = 'intermediate') {
    let drill;

    if (drillId === 'auto') {
      drill = this.buildAutoDrill(skillLevel);
      if (!drill) return null;
    } else {
      drill = this.drills[drillId];
      if (!drill) return null;
      drill = { ...drill };
    }

    const target = drill.targets?.[skillLevel] || drill.targets?.intermediate || drill.target;

    this.currentDrill = {
      ...drill,
      target: target,
      totalReps: drill.totalReps || 10,
      currentRep: 0,
      scores: [],
      wrongTypeCount: 0,
      startTime: Date.now(),
      skillLevel
    };

    this.isActive = true;
    return this.currentDrill;
  }

  /**
   * Build an auto-drill from improvementTracker focus areas.
   */
  buildAutoDrill(skillLevel) {
    if (typeof improvementTracker === 'undefined') return null;
    const plan = improvementTracker.getCoachingPlan();
    if (!plan?.focusAreas?.length) return null;

    const focus = plan.focusAreas[0];
    const metricUnits = {
      hipShoulderSeparation: 'deg',
      elbowAngle: 'deg',
      rotation: 'deg',
      smoothness: '',
      velocity: 'tl/s'
    };

    return {
      id: 'auto',
      name: focus.area,
      strokeType: focus.strokeType || null,
      acceptedTypes: focus.strokeType ? [focus.strokeType] : null,
      metric: focus.metric,
      metricLabel: focus.area,
      unit: metricUnits[focus.metric] || '',
      target: focus.target,
      targets: { [skillLevel]: focus.target },
      totalReps: 10,
      description: focus.drill || focus.why || 'From your improvement plan'
    };
  }

  /**
   * Record a stroke during an active drill.
   * @returns {object} Rep result or null
   */
  recordStroke(strokeData) {
    if (!this.isActive || !this.currentDrill) return null;

    const drill = this.currentDrill;

    // Check stroke type filter
    if (drill.strokeType && strokeData.type !== drill.strokeType) {
      drill.wrongTypeCount++;
      return { wrongType: true, expectedType: drill.strokeType };
    }
    if (drill.acceptedTypes && !drill.acceptedTypes.includes(strokeData.type)) {
      drill.wrongTypeCount++;
      return { wrongType: true, expectedType: drill.acceptedTypes.join('/') };
    }

    // Extract the target metric
    const metricValue = this.extractMetric(strokeData, drill.metric);
    if (metricValue === null) return { error: 'metric_unavailable' };

    drill.currentRep++;
    drill.scores.push({
      value: metricValue,
      quality: strokeData.quality?.overall || 0,
      timestamp: Date.now()
    });

    const isComplete = drill.currentRep >= drill.totalReps;
    const hitTarget = metricValue >= drill.target;

    // Fire Gemini visual assessment at midpoint and completion
    const midpoint = Math.floor(drill.totalReps / 2);
    if ((drill.currentRep === midpoint || isComplete) && !drill._geminiAssessmentSent) {
      this.fireGeminiDrillAssessment(drill, isComplete);
      if (isComplete) drill._geminiAssessmentSent = true;
    }

    return {
      wrongType: false,
      rep: drill.currentRep,
      totalReps: drill.totalReps,
      metricValue,
      target: drill.target,
      hitTarget,
      isComplete,
      average: this.getAverage(),
      bestValue: Math.max(...drill.scores.map(s => s.value)),
      repsAtTarget: drill.scores.filter(s => s.value >= drill.target).length
    };
  }

  /**
   * Fire async Gemini visual assessment during drill.
   * Sends summary + keyframes from rolling buffer for drill-specific analysis.
   */
  fireGeminiDrillAssessment(drill, isComplete) {
    const summary = this.getSummary();
    if (!summary) return;

    const avg = Math.round(summary.average);
    const phase = isComplete ? 'completed' : 'midpoint';

    // Try Gemini visual drill assessment first
    if (typeof tennisAI !== 'undefined' && tennisAI.sceneAnalyzer?.enabled) {
      tennisAI.sceneAnalyzer.analyzeDrill(
        drill.name, drill.currentRep, drill.totalReps, isComplete
      ).then(visualAssessment => {
        if (visualAssessment) {
          // Combine visual assessment with drill stats for GPT
          const drillContext = `DRILL VISUAL ASSESSMENT (${phase}): "${drill.name}" — ${drill.currentRep}/${drill.totalReps} reps, avg ${avg} (target: ${drill.target}). ` +
            `Hit rate: ${summary.repsAtTarget}/${drill.currentRep}. ` +
            `Visual observation: ${visualAssessment}`;
          this._sendDrillToGPT(drillContext);
        } else {
          // Fall back to text-only
          this._fireTextOnlyAssessment(drill, summary, avg, phase, isComplete);
        }
      }).catch(() => {
        this._fireTextOnlyAssessment(drill, summary, avg, phase, isComplete);
      });
    } else {
      this._fireTextOnlyAssessment(drill, summary, avg, phase, isComplete);
    }
  }

  _fireTextOnlyAssessment(drill, summary, avg, phase, isComplete) {
    const drillContext = `DRILL ASSESSMENT (${phase}): "${drill.name}" — ${drill.currentRep}/${drill.totalReps} reps, average ${avg} (target: ${drill.target}). ` +
      `Hit rate: ${summary.repsAtTarget}/${drill.currentRep}. Trend: ${summary.trend || 'stable'}. ` +
      `${isComplete ? 'Give a brief drill summary and one thing to work on next.' : 'Give one mid-drill adjustment.'}`;
    this._sendDrillToGPT(drillContext);
  }

  _sendDrillToGPT(message) {
    if (typeof gptVoiceCoach !== 'undefined' && gptVoiceCoach.isConnected) {
      setTimeout(() => {
        gptVoiceCoach.analyzeStroke({
          type: 'proactive_trigger',
          message
        });
      }, 1500);
    }
  }

  extractMetric(strokeData, metric) {
    const map = {
      hipShoulderSeparation: strokeData.technique?.hipShoulderSeparation,
      elbowAngle: strokeData.technique?.elbowAngleAtContact,
      smoothness: strokeData.smoothness,
      velocity: strokeData.velocity?.magnitude,
      rotation: strokeData.rotation ? Math.abs(strokeData.rotation) : null,
      footworkScore: strokeData.footwork?.score,
      serveTrophyScore: strokeData.serveAnalysis?.trophy?.score,
      serveLegDriveScore: strokeData.serveAnalysis?.legDrive?.score,
      serveScore: strokeData.serveAnalysis?.serveScore
    };
    const val = map[metric];
    return val != null ? val : null;
  }

  getAverage() {
    if (!this.currentDrill || this.currentDrill.scores.length === 0) return 0;
    const sum = this.currentDrill.scores.reduce((a, s) => a + s.value, 0);
    return sum / this.currentDrill.scores.length;
  }

  getSummary() {
    if (!this.currentDrill) return null;
    const drill = this.currentDrill;
    const values = drill.scores.map(s => s.value);
    if (values.length === 0) return null;

    return {
      drillName: drill.name,
      metric: drill.metricLabel,
      unit: drill.unit,
      target: drill.target,
      totalReps: drill.currentRep,
      average: this.getAverage(),
      best: Math.max(...values),
      worst: Math.min(...values),
      repsAtTarget: drill.scores.filter(s => s.value >= drill.target).length,
      scores: drill.scores,
      duration: Date.now() - drill.startTime,
      trend: values.length >= 4 ? this.computeTrend(values) : 'stable'
    };
  }

  computeTrend(values) {
    const mid = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const secondHalf = values.slice(mid).reduce((a, b) => a + b, 0) / (values.length - mid);
    if (secondHalf > firstHalf + 2) return 'improving';
    if (secondHalf < firstHalf - 2) return 'declining';
    return 'stable';
  }

  stopDrill() {
    const summary = this.getSummary();
    this.isActive = false;
    this.currentDrill = null;
    return summary;
  }

  // ========== Phase 4B: Curriculum-Aware Drill Suggestions ==========

  /**
   * Get a suggested drill based on active curriculum focus.
   * Returns a drill ID or null if no curriculum is active.
   */
  getCurriculumDrillSuggestion() {
    if (typeof tennisAI === 'undefined' || !tennisAI.curriculumEngine) return null;
    const engine = tennisAI.curriculumEngine;
    if (!engine.isActive()) return null;

    const focus = engine.getTodayFocus();
    if (!focus) return null;

    // Map curriculum focus areas to drill IDs
    const focusToDrill = {
      'preparation': null,              // no specific drill yet
      'rotation': 'hip_rotation_power',
      'weight_transfer': 'footwork_base',
      'arm_extension': 'full_extension',
      'follow_through': 'smooth_acceleration',
      'footwork': 'footwork_base',
      'power': 'explosive_serve',
      'contact_point': null,
      'consistency': 'smooth_acceleration'
    };

    const drillId = focusToDrill[focus.primaryFocus];
    if (!drillId || !this.drills[drillId]) return null;

    return {
      drillId,
      drill: this.drills[drillId],
      weekTheme: focus.weekTheme,
      weekNumber: focus.weekNumber,
      reason: `Curriculum Week ${focus.weekNumber}: ${focus.primaryFocus.replace(/_/g, ' ')}`
    };
  }

  /**
   * Check if current drill target should be progressively increased.
   * Increases by 10% if player hit 80%+ of target in last 3 consecutive sets.
   * @returns {boolean} true if target was increased
   */
  checkProgressiveDifficulty() {
    if (!this.currentDrill || !this.currentDrill.scores) return false;

    const scores = this.currentDrill.scores;
    const target = this.currentDrill.target;

    // Need at least 3 sets worth (30 reps for 10-rep drills)
    if (scores.length < 3 * (this.currentDrill.totalReps || 10)) return false;

    // Check last 3 sets
    const repsPerSet = this.currentDrill.totalReps || 10;
    const lastThreeSets = [];
    for (let i = 0; i < 3; i++) {
      const setStart = scores.length - repsPerSet * (i + 1);
      const setEnd = scores.length - repsPerSet * i;
      if (setStart < 0) return false;
      const setScores = scores.slice(setStart, setEnd);
      const hitRate = setScores.filter(s => s.value >= target).length / setScores.length;
      lastThreeSets.push(hitRate);
    }

    // All 3 sets must have 80%+ hit rate
    if (lastThreeSets.every(rate => rate >= 0.8)) {
      const increase = Math.round(target * 0.1);
      this.currentDrill.target = target + Math.max(1, increase);
      console.log(`DrillMode: progressive difficulty — target increased to ${this.currentDrill.target}`);
      return true;
    }

    return false;
  }
}

const drillMode = new DrillMode();
