/**
 * CurriculumEngine - Generates structured 4-week training mesocycles
 *
 * Weeks 1-2: Technique focus (isolated drills)
 * Week 3: Integration (combined with match play)
 * Week 4: Testing (measure improvement)
 *
 * Persists in localStorage. Can override coaching orchestrator priorities.
 */
class CurriculumEngine {
  constructor() {
    this.STORAGE_KEY = 'ace_curriculum';
    this.curriculum = this._loadFromLocalStorage();
  }

  _useSupabase() {
    return typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated();
  }

  /**
   * Initialize from Supabase (or localStorage fallback).
   * Call after auth is confirmed.
   */
  async init() {
    if (this._useSupabase()) {
      this.curriculum = await supabaseClient.loadActiveCurriculum();
    } else {
      this.curriculum = this._loadFromLocalStorage();
    }
  }

  _loadFromLocalStorage() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Generate a new 4-week curriculum based on current data.
   * @param {string} skillLevel - beginner/intermediate/advanced/elite
   * @param {Object} improvementData - from ImprovementTracker
   * @returns {Object} curriculum object
   */
  async generateCurriculum(skillLevel, improvementData) {
    const focusAreas = this.identifyFocusAreas(skillLevel, improvementData);

    const startDate = Date.now();
    const curriculum = {
      startDate,
      skillLevel,
      weeks: [
        { number: 1, theme: 'technique_isolation', focus: focusAreas[0], targets: this.getWeekTargets(focusAreas[0], skillLevel, 0.5) },
        { number: 2, theme: 'technique_refinement', focus: focusAreas[0], targets: this.getWeekTargets(focusAreas[0], skillLevel, 0.75) },
        { number: 3, theme: 'integration', focus: focusAreas.length > 1 ? focusAreas[1] : focusAreas[0], targets: this.getWeekTargets(focusAreas.length > 1 ? focusAreas[1] : focusAreas[0], skillLevel, 0.85) },
        { number: 4, theme: 'testing', focus: 'overall', targets: { quality: this.getQualityTarget(skillLevel) } }
      ],
      primaryFocus: focusAreas[0],
      secondaryFocus: focusAreas.length > 1 ? focusAreas[1] : null,
      sessionsCompleted: 0,
      lastSessionDate: null
    };

    this.curriculum = curriculum;

    if (this._useSupabase()) {
      const result = await supabaseClient.createCurriculum(curriculum);
      if (result) this.curriculum.id = result.id;
    } else {
      this.save();
    }

    return curriculum;
  }

  /**
   * Identify top focus areas from improvement data.
   */
  identifyFocusAreas(skillLevel, improvementData) {
    const areas = [];

    if (improvementData?.data?.faultHistory) {
      // Find most frequent unresolved faults
      const faults = improvementData.data.faultHistory;
      const faultCounts = {};
      for (const [faultId, history] of Object.entries(faults)) {
        if (!history.resolved) {
          faultCounts[faultId] = history.count || 0;
        }
      }

      const sorted = Object.entries(faultCounts).sort((a, b) => b[1] - a[1]);
      for (const [faultId] of sorted.slice(0, 2)) {
        areas.push(this.faultToFocusArea(faultId));
      }
    }

    // Defaults based on skill level
    if (areas.length === 0) {
      if (skillLevel === 'beginner') {
        areas.push('preparation', 'contact_point');
      } else if (skillLevel === 'intermediate') {
        areas.push('rotation', 'footwork');
      } else {
        areas.push('power', 'consistency');
      }
    }

    return areas.slice(0, 2);
  }

  /**
   * Map a fault ID to a focus area name.
   */
  faultToFocusArea(faultId) {
    const map = {
      'latePreparation': 'preparation',
      'insufficientRotation': 'rotation',
      'poorWeightTransfer': 'weight_transfer',
      'collapsingElbowChickenWing': 'arm_extension',
      'poorFollowThrough': 'follow_through',
      'poorFootwork': 'footwork',
      'lowRacquetSpeed': 'power',
      'inconsistentContactPoint': 'contact_point'
    };
    return map[faultId] || faultId;
  }

  /**
   * Get week-specific targets based on focus area and progression.
   */
  getWeekTargets(focusArea, skillLevel, progressFraction) {
    const baseTargets = {
      'preparation': { preparationTime: 0.5 },
      'rotation': { rotation: skillLevel === 'beginner' ? 25 : 35 },
      'weight_transfer': { forwardMomentum: 0.6 },
      'arm_extension': { elbowAngle: 140 },
      'follow_through': { smoothness: 65 },
      'footwork': { footworkScore: 55 },
      'power': { velocity: 0.04 },
      'contact_point': { contactPointVariance: 0.1 },
      'consistency': { quality: 75 }
    };

    const targets = baseTargets[focusArea] || { quality: 70 };

    // Scale targets by progression fraction
    const scaled = {};
    for (const [key, val] of Object.entries(targets)) {
      scaled[key] = typeof val === 'number' ? Math.round(val * progressFraction * 100) / 100 : val;
    }
    return scaled;
  }

  /**
   * Get quality target for skill level.
   */
  getQualityTarget(skillLevel) {
    const targets = { beginner: 55, intermediate: 65, advanced: 75, elite: 85 };
    return targets[skillLevel] || 65;
  }

  /**
   * Get today's focus based on where we are in the curriculum.
   * @returns {{ primaryFocus: string, secondaryFocus: string|null, targets: Object, weekTheme: string }|null}
   */
  getTodayFocus() {
    if (!this.curriculum) return null;

    const daysSinceStart = (Date.now() - this.curriculum.startDate) / (1000 * 60 * 60 * 24);
    const weekIndex = Math.min(3, Math.floor(daysSinceStart / 7));
    const week = this.curriculum.weeks[weekIndex];

    if (!week) return null;

    return {
      primaryFocus: week.focus,
      secondaryFocus: this.curriculum.secondaryFocus,
      targets: week.targets,
      weekTheme: week.theme,
      weekNumber: week.number,
      sessionsCompleted: this.curriculum.sessionsCompleted
    };
  }

  /**
   * Check if curriculum should override coaching orchestrator priority.
   * Returns the focus area ID or null.
   */
  getOverridePriority() {
    const focus = this.getTodayFocus();
    if (!focus) return null;

    // Only override during technique weeks (1-2)
    if (focus.weekTheme === 'technique_isolation' || focus.weekTheme === 'technique_refinement') {
      return focus.primaryFocus;
    }
    return null;
  }

  /**
   * Format for GPT system prompt.
   */
  formatForSystemPrompt() {
    const focus = this.getTodayFocus();
    if (!focus) return '';

    let block = `\nCURRICULUM (Week ${focus.weekNumber}/4 — ${focus.weekTheme.replace(/_/g, ' ')}):\n`;
    block += `- Primary focus: ${focus.primaryFocus.replace(/_/g, ' ')}\n`;
    if (focus.secondaryFocus) {
      block += `- Secondary focus: ${focus.secondaryFocus.replace(/_/g, ' ')}\n`;
    }
    if (focus.targets) {
      block += `- Targets: ${JSON.stringify(focus.targets)}\n`;
    }
    block += `- Sessions completed: ${focus.sessionsCompleted}\n`;

    return block;
  }

  /**
   * Record a completed session.
   */
  async recordSession() {
    if (!this.curriculum) return;
    this.curriculum.sessionsCompleted++;
    this.curriculum.lastSessionDate = Date.now();
    await this.save();
  }

  /**
   * Check if curriculum is active (not expired).
   */
  isActive() {
    if (!this.curriculum) return false;
    const daysSinceStart = (Date.now() - this.curriculum.startDate) / (1000 * 60 * 60 * 24);
    return daysSinceStart <= 28; // 4 weeks
  }

  // --- Persistence ---

  async save() {
    if (this._useSupabase()) {
      await supabaseClient.updateCurriculum({
        sessionsCompleted: this.curriculum.sessionsCompleted,
        lastSessionDate: this.curriculum.lastSessionDate
      });
    } else {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.curriculum));
      } catch (e) {
        console.error('CurriculumEngine: save failed', e);
      }
    }
  }

  reset() {
    this.curriculum = null;
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
