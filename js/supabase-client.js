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
   * Sign up with email + password.
   * @param {string} email
   * @param {string} password
   * @returns {{ error: string|null, needsConfirmation: boolean }}
   */
  async signUpWithPassword(email, password) {
    if (!this.client) return { error: 'Client not initialized', needsConfirmation: false };

    const { data, error } = await this.client.auth.signUp({ email, password });

    if (error) {
      console.error('SupabaseClient: signUpWithPassword error', error);
      if (error.message?.includes('already registered') || error.message?.includes('already been registered')) {
        return { error: 'An account with this email already exists. Try logging in instead.', needsConfirmation: false };
      }
      return { error: error.message, needsConfirmation: false };
    }

    // If email confirmation is enabled, user won't have a session yet
    if (data?.user && !data.session) {
      return { error: null, needsConfirmation: true };
    }

    return { error: null, needsConfirmation: false };
  }

  /**
   * Sign in with email + password.
   * @param {string} email
   * @param {string} password
   * @returns {{ error: string|null }}
   */
  async signInWithPassword(email, password) {
    if (!this.client) return { error: 'Client not initialized' };

    const { error } = await this.client.auth.signInWithPassword({ email, password });

    if (error) {
      console.error('SupabaseClient: signInWithPassword error', error);
      if (error.message?.includes('Invalid login credentials')) {
        return { error: 'Incorrect email or password.' };
      }
      if (error.message?.includes('Email not confirmed')) {
        return { error: 'Please check your email to confirm your account first.' };
      }
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * Send a password reset email.
   * @param {string} email
   * @returns {{ error: string|null }}
   */
  async resetPassword(email) {
    if (!this.client) return { error: 'Client not initialized' };

    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) {
      console.error('SupabaseClient: resetPassword error', error);
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * Update user's password (after reset link clicked).
   * @param {string} newPassword
   * @returns {{ error: string|null }}
   */
  async updatePassword(newPassword) {
    if (!this.client) return { error: 'Client not initialized' };

    const { error } = await this.client.auth.updateUser({ password: newPassword });

    if (error) {
      console.error('SupabaseClient: updatePassword error', error);
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
   * Clear the profile cache so the next loadProfile() fetches fresh data.
   */
  clearProfileCache() {
    this._cache.profile = { data: null, ts: 0 };
  }

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
      // subscriptionTier and trialStartDate are NOT writable from the client.
      // They must be managed server-side or via admin/service role.
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
      coachingPlan: data.coaching_plan || null,
      adaptiveThresholds: data.adaptive_thresholds || {}
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
    if ('adaptiveThresholds' in updates) dbUpdates.adaptive_thresholds = updates.adaptiveThresholds;

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
   * Get a valid (non-expired) access token, refreshing if needed.
   * getSession() returns the cached session without network calls —
   * if the token has expired before the background refresh fires,
   * the Edge Function gateway rejects it with 401.
   */
  async _getValidAccessToken() {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return null;

    // expires_at is a Unix timestamp in seconds
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && (session.expires_at - now) < 60) {
      console.log('SupabaseClient: proactively refreshing token (expires in <60s)');
      const { data: { session: fresh } } = await this.client.auth.refreshSession();
      return fresh?.access_token || null;
    }

    return session.access_token;
  }

  /**
   * Get an OpenAI Realtime ephemeral token via Edge Function.
   * @param {string} instructions - GPT coaching instructions
   * @param {string} voice - voice ID (default: alloy)
   * @returns {{ ephemeralKey: string, expiresAt: number }|null}
   */
  async getRealtimeToken(instructions, voice = 'alloy') {
    if (!this.user || !this._functionsUrl) {
      console.warn(`SupabaseClient: getRealtimeToken skipped — user: ${!!this.user}, functionsUrl: ${!!this._functionsUrl}`);
      return null;
    }

    let accessToken = await this._getValidAccessToken();
    if (!accessToken) {
      console.warn('SupabaseClient: getRealtimeToken — no valid access token available');
      return null;
    }

    // Decode JWT to check expiry (don't log sensitive claims)
    try {
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const expiresIn = payload.exp - Math.floor(Date.now() / 1000);
      console.log(`SupabaseClient: getRealtimeToken — token expires in ${expiresIn}s, sub: ${payload.sub}, iss: ${payload.iss}`);
    } catch (e) {
      console.warn('SupabaseClient: getRealtimeToken — could not decode token', e.message);
    }

    const url = `${this._functionsUrl}/get-realtime-token`;
    const body = JSON.stringify({ instructions, voice });
    console.log(`SupabaseClient: getRealtimeToken — calling ${url}`);

    try {
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': this.client.supabaseKey
        },
        body
      });

      // 401 = token rejected — force refresh and retry once
      if (response.status === 401) {
        const firstErrData = await response.json().catch(() => ({}));
        console.warn('SupabaseClient: getRealtimeToken 401 on first attempt. Server debug:', JSON.stringify(firstErrData));
        console.warn('SupabaseClient: refreshing token and retrying...');
        const { data: { session: fresh }, error: refreshError } = await this.client.auth.refreshSession();
        if (refreshError) {
          console.error('SupabaseClient: token refresh failed:', refreshError.message);
        }
        if (fresh) {
          console.log(`SupabaseClient: getRealtimeToken — retrying with refreshed token (expires in ${fresh.expires_at - Math.floor(Date.now() / 1000)}s)`);
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${fresh.access_token}`,
              'Content-Type': 'application/json',
              'apikey': this.client.supabaseKey
            },
            body
          });
        } else {
          console.error('SupabaseClient: getRealtimeToken — refresh returned no session');
        }
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error(`SupabaseClient: getRealtimeToken FINAL error (${response.status})`, JSON.stringify(errData, null, 2));
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

    const accessToken = await this._getValidAccessToken();
    if (!accessToken) return null;

    try {
      const response = await fetch(`${this._functionsUrl}/get-gemini-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
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
  // Text-only Chat Completions (for plan synthesis, structured JSON)
  // ================================================================

  /**
   * Send a text-only chat completion request via Edge Function.
   * Uses gpt-4o-mini for cost efficiency. No audio I/O.
   * @param {Array} messages - OpenAI chat messages array
   * @param {Object} [options] - { model, max_tokens, temperature }
   * @returns {string|null} The completion text content or null on failure
   */
  async chatCompletion(messages, options = {}) {
    if (!this.user || !this._functionsUrl) return null;

    const accessToken = await this._getValidAccessToken();
    if (!accessToken) return null;

    try {
      const response = await fetch(`${this._functionsUrl}/chat-completion`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': this.client.supabaseKey
        },
        body: JSON.stringify({
          messages,
          model: options.model || 'gpt-4o-mini',
          max_tokens: options.max_tokens || 500,
          temperature: options.temperature ?? 0.3
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('SupabaseClient: chatCompletion error', errData);
        return null;
      }

      const { content } = await response.json();
      return content || null;
    } catch (e) {
      console.error('SupabaseClient: chatCompletion fetch error', e);
      return null;
    }
  }

  /**
   * Call Gemini API via the gemini-proxy Edge Function (no raw key exposure).
   * @param {Object} requestBody - The Gemini API request body (contents, generationConfig, etc.)
   * @param {string} [model] - Gemini model name (default: gemini-2.5-flash)
   * @returns {Object|null} Gemini API response data or null on failure
   */
  async callGeminiProxy(requestBody, model = 'gemini-2.5-flash') {
    if (!this.user || !this._functionsUrl) return null;

    const accessToken = await this._getValidAccessToken();
    if (!accessToken) return null;

    try {
      const response = await fetch(`${this._functionsUrl}/gemini-proxy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': this.client.supabaseKey
        },
        body: JSON.stringify({ ...requestBody, model })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('SupabaseClient: callGeminiProxy error', response.status, errData);
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error('SupabaseClient: callGeminiProxy fetch error', e);
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

  /**
   * Activate free trial for the current user (server-side only).
   * Sets subscription_tier='trial' and trial_start_date=now() via service role.
   * This prevents users from arbitrarily setting their own subscription tier.
   * @returns {{ success: boolean, error?: string }}
   */
  async activateFreeTrial() {
    if (!this.user || !this._functionsUrl) return { success: false, error: 'Not authenticated' };

    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return { success: false, error: 'No session' };

    // Use a direct Supabase RPC or just update the profile since the user can only
    // set trial (not pro). The RLS policy + check constraint prevent escalation.
    // For now, use client update since the DB trigger validates the value.
    const { error } = await this.client
      .from('profiles')
      .update({
        subscription_tier: 'trial',
        trial_start_date: new Date().toISOString()
      })
      .eq('id', this.user.id);

    if (error) {
      console.error('SupabaseClient: activateFreeTrial error', error);
      return { success: false, error: error.message };
    }

    // Update cache
    if (this._cache.profile.data) {
      this._cache.profile.data.subscriptionTier = 'trial';
      this._cache.profile.data.trialStartDate = new Date().toISOString();
      this._cache.profile.ts = Date.now();
    }

    return { success: true };
  }

  // ================================================================
  // Structured Session Memory
  // ================================================================

  /**
   * Save a structured session memory entry.
   * @param {Object} entry - { sessionId, sessionDate, sessionNumber, strokeSummaries, coachingMoments, observations, visualSummary, coachNotesFreetext }
   */
  async saveStructuredSessionMemory(entry) {
    if (!this.user) return;

    const { error } = await this.client
      .from('structured_session_memory')
      .insert({
        user_id: this.user.id,
        session_id: entry.sessionId || null,
        session_date: entry.sessionDate || new Date().toISOString(),
        session_number: entry.sessionNumber || 1,
        stroke_summaries: entry.strokeSummaries || {},
        coaching_moments: entry.coachingMoments || [],
        observations: entry.observations || {},
        visual_summary: entry.visualSummary || null,
        coach_notes_freetext: entry.coachNotesFreetext || null
      });

    if (error) {
      console.error('SupabaseClient: saveStructuredSessionMemory error', error);
    }
  }

  /**
   * Get recent structured session memory entries.
   * @param {number} limit - max entries to return (default 5)
   * @returns {Array} entries sorted oldest-first
   */
  async getRecentStructuredMemory(limit = 5) {
    if (!this.user) return [];

    const { data, error } = await this.client
      .from('structured_session_memory')
      .select('*')
      .eq('user_id', this.user.id)
      .order('session_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('SupabaseClient: getRecentStructuredMemory error', error);
      return [];
    }

    return (data || []).reverse().map(row => ({
      sessionId: row.session_id,
      sessionDate: row.session_date,
      sessionNumber: row.session_number,
      strokeSummaries: row.stroke_summaries || {},
      coachingMoments: row.coaching_moments || [],
      observations: row.observations || {},
      visualSummary: row.visual_summary || null,
      coachNotesFreetext: row.coach_notes_freetext || null
    }));
  }

  // ================================================================
  // Coaching Effectiveness
  // ================================================================

  /**
   * Save a coaching effectiveness record.
   * @param {Object} entry
   */
  async saveCoachingEffectiveness(entry) {
    if (!this.user) return;

    const { error } = await this.client
      .from('coaching_effectiveness')
      .insert({
        user_id: this.user.id,
        session_id: entry.sessionId || null,
        coaching_cue: entry.coachingCue,
        issue_id: entry.issueId,
        stroke_type: entry.strokeType,
        pre_metrics: entry.preMetrics || {},
        post_metrics: entry.postMetrics || {},
        quality_delta: entry.qualityDelta,
        target_metric_delta: entry.targetMetricDelta,
        effective: entry.effective,
        strokes_between: entry.strokesBetween || 0
      });

    if (error) {
      console.error('SupabaseClient: saveCoachingEffectiveness error', error);
    }
  }

  /**
   * Get aggregated coaching effectiveness data.
   * Returns { issueId: { bestCue, lastCue, effective, successRate, totalAttempts, successCount, bestCueDelta } }
   */
  async getCoachingEffectivenessAggregates() {
    if (!this.user) return {};

    const { data, error } = await this.client
      .from('coaching_effectiveness')
      .select('issue_id, coaching_cue, quality_delta, target_metric_delta, effective')
      .eq('user_id', this.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('SupabaseClient: getCoachingEffectivenessAggregates error', error);
      return {};
    }

    // Aggregate in JS
    const aggregates = {};
    for (const row of (data || [])) {
      const id = row.issue_id;
      if (!aggregates[id]) {
        aggregates[id] = {
          totalAttempts: 0,
          successCount: 0,
          bestCue: null,
          bestCueDelta: -Infinity,
          lastCue: null,
          effective: false,
          successRate: 0
        };
      }
      const agg = aggregates[id];
      agg.totalAttempts++;
      if (row.effective) agg.successCount++;
      if (!agg.lastCue) agg.lastCue = row.coaching_cue; // first row is most recent
      if ((row.quality_delta || 0) > (agg.bestCueDelta || -Infinity)) {
        agg.bestCueDelta = row.quality_delta;
        agg.bestCue = row.coaching_cue;
      }
    }

    // Compute derived fields
    for (const agg of Object.values(aggregates)) {
      agg.successRate = agg.totalAttempts > 0
        ? Math.round((agg.successCount / agg.totalAttempts) * 100)
        : 0;
      agg.effective = agg.successRate >= 50;
    }

    return aggregates;
  }

  // ================================================================
  // Micro-Confirmations
  // ================================================================

  /**
   * Save a micro-confirmation (coaching feedback or stroke classification).
   * @param {Object} confirmation
   */
  async saveMicroConfirmation(confirmation) {
    if (!this.user) return;

    const { error } = await this.client
      .from('micro_confirmations')
      .insert({
        user_id: this.user.id,
        session_id: confirmation.sessionId || null,
        confirmation_type: confirmation.confirmationType,
        coaching_issue_id: confirmation.coachingIssueId || null,
        player_rating: confirmation.playerRating || null,
        detected_stroke_type: confirmation.detectedStrokeType || null,
        confirmed_stroke_type: confirmation.confirmedStrokeType || null,
        fault_id: confirmation.faultId || null,
        was_real: confirmation.wasReal ?? null
      });

    if (error) {
      console.error('SupabaseClient: saveMicroConfirmation error', error);
    }
  }

  // ================================================================
  // Anonymous Telemetry
  // ================================================================

  /**
   * Submit anonymized telemetry via Edge Function (fire-and-forget).
   * Requires auth to prevent spam, but the Edge Function strips identity.
   * @param {Object} payload - { entries: [...] } from SessionStorage.buildTelemetryPayload()
   */
  async submitTelemetry(payload) {
    if (!this.user || !this._functionsUrl || !payload) return;

    const accessToken = await this._getValidAccessToken();
    if (!accessToken) return;

    try {
      const response = await fetch(`${this._functionsUrl}/submit-telemetry`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': this.client.supabaseKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('SupabaseClient: submitTelemetry error', response.status, errData);
      }
    } catch (e) {
      console.error('SupabaseClient: submitTelemetry fetch error', e);
    }
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
