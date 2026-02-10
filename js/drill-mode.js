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
}

const drillMode = new DrillMode();
