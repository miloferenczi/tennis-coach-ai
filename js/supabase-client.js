/**
 * SupabaseClient — Wraps Supabase JS SDK for ACE AI Tennis Coach
 *
 * Handles auth (email magic link), CRUD for all data types,
 * and API key proxying via Edge Functions.
 *
 * Single global instance: supabaseClient
 */
class ACESupabaseClient {
  constructor() {
    this.client = null;
    this.user = null;
    this.authListeners = [];

    // In-memory caches with TTL
    this._cache = {
      profile: { data: null, ts: 0 },
      tracker: { data: null, ts: 0 },
      curriculum: { data: null, ts: 0 },
      notebook: { data: null, ts: 0 },
      geminiKey: { data: null, ts: 0 }
    };
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Stroke batch buffer
    this._strokeBuffer = [];
    this._batchWriteTimer = null;
    this.BATCH_SIZE = 5;
    this.BATCH_INTERVAL = 10000; // 10 seconds
    this._currentSessionId = null;

    // Edge Function base URL (set during initialize)
    this._functionsUrl = null;
  }

  // ================================================================
  // Initialization & Auth
  // ================================================================

  /**
   * Initialize the Supabase client and set up auth state handling.
   * @param {string} url - Supabase project URL
   * @param {string} anonKey - Supabase anon/public key
   */
  initialize(url, anonKey) {
    if (!url || !anonKey) {
      console.error('SupabaseClient: missing URL or anon key');
      return;
    }

    this._functionsUrl = `${url}/functions/v1`;

    // supabase-js is loaded via CDN <script> tag
    this.client = supabase.createClient(url, anonKey);

    // Listen for auth state changes
    this.client.auth.onAuthStateChange((event, session) => {
      const previousUser = this.user;
      this.user = session?.user || null;

      console.log(`SupabaseClient: auth ${event}`, this.user?.id);

      // Notify listeners
      for (const cb of this.authListeners) {
        try {
          cb(event, session, this.user);
        } catch (e) {
          console.error('SupabaseClient: auth listener error', e);
        }
      }
    });
  }

  /**
   * Check for existing session on page load.
   * @returns {Object|null} user object or null
   */
  async getExistingSession() {
    if (!this.client) return null;

    const { data: { session } } = await this.client.auth.getSession();
    this.user = session?.user || null;
    return this.user;
  }

  /**
   * Sign in with email magic link (OTP).
   * @param {string} email
   * @returns {{ error: string|null }}
   */
  async signInWithMagicLink(email) {
    if (!this.client) return { error: 'Client not initialized' };

    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    });

    if (error) {
      console.error('SupabaseClient: magic link error', error);
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * Sign in an existing user with email magic link (no account creation).
   * Use on the login screen to prevent accidental account creation.
   * @param {string} email
   * @returns {{ error: string|null }}
   */
  async signInExistingUser(email) {
    if (!this.client) return { error: 'Client not initialized' };

    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    });

    if (error) {
      console.error('SupabaseClient: signInExistingUser error', error);
      // Supabase returns "Signups not allowed for otp" when user doesn't exist
      if (error.message?.includes('Signups not allowed') || error.message?.includes('not allowed')) {
        return { error: 'No account found with that email. Try signing up instead.' };
      }
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * Sign out and clear caches.
   */
  async signOut() {
    if (!this.client) return;

    this.stopBatchTimer();
    await this.flushStrokes();
    await this.client.auth.signOut();
    this.user = null;
    this.clearCaches();
  }

  /**
   * Register an auth state change listener.
   * @param {Function} callback - (event, session, user) => void
   */
  onAuthChange(callback) {
    this.authListeners.push(callback);
  }

  /**
   * Check if user is authenticated.
   */
  isAuthenticated() {
    return !!this.user;
  }

  /**
   * Get current user.
   */
  getUser() {
    return this.user;
  }

  // ================================================================
  // Profile CRUD
  // ================================================================

  /**
   * Load user profile from Supabase. Uses 5-min cache.
   * @returns {Object} profile data in camelCase
   */
  async loadProfile() {
    if (!this.user) return null;

    // Check cache
    const cached = this._cache.profile;
    if (cached.data && (Date.now() - cached.ts) < this.CACHE_TTL) {
      return cached.data;
    }

    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', this.user.id)
      .single();

    if (error) {
      console.error('SupabaseClient: loadProfile error', error);
      return null;
    }

    const profile = this._profileFromDb(data);
    this._cache.profile = { data: profile, ts: Date.now() };
    return profile;
  }

  /**
   * Update user profile.
   * @param {Object} updates - camelCase fields to update
   */
  async updateProfile(updates) {
    if (!this.user) return;

    const dbUpdates = this._profileToDb(updates);

    const { error } = await this.client
      .from('profiles')
      .update(dbUpdates)
      .eq('id', this.user.id);

    if (error) {
      console.error('SupabaseClient: updateProfile error', error);
      return;
    }

    // Update cache
    if (this._cache.profile.data) {
      Object.assign(this._cache.profile.data, updates);
      this._cache.profile.ts = Date.now();
    }
  }

  /**
   * Transform DB row (snake_case) → JS object (camelCase).
   */
  _profileFromDb(row) {
    return {
      id: row.id,
      skillLevel: row.skill_level,
      totalSessions: row.total_sessions,
      totalStrokes: row.total_strokes,
      totalPracticeTime: row.total_practice_time_ms,
      strongestStroke: row.strongest_stroke,
      weaknesses: row.weaknesses || [],
      strengths: row.strengths || [],
      strokeProficiency: row.stroke_proficiency || {},
      recentSessions: row.recent_sessions || [],
      skillProgress: row.skill_progress || [],
      currentGoal: row.current_goal,
      coachingPreferences: row.coaching_preferences || {},
      fatiguePatterns: row.fatigue_patterns || {},
      milestones: row.milestones || [],
      // Onboarding & subscription fields
      sport: row.sport || 'tennis',
      ntrpLevel: row.ntrp_level || null,
      improvementGoals: row.improvement_goals || [],
      customGoalText: row.custom_goal_text || null,
      coachPreference: row.coach_preference || 'alex',
      displayName: row.display_name || null,
      age: row.age || null,
      subscriptionTier: row.subscription_tier || 'free',
      trialStartDate: row.trial_start_date || null,
      trialUsed: row.trial_used || false,
      onboardingCompleted: row.onboarding_completed || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Transform JS object (camelCase) → DB columns (snake_case).
   * Only includes keys that are present in the input.
   */
  _profileToDb(obj) {
    const map = {
      skillLevel: 'skill_level',
      totalSessions: 'total_sessions',
      totalStrokes: 'total_strokes',
      totalPracticeTime: 'total_practice_time_ms',
      strongestStroke: 'strongest_stroke',
      weaknesses: 'weaknesses',
      strengths: 'strengths',
      strokeProficiency: 'stroke_proficiency',
      recentSessions: 'recent_sessions',
      skillProgress: 'skill_progress',
      currentGoal: 'current_goal',
      coachingPreferences: 'coaching_preferences',
      fatiguePatterns: 'fatigue_patterns',
      milestones: 'milestones',
      // Onboarding & subscription fields
      sport: 'sport',
      ntrpLevel: 'ntrp_level',
      improvementGoals: 'improvement_goals',
      customGoalText: 'custom_goal_text',
      coachPreference: 'coach_preference',
      displayName: 'display_name',
      age: 'age',
      subscriptionTier: 'subscription_tier',
      trialStartDate: 'trial_start_date',
      trialUsed: 'trial_used',
      onboardingCompleted: 'onboarding_completed'
    };

    const result = {};
    for (const [jsKey, dbKey] of Object.entries(map)) {
      if (jsKey in obj) {
        result[dbKey] = obj[jsKey];
      }
    }
    return result;
  }

  // ================================================================
  // Session CRUD
  // ================================================================

  /**
   * Create a new session in Supabase.
   * @returns {string} session UUID
   */
  async createSession(startTime) {
    if (!this.user) return null;

    const { data, error } = await this.client
      .from('sessions')
      .insert({
        user_id: this.user.id,
        start_time: new Date(startTime || Date.now()).toISOString()
      })
      .select('id')
      .single();

    if (error) {
      console.error('SupabaseClient: createSession error', error);
      return null;
    }

    this._currentSessionId = data.id;
    this.startBatchTimer();
    return data.id;
  }

  /**
   * Update session with end time and summary.
   */
  async updateSession(sessionId, { endTime, summary }) {
    if (!this.user || !sessionId) return;

    const updates = {};
    if (endTime) updates.end_time = new Date(endTime).toISOString();
    if (summary) updates.summary = summary;

    const { error } = await this.client
      .from('sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('user_id', this.user.id);

    if (error) {
      console.error('SupabaseClient: updateSession error', error);
    }
  }

  /**
   * Get session history (summaries only).
   * @param {number} limit - max sessions to return
   */
  async getSessionHistory(limit = 50) {
    if (!this.user) return [];

    const { data, error } = await this.client
      .from('sessions')
      .select('id, start_time, end_time, summary')
      .eq('user_id', this.user.id)
      .order('start_time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('SupabaseClient: getSessionHistory error', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      date: new Date(row.start_time).getTime(),
      summary: row.summary
    }));
  }

  // ================================================================
  // Stroke Batch Writing
  // ================================================================

  /**
   * Buffer a stroke for batch writing.
   * Flushes when buffer reaches BATCH_SIZE.
   */
  bufferStroke(strokeRecord) {
    if (!this.user || !this._currentSessionId) return;

    this._strokeBuffer.push({
      session_id: this._currentSessionId,
      user_id: this.user.id,
      timestamp: new Date(strokeRecord.timestamp || Date.now()).toISOString(),
      stroke_type: strokeRecord.type,
      quality: strokeRecord.quality,
      quality_breakdown: strokeRecord.qualityBreakdown || null,
      technique: strokeRecord.technique || null,
      physics: strokeRecord.physics || null,
      pro_comparison: strokeRecord.proComparison || null,
      biomechanical: strokeRecord.biomechanical || null,
      rally_context: strokeRecord.rallyContext || null
    });

    if (this._strokeBuffer.length >= this.BATCH_SIZE) {
      this.flushStrokes();
    }
  }

  /**
   * Flush buffered strokes to Supabase.
   */
  async flushStrokes() {
    if (this._strokeBuffer.length === 0) return;

    const batch = this._strokeBuffer.splice(0);

    const { error } = await this.client
      .from('strokes')
      .insert(batch);

    if (error) {
      console.error('SupabaseClient: flushStrokes error', error);
      // Put failed strokes back at the front of the buffer
      this._strokeBuffer.unshift(...batch);
    }
  }

  /**
   * Start the batch write timer.
   */
  startBatchTimer() {
    this.stopBatchTimer();
    this._batchWriteTimer = setInterval(() => {
      this.flushStrokes();
    }, this.BATCH_INTERVAL);
  }

  /**
   * Stop the batch write timer.
   */
  stopBatchTimer() {
    if (this._batchWriteTimer) {
      clearInterval(this._batchWriteTimer);
      this._batchWriteTimer = null;
    }
  }

  // ================================================================
  // Improvement Tracker CRUD
  // ================================================================

  /**
   * Load improvement tracker data. Auto-creates row if missing.
   * @returns {Object} { strokeMetrics, faultHistory, coachingPlan }
   */
  async loadImprovementTracker() {
    if (!this.user) return null;

    const cached = this._cache.tracker;
    if (cached.data && (Date.now() - cached.ts) < this.CACHE_TTL) {
      return cached.data;
    }

    let { data, error } = await this.client
      .from('improvement_tracker')
      .select('*')
      .eq('user_id', this.user.id)
      .single();

    // Auto-create if not exists
    if (error && error.code === 'PGRST116') {
      const { data: newData, error: insertError } = await this.client
        .from('improvement_tracker')
        .insert({ user_id: this.user.id })
        .select('*')
        .single();

      if (insertError) {
        console.error('SupabaseClient: create tracker error', insertError);
        return null;
      }
      data = newData;
    } else if (error) {
      console.error('SupabaseClient: loadImprovementTracker error', error);
      return null;
    }

    const result = {
      strokeMetrics: data.stroke_metrics || {},
      faultHistory: data.fault_history || {},
      coachingPlan: data.coaching_plan || null
    };

    this._cache.tracker = { data: result, ts: Date.now() };
    return result;
  }

  /**
   * Update improvement tracker data.
   * @param {Object} updates - { strokeMetrics, faultHistory, coachingPlan }
   */
  async updateImprovementTracker(updates) {
    if (!this.user) return;

    const dbUpdates = {};
    if ('strokeMetrics' in updates) dbUpdates.stroke_metrics = updates.strokeMetrics;
    if ('faultHistory' in updates) dbUpdates.fault_history = updates.faultHistory;
    if ('coachingPlan' in updates) dbUpdates.coaching_plan = updates.coachingPlan;

    const { error } = await this.client
      .from('improvement_tracker')
      .update(dbUpdates)
      .eq('user_id', this.user.id);

    if (error) {
      console.error('SupabaseClient: updateImprovementTracker error', error);
      return;
    }

    // Update cache
    if (this._cache.tracker.data) {
      Object.assign(this._cache.tracker.data, updates);
      this._cache.tracker.ts = Date.now();
    }
  }

  // ================================================================
  // Coach Notebook CRUD
  // ================================================================

  /**
   * Get coach notebook entries (last 20).
   * @returns {Array} entries sorted by date DESC
   */
  async getCoachNotebookEntries() {
    if (!this.user) return [];

    const cached = this._cache.notebook;
    if (cached.data && (Date.now() - cached.ts) < this.CACHE_TTL) {
      return cached.data;
    }

    const { data, error } = await this.client
      .from('coach_notebook')
      .select('*')
      .eq('user_id', this.user.id)
      .order('date', { ascending: false })
      .limit(20);

    if (error) {
      console.error('SupabaseClient: getCoachNotebookEntries error', error);
      return [];
    }

    // Transform to match existing CoachNotebook format: entries sorted oldest-first
    const entries = (data || []).reverse().map(row => ({
      date: row.date ? new Date(row.date).getTime() : Date.now(),
      coachNotes: row.coach_notes,
      summary: row.summary
    }));

    this._cache.notebook = { data: entries, ts: Date.now() };
    return entries;
  }

  /**
   * Add a coach notebook entry.
   * @param {Object} entry - { date, coachNotes, summary }
   */
  async addCoachNotebookEntry(entry) {
    if (!this.user) return;

    const { error } = await this.client
      .from('coach_notebook')
      .insert({
        user_id: this.user.id,
        date: entry.date ? new Date(entry.date).toISOString() : new Date().toISOString(),
        coach_notes: entry.coachNotes,
        summary: entry.summary || null
      });

    if (error) {
      console.error('SupabaseClient: addCoachNotebookEntry error', error);
      return;
    }

    // Invalidate cache
    this._cache.notebook = { data: null, ts: 0 };
  }

  // ================================================================
  // Curriculum CRUD
  // ================================================================

  /**
   * Load the active curriculum.
   * @returns {Object|null} curriculum data
   */
  async loadActiveCurriculum() {
    if (!this.user) return null;

    const cached = this._cache.curriculum;
    if (cached.data && (Date.now() - cached.ts) < this.CACHE_TTL) {
      return cached.data;
    }

    const { data, error } = await this.client
      .from('curriculum')
      .select('*')
      .eq('user_id', this.user.id)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('SupabaseClient: loadActiveCurriculum error', error);
      return null;
    }

    if (!data) {
      this._cache.curriculum = { data: null, ts: Date.now() };
      return null;
    }

    const curriculum = {
      id: data.id,
      startDate: new Date(data.start_date).getTime(),
      skillLevel: data.skill_level,
      weeks: data.weeks || [],
      primaryFocus: data.primary_focus,
      sessionsCompleted: data.sessions_completed,
      lastSessionDate: data.last_session_date ? new Date(data.last_session_date).getTime() : null
    };

    this._cache.curriculum = { data: curriculum, ts: Date.now() };
    return curriculum;
  }

  /**
   * Create a new curriculum, deactivating any existing one.
   * @param {Object} curriculumData
   * @returns {Object} created curriculum with id
   */
  async createCurriculum(curriculumData) {
    if (!this.user) return null;

    // Deactivate existing active curriculum
    await this.client
      .from('curriculum')
      .update({ is_active: false })
      .eq('user_id', this.user.id)
      .eq('is_active', true);

    const { data, error } = await this.client
      .from('curriculum')
      .insert({
        user_id: this.user.id,
        start_date: new Date(curriculumData.startDate || Date.now()).toISOString(),
        skill_level: curriculumData.skillLevel || 'intermediate',
        weeks: curriculumData.weeks || [],
        primary_focus: curriculumData.primaryFocus,
        sessions_completed: 0,
        is_active: true
      })
      .select('id')
      .single();

    if (error) {
      console.error('SupabaseClient: createCurriculum error', error);
      return null;
    }

    // Invalidate cache
    this._cache.curriculum = { data: null, ts: 0 };

    return { ...curriculumData, id: data.id };
  }

  /**
   * Update the active curriculum.
   * @param {Object} updates - { sessionsCompleted, lastSessionDate }
   */
  async updateCurriculum(updates) {
    if (!this.user) return;

    const dbUpdates = {};
    if ('sessionsCompleted' in updates) dbUpdates.sessions_completed = updates.sessionsCompleted;
    if ('lastSessionDate' in updates) dbUpdates.last_session_date = updates.lastSessionDate ?
      new Date(updates.lastSessionDate).toISOString() : null;

    const { error } = await this.client
      .from('curriculum')
      .update(dbUpdates)
      .eq('user_id', this.user.id)
      .eq('is_active', true);

    if (error) {
      console.error('SupabaseClient: updateCurriculum error', error);
      return;
    }

    // Update cache
    if (this._cache.curriculum.data) {
      Object.assign(this._cache.curriculum.data, updates);
      this._cache.curriculum.ts = Date.now();
    }
  }

  // ================================================================
  // API Proxy (Edge Functions)
  // ================================================================

  /**
   * Get an OpenAI Realtime ephemeral token via Edge Function.
   * @param {string} instructions - GPT coaching instructions
   * @param {string} voice - voice ID (default: alloy)
   * @returns {{ ephemeralKey: string, expiresAt: number }|null}
   */
  async getRealtimeToken(instructions, voice = 'alloy') {
    if (!this.user || !this._functionsUrl) return null;

    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return null;

    try {
      const response = await fetch(`${this._functionsUrl}/get-realtime-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'apikey': this.client.supabaseKey
        },
        body: JSON.stringify({ instructions, voice })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('SupabaseClient: getRealtimeToken error', errData);
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error('SupabaseClient: getRealtimeToken fetch error', e);
      return null;
    }
  }

  /**
   * Get Gemini API key via Edge Function.
   * Cached for the session duration (CACHE_TTL).
   * @returns {string|null} API key
   */
  async getGeminiKey() {
    if (!this.user || !this._functionsUrl) return null;

    const cached = this._cache.geminiKey;
    if (cached.data && (Date.now() - cached.ts) < this.CACHE_TTL) {
      return cached.data;
    }

    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return null;

    try {
      const response = await fetch(`${this._functionsUrl}/get-gemini-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'apikey': this.client.supabaseKey
        }
      });

      if (!response.ok) {
        console.error('SupabaseClient: getGeminiKey error', response.status);
        return null;
      }

      const { apiKey } = await response.json();
      this._cache.geminiKey = { data: apiKey, ts: Date.now() };
      return apiKey;
    } catch (e) {
      console.error('SupabaseClient: getGeminiKey fetch error', e);
      return null;
    }
  }

  // ================================================================
  // Guest Trial Token (unauthenticated)
  // ================================================================

  /**
   * Get an OpenAI Realtime ephemeral token for guest trial (no auth required).
   * @param {string} instructions - GPT coaching instructions
   * @param {string} voice - voice ID
   * @returns {{ ephemeralKey: string, expiresAt: number, trialId: string }|null}
   */
  async getGuestToken(instructions, voice = 'alloy') {
    if (!this._functionsUrl) return null;

    try {
      const response = await fetch(`${this._functionsUrl}/get-guest-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.client?.supabaseKey || ''
        },
        body: JSON.stringify({ instructions, voice })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('SupabaseClient: getGuestToken error', response.status, errData);
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error('SupabaseClient: getGuestToken fetch error', e);
      return null;
    }
  }

  // ================================================================
  // Subscription Helpers
  // ================================================================

  /**
   * Get subscription status from cached profile.
   * @returns {{ tier: string, isActive: boolean, strokeLimit: number|null, observationLimit: number|null, sessionLimitPerMonth: number|null }}
   */
  getSubscriptionStatus() {
    const profile = this._cache.profile?.data;
    const tier = profile?.subscriptionTier || 'free';

    if (tier === 'pro') {
      return { tier: 'pro', isActive: true, strokeLimit: null, observationLimit: null, sessionLimitPerMonth: null };
    }

    if (tier === 'trial') {
      const trialStart = profile?.trialStartDate ? new Date(profile.trialStartDate) : null;
      const isActive = trialStart && (Date.now() - trialStart.getTime()) < 7 * 24 * 60 * 60 * 1000;
      if (isActive) {
        return { tier: 'trial', isActive: true, strokeLimit: null, observationLimit: null, sessionLimitPerMonth: null };
      }
      // Trial expired — falls back to free
    }

    // Free tier limits
    return { tier: 'free', isActive: true, strokeLimit: 10, observationLimit: 2, sessionLimitPerMonth: 1 };
  }

  // ================================================================
  // localStorage Migration
  // ================================================================

  /**
   * Check if there's old localStorage data to migrate.
   * @returns {boolean}
   */
  hasLocalStorageData() {
    return !!(
      localStorage.getItem('techniqueai_player_profile') ||
      localStorage.getItem('ace_improvement_tracker') ||
      localStorage.getItem('ace_coach_notebook') ||
      localStorage.getItem('ace_curriculum') ||
      localStorage.getItem('techniqueai_sessions')
    );
  }

  /**
   * Migrate localStorage data to Supabase.
   * Call after first sign-in when hasLocalStorageData() returns true.
   * @param {Function} onProgress - optional callback(step, total, message)
   */
  async migrateFromLocalStorage(onProgress) {
    if (!this.user) return;

    const steps = 5;
    let step = 0;

    const report = (msg) => {
      step++;
      console.log(`Migration ${step}/${steps}: ${msg}`);
      if (onProgress) onProgress(step, steps, msg);
    };

    try {
      // 1. Player profile
      report('Migrating player profile...');
      const profileRaw = localStorage.getItem('techniqueai_player_profile');
      if (profileRaw) {
        const profile = JSON.parse(profileRaw);
        await this.updateProfile({
          skillLevel: profile.currentSkillLevel || 'beginner',
          totalSessions: profile.totalSessions || 0,
          totalStrokes: profile.totalStrokes || 0,
          totalPracticeTime: profile.totalPracticeTime || 0,
          weaknesses: profile.weaknesses || {},
          strengths: profile.strengths || {},
          strokeProficiency: profile.strokeProficiency || {},
          recentSessions: profile.recentSessions || [],
          skillProgress: profile.skillProgress || [],
          currentGoal: profile.currentGoal || null,
          coachingPreferences: profile.coachingPreferences || {},
          fatiguePatterns: profile.fatiguePatterns || {},
          milestones: profile.milestones || []
        });
      }

      // 2. Improvement tracker
      report('Migrating improvement tracker...');
      const trackerRaw = localStorage.getItem('ace_improvement_tracker');
      if (trackerRaw) {
        const tracker = JSON.parse(trackerRaw);
        // Ensure the row exists first
        await this.loadImprovementTracker();
        await this.updateImprovementTracker({
          strokeMetrics: tracker.strokeMetrics || {},
          faultHistory: tracker.faultHistory || {},
          coachingPlan: tracker.coachingPlan || null
        });
      }

      // 3. Coach notebook
      report('Migrating coach notebook...');
      const notebookRaw = localStorage.getItem('ace_coach_notebook');
      if (notebookRaw) {
        const entries = JSON.parse(notebookRaw);
        // Insert entries one by one (they're small and few)
        for (const entry of entries) {
          await this.addCoachNotebookEntry(entry);
        }
      }

      // 4. Curriculum
      report('Migrating curriculum...');
      const curriculumRaw = localStorage.getItem('ace_curriculum');
      if (curriculumRaw) {
        const curriculum = JSON.parse(curriculumRaw);
        if (curriculum) {
          await this.createCurriculum(curriculum);
        }
      }

      // 5. Session history (summaries only, skip individual strokes)
      report('Migrating session history...');
      const sessionsRaw = localStorage.getItem('techniqueai_sessions');
      if (sessionsRaw) {
        const sessions = JSON.parse(sessionsRaw);
        for (const session of sessions.slice(0, 20)) { // Cap at 20
          const { data } = await this.client
            .from('sessions')
            .insert({
              user_id: this.user.id,
              start_time: new Date(session.date || Date.now()).toISOString(),
              summary: session.summary || {}
            })
            .select('id')
            .single();
          // Skip stroke migration — too large, summaries are sufficient
        }
      }

      // Create backup and clear old keys
      const backup = {};
      const keysToBackup = [
        'techniqueai_player_profile', 'ace_improvement_tracker',
        'ace_coach_notebook', 'ace_curriculum', 'techniqueai_sessions',
        'techniqueai_current_session', 'ace_openai_key', 'ace_gemini_key'
      ];
      for (const key of keysToBackup) {
        const val = localStorage.getItem(key);
        if (val) backup[key] = val;
      }
      localStorage.setItem('ace_migration_backup', JSON.stringify(backup));

      // Clear old keys
      for (const key of keysToBackup) {
        localStorage.removeItem(key);
      }

      console.log('Migration complete — backup stored in ace_migration_backup');
    } catch (e) {
      console.error('Migration error:', e);
    }
  }

  // ================================================================
  // Utilities
  // ================================================================

  /**
   * Clear all in-memory caches.
   */
  clearCaches() {
    for (const key of Object.keys(this._cache)) {
      this._cache[key] = { data: null, ts: 0 };
    }
    this._strokeBuffer = [];
    this._currentSessionId = null;
  }
}

// Global instance
const supabaseClient = new ACESupabaseClient();
