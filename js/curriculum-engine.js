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
      'inconsistentContactPoint': 'contact_point',
      // Volley faults
      'punchingNotSwinging': 'volley_technique',
      'volleyGripTooLow': 'volley_technique',
      'volleyTooDeep': 'volley_footwork',
      'noSplitStepBeforeVolley': 'volley_footwork',
      // Overhead faults
      'poorOverheadPositioning': 'overhead',
      'lowOverheadContactPoint': 'overhead'
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
      'consistency': { quality: 75 },
      'volley_technique': { quality: 65 },
      'volley_footwork': { footworkScore: 50 },
      'overhead': { quality: 60 }
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
   * Uses session-count-based week detection: advances week only after
   * enough sessions, auto-extends if player skipped time.
   * @returns {{ primaryFocus: string, secondaryFocus: string|null, targets: Object, weekTheme: string }|null}
   */
  getTodayFocus() {
    if (!this.curriculum) return null;

    const weekIndex = this._getEffectiveWeekIndex();
    const week = this.curriculum.weeks[weekIndex];

    if (!week) return null;

    return {
      primaryFocus: week.focus,
      secondaryFocus: this.curriculum.secondaryFocus,
      targets: week.targets,
      weekTheme: week.theme,
      weekNumber: week.number,
      sessionsCompleted: this.curriculum.sessionsCompleted,
      behindSchedule: this._isBehindSchedule(),
      extended: this.curriculum.extended || false
    };
  }

  /**
   * Determine effective week index based on actual sessions played.
   * Each week requires at least 2 sessions to advance.
   * Falls back to calendar-based if sessions are on track.
   */
  _getEffectiveWeekIndex() {
    const sessionsPerWeek = 2;
    const sessionBasedWeek = Math.floor(this.curriculum.sessionsCompleted / sessionsPerWeek);
    const daysSinceStart = (Date.now() - this.curriculum.startDate) / (1000 * 60 * 60 * 24);
    const calendarWeek = Math.floor(daysSinceStart / 7);

    // Use whichever is slower — don't advance until player has done the sessions
    return Math.min(3, Math.min(sessionBasedWeek, calendarWeek));
  }

  /**
   * Check if player is behind the calendar schedule.
   */
  _isBehindSchedule() {
    const daysSinceStart = (Date.now() - this.curriculum.startDate) / (1000 * 60 * 60 * 24);
    const expectedSessions = Math.floor(daysSinceStart / 7) * 2; // 2 sessions/week
    return this.curriculum.sessionsCompleted < expectedSessions;
  }

  /**
   * Check for gaps and auto-extend or regenerate the mesocycle.
   * Call at session start. Returns 'extended' | 'regenerated' | null.
   */
  async checkAndAdjustSchedule() {
    if (!this.curriculum) return null;

    const daysSinceStart = (Date.now() - this.curriculum.startDate) / (1000 * 60 * 60 * 24);
    const lastSessionDaysAgo = this.curriculum.lastSessionDate
      ? (Date.now() - this.curriculum.lastSessionDate) / (1000 * 60 * 60 * 24)
      : daysSinceStart;

    // If curriculum expired by calendar but player hasn't finished, extend
    if (daysSinceStart > 28 && this.curriculum.sessionsCompleted < 8) {
      // Extend by the gap duration (up to 2 extra weeks)
      const extensionDays = Math.min(14, lastSessionDaysAgo);
      this.curriculum.startDate += extensionDays * 24 * 60 * 60 * 1000;
      this.curriculum.extended = true;
      await this.save();
      return 'extended';
    }

    // If player skipped more than 2 weeks and hasn't progressed, regenerate
    if (lastSessionDaysAgo > 14 && this.curriculum.sessionsCompleted < 4) {
      // Record session dates for history
      if (!this.curriculum.sessionDates) this.curriculum.sessionDates = [];

      const skillLevel = this.curriculum.skillLevel || 'intermediate';
      const improvementData = typeof improvementTracker !== 'undefined' ? improvementTracker : null;
      await this.generateCurriculum(skillLevel, improvementData);
      return 'regenerated';
    }

    return null;
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
   * Get drill difficulty from ImprovementTracker's persisted drill history.
   * @param {string} drillId
   * @returns {number} difficulty multiplier (default 1.0)
   */
  getDrillDifficulty(drillId) {
    if (typeof improvementTracker !== 'undefined' && improvementTracker.isLoaded) {
      return improvementTracker.getDrillDifficulty(drillId);
    }
    return 1.0;
  }

  /**
   * Get a curriculum-aware drill suggestion including persisted difficulty.
   * @param {string} drillId
   * @returns {{ drillId: string, difficulty: number, targetReps: number, focusArea: string|null }}
   */
  getCurriculumDrillSuggestion(drillId) {
    const difficulty = this.getDrillDifficulty(drillId);
    const focus = this.getTodayFocus();
    const baseReps = 10;

    return {
      drillId,
      difficulty,
      targetReps: Math.round(baseReps * difficulty),
      focusArea: focus?.primaryFocus || null
    };
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
    if (focus.behindSchedule) {
      block += `- Note: Player is behind schedule — encourage consistency and celebrate showing up.\n`;
    }
    if (focus.extended) {
      block += `- Note: Curriculum was extended due to time gap — ease back in.\n`;
    }

    return block;
  }

  /**
   * Record a completed session with date tracking.
   */
  async recordSession() {
    if (!this.curriculum) return;
    this.curriculum.sessionsCompleted++;
    this.curriculum.lastSessionDate = Date.now();

    // Track session dates for gap detection
    if (!this.curriculum.sessionDates) this.curriculum.sessionDates = [];
    this.curriculum.sessionDates.push(Date.now());
    // Keep last 20 dates
    if (this.curriculum.sessionDates.length > 20) {
      this.curriculum.sessionDates = this.curriculum.sessionDates.slice(-20);
    }

    await this.save();
  }

  /**
   * Check if curriculum is active (not expired).
   * Accounts for extensions: active until 28 days from (possibly adjusted) start date,
   * OR until player has completed 8+ sessions.
   */
  isActive() {
    if (!this.curriculum) return false;
    const daysSinceStart = (Date.now() - this.curriculum.startDate) / (1000 * 60 * 60 * 24);
    // Active if within 28 days OR if player hasn't finished required sessions
    if (daysSinceStart <= 28) return true;
    if (this.curriculum.sessionsCompleted < 8 && this.curriculum.extended) return true;
    return false;
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
