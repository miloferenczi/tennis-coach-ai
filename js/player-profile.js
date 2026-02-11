/**
 * PlayerProfile - Cross-session player tracking and adaptive coaching
 * Tracks weaknesses, strengths, improvement trends, and provides context for GPT coaching
 */
class PlayerProfile {
  constructor() {
    this.PROFILE_KEY = 'techniqueai_player_profile';
    // Load from localStorage synchronously for immediate availability
    this.profile = this._loadFromLocalStorage();
    this.isLoaded = true; // localStorage is sync, so always "loaded"
  }

  /**
   * Initialize profile from Supabase (or localStorage fallback).
   * Call this after auth is confirmed.
   */
  async init() {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated()) {
      const data = await supabaseClient.loadProfile();
      if (data) {
        this.profile = { ...this.getDefaultProfile(), ...this._fromSupabase(data) };
        this.isLoaded = true;
        return;
      }
    }
    // Fallback: localStorage
    this.profile = this._loadFromLocalStorage();
    this.isLoaded = true;
  }

  /**
   * Convert Supabase profile shape to internal profile shape.
   */
  _fromSupabase(data) {
    return {
      createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
      lastSessionAt: null,
      totalSessions: data.totalSessions || 0,
      totalStrokes: data.totalStrokes || 0,
      totalPracticeTime: data.totalPracticeTime || 0,
      currentSkillLevel: data.skillLevel || 'beginner',
      skillProgress: data.skillProgress || [],
      weaknesses: data.weaknesses || this.getDefaultProfile().weaknesses,
      strengths: data.strengths || {},
      strokeProficiency: data.strokeProficiency || this.getDefaultProfile().strokeProficiency,
      recentSessions: data.recentSessions || [],
      currentGoal: data.currentGoal || null,
      coachingPreferences: data.coachingPreferences || this.getDefaultProfile().coachingPreferences,
      fatiguePatterns: data.fatiguePatterns || this.getDefaultProfile().fatiguePatterns,
      milestones: data.milestones || [],
      // Onboarding & subscription
      sport: data.sport || 'tennis',
      ntrpLevel: data.ntrpLevel || null,
      improvementGoals: data.improvementGoals || [],
      customGoalText: data.customGoalText || null,
      coachPreference: data.coachPreference || 'alex',
      displayName: data.displayName || null,
      age: data.age || null,
      subscriptionTier: data.subscriptionTier || 'free',
      trialStartDate: data.trialStartDate || null,
      trialUsed: data.trialUsed || false,
      onboardingCompleted: data.onboardingCompleted || false
    };
  }

  /**
   * Load from localStorage (legacy/fallback).
   */
  _loadFromLocalStorage() {
    try {
      const data = localStorage.getItem(this.PROFILE_KEY);
      if (data) {
        return { ...this.getDefaultProfile(), ...JSON.parse(data) };
      }
    } catch (e) {
      console.error('Failed to load player profile:', e);
    }
    return this.getDefaultProfile();
  }

  /**
   * Default profile structure
   */
  getDefaultProfile() {
    return {
      createdAt: Date.now(),
      lastSessionAt: null,
      totalSessions: 0,
      totalStrokes: 0,
      totalPracticeTime: 0, // ms

      // Skill assessment
      currentSkillLevel: 'beginner',
      skillProgress: [], // [{date, level, avgScore}]

      // Weakness tracking (persistent across sessions)
      weaknesses: {
        // key: {count, lastSeen, severity, improving}
        'Elbow Extension': { count: 0, lastSeen: null, severity: 0, improving: false },
        'Hip-Shoulder Separation': { count: 0, lastSeen: null, severity: 0, improving: false },
        'Weight Transfer': { count: 0, lastSeen: null, severity: 0, improving: false },
        'Follow Through': { count: 0, lastSeen: null, severity: 0, improving: false },
        'Preparation': { count: 0, lastSeen: null, severity: 0, improving: false },
        'Contact Point': { count: 0, lastSeen: null, severity: 0, improving: false }
      },

      // Strengths tracking
      strengths: {
        // key: {count, avgScore, consistency}
      },

      // Stroke type proficiency
      strokeProficiency: {
        'Forehand': { attempts: 0, avgScore: 0, bestScore: 0, trend: 'stable' },
        'Backhand': { attempts: 0, avgScore: 0, bestScore: 0, trend: 'stable' },
        'Serve': { attempts: 0, avgScore: 0, bestScore: 0, trend: 'stable' },
        'Volley': { attempts: 0, avgScore: 0, bestScore: 0, trend: 'stable' }
      },

      // Recent session contexts for GPT reference
      recentSessions: [], // Last 5 sessions with key info

      // Current session goal
      currentGoal: null,

      // Coaching preferences learned over time
      coachingPreferences: {
        respondsWellTo: [], // e.g., ['visual cues', 'feel-based cues']
        needsMoreWorkOn: [],
        preferredFeedbackFrequency: 'normal' // 'minimal', 'normal', 'frequent'
      },

      // Fatigue patterns
      fatiguePatterns: {
        avgDeclinePoint: null, // minutes into session when quality typically drops
        recoveryRate: null
      },

      // Milestones achieved
      milestones: [],

      // Onboarding & subscription
      sport: 'tennis',
      ntrpLevel: null,
      improvementGoals: [],
      customGoalText: null,
      coachPreference: 'alex',
      displayName: null,
      age: null,
      subscriptionTier: 'free',
      trialStartDate: null,
      trialUsed: false,
      onboardingCompleted: false
    };
  }

  /**
   * Save profile to Supabase (or localStorage fallback).
   */
  async saveProfile() {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated()) {
      await supabaseClient.updateProfile({
        skillLevel: this.profile.currentSkillLevel,
        totalSessions: this.profile.totalSessions,
        totalStrokes: this.profile.totalStrokes,
        totalPracticeTime: this.profile.totalPracticeTime,
        weaknesses: this.profile.weaknesses,
        strengths: this.profile.strengths,
        strokeProficiency: this.profile.strokeProficiency,
        recentSessions: this.profile.recentSessions,
        skillProgress: this.profile.skillProgress,
        currentGoal: this.profile.currentGoal,
        coachingPreferences: this.profile.coachingPreferences,
        fatiguePatterns: this.profile.fatiguePatterns,
        milestones: this.profile.milestones
      });
    } else {
      try {
        localStorage.setItem(this.PROFILE_KEY, JSON.stringify(this.profile));
      } catch (e) {
        console.error('Failed to save player profile:', e);
      }
    }
  }

  /**
   * Start a new session - sets goals and prepares context
   */
  async startSession() {
    // Determine session goal based on weaknesses
    const topWeakness = this.getTopWeakness();
    if (topWeakness) {
      this.profile.currentGoal = {
        type: 'fix_weakness',
        target: topWeakness.name,
        description: `Focus on improving ${topWeakness.name.toLowerCase()}`,
        startedAt: Date.now(),
        baselineScore: topWeakness.severity
      };
    } else {
      this.profile.currentGoal = {
        type: 'maintain',
        description: 'Maintain consistency and technique quality',
        startedAt: Date.now()
      };
    }

    await this.saveProfile();
    return this.profile.currentGoal;
  }

  /**
   * Record a completed session
   */
  async recordSession(sessionSummary) {
    if (!sessionSummary) return;

    this.profile.lastSessionAt = Date.now();
    this.profile.totalSessions++;
    this.profile.totalStrokes += sessionSummary.totalStrokes || 0;
    this.profile.totalPracticeTime += sessionSummary.duration || 0;

    // Update skill level
    if (sessionSummary.skillLevel) {
      this.profile.currentSkillLevel = sessionSummary.skillLevel;
      this.profile.skillProgress.push({
        date: Date.now(),
        level: sessionSummary.skillLevel,
        avgScore: sessionSummary.averageScore
      });
      // Keep last 20 skill progress entries
      if (this.profile.skillProgress.length > 20) {
        this.profile.skillProgress = this.profile.skillProgress.slice(-20);
      }
    }

    // Update weaknesses
    if (sessionSummary.weaknesses) {
      for (const weakness of sessionSummary.weaknesses) {
        if (this.profile.weaknesses[weakness]) {
          const w = this.profile.weaknesses[weakness];
          const wasWeak = w.count > 0;
          w.count++;
          w.lastSeen = Date.now();
          w.severity = Math.min(10, w.severity + 1);
          w.improving = false;
        }
      }
    }

    // Check for improvements (weaknesses that weren't detected this session)
    for (const [name, weakness] of Object.entries(this.profile.weaknesses)) {
      if (weakness.count > 0 && weakness.lastSeen) {
        const wasInThisSession = sessionSummary.weaknesses?.includes(name);
        if (!wasInThisSession) {
          weakness.improving = true;
          weakness.severity = Math.max(0, weakness.severity - 0.5);
        }
      }
    }

    // Update stroke proficiency
    if (sessionSummary.strokeDistribution) {
      for (const [strokeType, count] of Object.entries(sessionSummary.strokeDistribution)) {
        const key = this.normalizeStrokeType(strokeType);
        if (this.profile.strokeProficiency[key]) {
          const prof = this.profile.strokeProficiency[key];
          const oldTotal = prof.attempts;
          const newTotal = oldTotal + count;

          // Update running average
          if (sessionSummary.averageScore) {
            prof.avgScore = ((prof.avgScore * oldTotal) + (sessionSummary.averageScore * count)) / newTotal;
          }
          prof.attempts = newTotal;

          if (sessionSummary.bestScore > prof.bestScore) {
            prof.bestScore = sessionSummary.bestScore;
          }
        }
      }
    }

    // Add to recent sessions (keep last 5)
    this.profile.recentSessions.unshift({
      date: Date.now(),
      duration: sessionSummary.duration,
      strokes: sessionSummary.totalStrokes,
      avgScore: sessionSummary.averageScore,
      bestStroke: sessionSummary.bestStrokeType,
      weaknesses: sessionSummary.weaknesses,
      improvement: sessionSummary.improvement,
      goal: this.profile.currentGoal
    });
    if (this.profile.recentSessions.length > 5) {
      this.profile.recentSessions = this.profile.recentSessions.slice(0, 5);
    }

    // Check for milestone achievements
    this.checkMilestones(sessionSummary);

    // Clear current goal
    this.profile.currentGoal = null;

    await this.saveProfile();
  }

  /**
   * Normalize stroke type name
   */
  normalizeStrokeType(type) {
    const normalized = type.toLowerCase();
    if (normalized.includes('forehand')) return 'Forehand';
    if (normalized.includes('backhand')) return 'Backhand';
    if (normalized.includes('serve')) return 'Serve';
    if (normalized.includes('volley')) return 'Volley';
    return 'Forehand';
  }

  /**
   * Get top weakness to work on
   */
  getTopWeakness() {
    let topWeakness = null;
    let maxSeverity = 0;

    for (const [name, weakness] of Object.entries(this.profile.weaknesses)) {
      if (weakness.count > 0 && weakness.severity > maxSeverity && !weakness.improving) {
        maxSeverity = weakness.severity;
        topWeakness = { name, ...weakness };
      }
    }

    return topWeakness;
  }

  /**
   * Get improving areas (for celebration)
   */
  getImprovingAreas() {
    const improving = [];
    for (const [name, weakness] of Object.entries(this.profile.weaknesses)) {
      if (weakness.improving && weakness.count > 0) {
        improving.push(name);
      }
    }
    return improving;
  }

  /**
   * Get coaching context for GPT
   */
  getCoachingContext() {
    const context = {
      isReturningPlayer: this.profile.totalSessions > 0,
      sessionsPlayed: this.profile.totalSessions,
      skillLevel: this.profile.currentSkillLevel,
      currentGoal: this.profile.currentGoal,

      // Last session reference
      lastSession: this.profile.recentSessions[0] || null,

      // Key weaknesses to watch
      primaryWeaknesses: this.getPrimaryWeaknesses(),

      // Areas showing improvement
      improvingAreas: this.getImprovingAreas(),

      // Strongest stroke
      strongestStroke: this.getStrongestStroke(),

      // Weakest stroke
      weakestStroke: this.getWeakestStroke(),

      // Time since last session
      daysSinceLastSession: this.getDaysSinceLastSession(),

      // Coaching style preferences
      preferences: this.profile.coachingPreferences
    };

    return context;
  }

  /**
   * Get primary weaknesses (top 2)
   */
  getPrimaryWeaknesses() {
    const weaknesses = Object.entries(this.profile.weaknesses)
      .filter(([_, w]) => w.count > 0 && w.severity > 0)
      .sort((a, b) => b[1].severity - a[1].severity)
      .slice(0, 2)
      .map(([name, data]) => ({
        name,
        severity: data.severity,
        improving: data.improving
      }));

    return weaknesses;
  }

  /**
   * Get strongest stroke type
   */
  getStrongestStroke() {
    let strongest = null;
    let highestScore = 0;

    for (const [type, prof] of Object.entries(this.profile.strokeProficiency)) {
      if (prof.attempts >= 10 && prof.avgScore > highestScore) {
        highestScore = prof.avgScore;
        strongest = { type, avgScore: prof.avgScore, attempts: prof.attempts };
      }
    }

    return strongest;
  }

  /**
   * Get weakest stroke type
   */
  getWeakestStroke() {
    let weakest = null;
    let lowestScore = 100;

    for (const [type, prof] of Object.entries(this.profile.strokeProficiency)) {
      if (prof.attempts >= 10 && prof.avgScore < lowestScore) {
        lowestScore = prof.avgScore;
        weakest = { type, avgScore: prof.avgScore, attempts: prof.attempts };
      }
    }

    return weakest;
  }

  /**
   * Get days since last session
   */
  getDaysSinceLastSession() {
    if (!this.profile.lastSessionAt) return null;
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((Date.now() - this.profile.lastSessionAt) / msPerDay);
  }

  /**
   * Generate welcome message based on player history
   */
  generateWelcomeMessage() {
    const ctx = this.getCoachingContext();

    if (!ctx.isReturningPlayer) {
      return "Welcome! I'm your AI tennis coach. Let's start with some strokes so I can analyze your technique.";
    }

    const daysSince = ctx.daysSinceLastSession;
    let message = "";

    if (daysSince === 0) {
      message = "Back for another session today! Great dedication.";
    } else if (daysSince === 1) {
      message = "Welcome back! Good to see you practicing again.";
    } else if (daysSince && daysSince < 7) {
      message = `Good to see you back after ${daysSince} days.`;
    } else if (daysSince && daysSince >= 7) {
      message = `Welcome back! It's been ${daysSince} days. Let's shake off any rust.`;
    } else {
      message = "Welcome back!";
    }

    // Add goal context
    if (ctx.currentGoal) {
      message += ` Today's focus: ${ctx.currentGoal.description}.`;
    } else if (ctx.primaryWeaknesses.length > 0) {
      const weakness = ctx.primaryWeaknesses[0];
      message += ` Let's work on your ${weakness.name.toLowerCase()}.`;
    }

    // Celebrate improvements
    if (ctx.improvingAreas.length > 0) {
      message += ` Your ${ctx.improvingAreas[0].toLowerCase()} has been improving - keep it up!`;
    }

    return message;
  }

  /**
   * Generate session reference for GPT
   */
  generateSessionReference() {
    const lastSession = this.profile.recentSessions[0];
    if (!lastSession) return null;

    const daysSince = this.getDaysSinceLastSession();
    let timeRef = "";
    if (daysSince === 0) timeRef = "earlier today";
    else if (daysSince === 1) timeRef = "yesterday";
    else if (daysSince && daysSince < 7) timeRef = `${daysSince} days ago`;
    else if (daysSince) timeRef = "last week";
    else timeRef = "last session";

    return {
      timeRef,
      avgScore: lastSession.avgScore,
      weaknesses: lastSession.weaknesses,
      improvement: lastSession.improvement
    };
  }

  /**
   * Check and record milestone achievements
   */
  checkMilestones(sessionSummary) {
    const milestones = [];

    // First session
    if (this.profile.totalSessions === 1) {
      milestones.push({ type: 'first_session', date: Date.now(), label: 'First Session Complete' });
    }

    // Session milestones
    if (this.profile.totalSessions === 10) {
      milestones.push({ type: 'sessions_10', date: Date.now(), label: '10 Sessions' });
    }
    if (this.profile.totalSessions === 25) {
      milestones.push({ type: 'sessions_25', date: Date.now(), label: '25 Sessions' });
    }
    if (this.profile.totalSessions === 50) {
      milestones.push({ type: 'sessions_50', date: Date.now(), label: '50 Sessions' });
    }

    // Stroke milestones
    if (this.profile.totalStrokes >= 100 && !this.hasMilestone('strokes_100')) {
      milestones.push({ type: 'strokes_100', date: Date.now(), label: '100 Strokes' });
    }
    if (this.profile.totalStrokes >= 500 && !this.hasMilestone('strokes_500')) {
      milestones.push({ type: 'strokes_500', date: Date.now(), label: '500 Strokes' });
    }
    if (this.profile.totalStrokes >= 1000 && !this.hasMilestone('strokes_1000')) {
      milestones.push({ type: 'strokes_1000', date: Date.now(), label: '1000 Strokes' });
    }

    // High score milestone
    if (sessionSummary.bestScore >= 90 && !this.hasMilestone('score_90')) {
      milestones.push({ type: 'score_90', date: Date.now(), label: 'First 90+ Score' });
    }
    if (sessionSummary.bestScore >= 95 && !this.hasMilestone('score_95')) {
      milestones.push({ type: 'score_95', date: Date.now(), label: 'First 95+ Score' });
    }

    // Consistency milestone
    if (sessionSummary.consistency === 'Excellent' && !this.hasMilestone('excellent_consistency')) {
      milestones.push({ type: 'excellent_consistency', date: Date.now(), label: 'Excellent Consistency' });
    }

    // Skill level milestones
    if (sessionSummary.skillLevel === 'advanced' && !this.hasMilestone('level_advanced')) {
      milestones.push({ type: 'level_advanced', date: Date.now(), label: 'Advanced Level' });
    }
    if (sessionSummary.skillLevel === 'elite' && !this.hasMilestone('level_elite')) {
      milestones.push({ type: 'level_elite', date: Date.now(), label: 'Elite Level' });
    }

    // Add new milestones
    this.profile.milestones.push(...milestones);

    return milestones;
  }

  /**
   * Check if milestone already achieved
   */
  hasMilestone(type) {
    return this.profile.milestones.some(m => m.type === type);
  }

  /**
   * Record fatigue pattern
   */
  async recordFatiguePoint(minutesIntoSession) {
    if (!this.profile.fatiguePatterns.avgDeclinePoint) {
      this.profile.fatiguePatterns.avgDeclinePoint = minutesIntoSession;
    } else {
      // Running average
      this.profile.fatiguePatterns.avgDeclinePoint =
        (this.profile.fatiguePatterns.avgDeclinePoint + minutesIntoSession) / 2;
    }
    await this.saveProfile();
  }

  /**
   * Get player stats for display
   */
  getPlayerStats() {
    return {
      totalSessions: this.profile.totalSessions,
      totalStrokes: this.profile.totalStrokes,
      totalPracticeTime: this.profile.totalPracticeTime,
      currentSkillLevel: this.profile.currentSkillLevel,
      milestones: this.profile.milestones,
      strokeProficiency: this.profile.strokeProficiency,
      weaknesses: Object.entries(this.profile.weaknesses)
        .filter(([_, w]) => w.count > 0)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.severity - a.severity),
      recentSessions: this.profile.recentSessions
    };
  }

  /**
   * Clear all profile data
   */
  async clearProfile() {
    this.profile = this.getDefaultProfile();
    await this.saveProfile();
  }
}

// Global instance
const playerProfile = new PlayerProfile();
