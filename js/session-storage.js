/**
 * SessionStorage - Manages persistence of tennis coaching session data
 */
class SessionStorage {
  constructor() {
    this.STORAGE_KEY = 'techniqueai_sessions';
    this.CURRENT_SESSION_KEY = 'techniqueai_current_session';
    this.MAX_SESSIONS = 50; // Keep last 50 sessions
    this._supabaseSessionId = null; // UUID from Supabase
    this._currentSessionStrokes = []; // In-memory stroke buffer for current session
  }

  _useSupabase() {
    return typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated();
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a new session
   */
  async createSession() {
    // Free tier: 1 session per month
    if (this._useSupabase()) {
      const sub = supabaseClient.getSubscriptionStatus();
      if (sub.sessionLimitPerMonth !== null) {
        const sessions = await supabaseClient.getSessionHistory(5);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const sessionsThisMonth = sessions.filter(s => s.date >= monthStart);
        if (sessionsThisMonth.length >= sub.sessionLimitPerMonth) {
          window.dispatchEvent(new CustomEvent('ace:session-limit-reached', { detail: { tier: sub.tier, limit: sub.sessionLimitPerMonth } }));
          return null;
        }
      }
    }

    const session = {
      id: this.generateSessionId(),
      startTime: Date.now(),
      endTime: null,
      strokes: [],
      summary: null
    };

    this._currentSessionStrokes = [];

    if (this._useSupabase()) {
      this._supabaseSessionId = await supabaseClient.createSession(session.startTime);
      session.supabaseId = this._supabaseSessionId;
    }

    this.saveCurrentSession(session);
    return session;
  }

  /**
   * Save the current active session to localStorage
   */
  saveCurrentSession(session) {
    try {
      localStorage.setItem(this.CURRENT_SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.error('Failed to save current session:', e);
    }
  }

  /**
   * Get the current active session
   */
  getCurrentSession() {
    try {
      const data = localStorage.getItem(this.CURRENT_SESSION_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to load current session:', e);
      return null;
    }
  }

  /**
   * Add a stroke to the current session
   */
  addStroke(strokeData) {
    const session = this.getCurrentSession();
    if (!session) return;

    // Free tier stroke limit enforcement
    if (this._useSupabase()) {
      const sub = supabaseClient.getSubscriptionStatus();
      if (sub.strokeLimit !== null && session.strokes.length >= sub.strokeLimit) {
        window.dispatchEvent(new CustomEvent('ace:stroke-limit-reached', { detail: { tier: sub.tier, limit: sub.strokeLimit } }));
        return null;
      }
    }

    // Store essential stroke data (avoid storing full landmark data)
    const strokeRecord = {
      timestamp: strokeData.timestamp || Date.now(),
      type: strokeData.type,
      quality: strokeData.quality.overall,
      qualityBreakdown: strokeData.quality.breakdown,
      technique: {
        elbowAngle: strokeData.technique.elbowAngleAtContact,
        hipShoulderSeparation: strokeData.technique.hipShoulderSeparation,
        stance: strokeData.technique.stance,
        weightTransfer: strokeData.technique.weightTransfer
      },
      physics: {
        velocity: strokeData.velocity?.magnitude || 0,
        acceleration: strokeData.acceleration?.magnitude || 0,
        rotation: strokeData.rotation || 0,
        smoothness: strokeData.smoothness || 0
      },
      proComparison: strokeData.proComparison ? {
        skillLevel: strokeData.proComparison.skillLevel,
        percentile: strokeData.proComparison.percentile,
        overallSimilarity: strokeData.proComparison.overallSimilarity
      } : null,
      estimatedBallSpeed: strokeData.estimatedBallSpeed,
      biomechanical: strokeData.biomechanicalEvaluation ? {
        overall: strokeData.biomechanicalEvaluation.overall,
        faults: strokeData.biomechanicalEvaluation.detectedFaults?.map(f => f.name) || []
      } : null,
      normalizedToTorso: !!strokeData.velocity?.normalizedToTorso,
      rallyContext: this.getRallyContext()
    };

    session.strokes.push(strokeRecord);
    this._currentSessionStrokes.push(strokeRecord);
    this.saveCurrentSession(session);

    // Buffer stroke for Supabase batch writing
    if (this._useSupabase()) {
      supabaseClient.bufferStroke(strokeRecord);
    }

    return strokeRecord;
  }

  /**
   * End the current session and archive it
   */
  async endSession() {
    const session = this.getCurrentSession();
    if (!session || session.strokes.length === 0) {
      localStorage.removeItem(this.CURRENT_SESSION_KEY);
      return null;
    }

    session.endTime = Date.now();
    session.summary = this.generateSessionSummary(session);

    // Flush remaining strokes and update session in Supabase
    if (this._useSupabase()) {
      await supabaseClient.flushStrokes();
      supabaseClient.stopBatchTimer();
      if (this._supabaseSessionId) {
        await supabaseClient.updateSession(this._supabaseSessionId, {
          endTime: session.endTime,
          summary: session.summary
        });
      }
      this._supabaseSessionId = null;
    }

    // Archive the session (localStorage backup)
    this.archiveSession(session);

    // Clear current session
    localStorage.removeItem(this.CURRENT_SESSION_KEY);
    this._currentSessionStrokes = [];

    return session;
  }

  /**
   * Generate session summary
   */
  generateSessionSummary(session) {
    const strokes = session.strokes;
    if (strokes.length === 0) return null;

    const scores = strokes.map(s => s.quality);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const bestScore = Math.max(...scores);
    const bestStroke = strokes.find(s => s.quality === bestScore);

    // Calculate stroke type distribution
    const strokeTypes = {};
    strokes.forEach(s => {
      strokeTypes[s.type] = (strokeTypes[s.type] || 0) + 1;
    });

    // Find most common stroke type
    const dominantStrokeType = Object.entries(strokeTypes)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    // Calculate consistency (standard deviation)
    const variance = scores.reduce((sum, score) =>
      sum + Math.pow(score - avgScore, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    let consistency = 'Excellent';
    if (stdDev >= 15) consistency = 'Needs Work';
    else if (stdDev >= 10) consistency = 'Good';

    // Detect improvements (last 5 vs first 5)
    let improvement = 0;
    if (strokes.length >= 10) {
      const first5Avg = strokes.slice(0, 5).reduce((sum, s) => sum + s.quality, 0) / 5;
      const last5Avg = strokes.slice(-5).reduce((sum, s) => sum + s.quality, 0) / 5;
      improvement = last5Avg - first5Avg;
    }

    // Find weaknesses (lowest scoring areas)
    const techniqueAreas = {
      'Elbow Extension': [],
      'Hip-Shoulder Separation': [],
      'Weight Transfer': []
    };

    strokes.forEach(s => {
      if (s.technique.elbowAngle < 140) techniqueAreas['Elbow Extension'].push(s);
      if (s.technique.hipShoulderSeparation < 20) techniqueAreas['Hip-Shoulder Separation'].push(s);
      if (s.technique.weightTransfer === 'static') techniqueAreas['Weight Transfer'].push(s);
    });

    const weaknesses = Object.entries(techniqueAreas)
      .filter(([_, issues]) => issues.length > strokes.length * 0.3)
      .map(([area]) => area);

    // Skill level from most recent strokes
    const recentWithLevel = strokes.slice(-5).filter(s => s.proComparison?.skillLevel);
    const skillLevel = recentWithLevel.length > 0
      ? recentWithLevel[recentWithLevel.length - 1].proComparison.skillLevel
      : 'beginner';

    // Per-stroke-type breakdowns for improvement tracking
    const strokeTypeBreakdowns = {};
    for (const [type, count] of Object.entries(strokeTypes)) {
      const typeStrokes = strokes.filter(s => s.type === type);
      strokeTypeBreakdowns[type] = {
        count,
        avgQuality: this.avg(typeStrokes.map(s => s.quality)),
        avgFormScore: this.avg(typeStrokes.map(s => s.qualityBreakdown?.biomechanical).filter(Boolean)),
        avgRotation: this.avg(typeStrokes.map(s => Math.abs(s.physics?.rotation || 0))),
        avgHipSep: this.avg(typeStrokes.map(s => s.technique?.hipShoulderSeparation).filter(v => v != null)),
        avgElbowAngle: this.avg(typeStrokes.map(s => s.technique?.elbowAngle).filter(v => v != null)),
        avgSmoothness: this.avg(typeStrokes.map(s => s.physics?.smoothness).filter(v => v != null)),
        faults: typeStrokes.flatMap(s => s.biomechanical?.faults || [])
      };
    }

    // Rally stats from tracker (if available)
    let rallyStats = null;
    if (typeof tennisAI !== 'undefined' && tennisAI?.rallyTracker) {
      rallyStats = tennisAI.rallyTracker.getSessionStats();
    }

    return {
      duration: session.endTime - session.startTime,
      totalStrokes: strokes.length,
      averageScore: Math.round(avgScore),
      bestScore: Math.round(bestScore),
      bestStrokeType: bestStroke?.type,
      dominantStrokeType,
      strokeDistribution: strokeTypes,
      strokeTypeBreakdowns,
      consistency,
      improvement: Math.round(improvement),
      weaknesses,
      skillLevel,
      drillRecommendation: this.getDrillRecommendation(weaknesses, dominantStrokeType),
      rallyStats
    };
  }

  /**
   * Get drill recommendation based on weaknesses
   */
  getDrillRecommendation(weaknesses, strokeType) {
    if (weaknesses.includes('Elbow Extension')) {
      return {
        name: 'Shadow Swing Extension Drill',
        description: 'Practice shadow swings focusing on extending your arm fully at contact. Use a wall mirror to check your elbow angle.',
        duration: '10 minutes'
      };
    }
    if (weaknesses.includes('Hip-Shoulder Separation')) {
      return {
        name: 'Rotation Isolation Drill',
        description: 'Stand with feet planted and practice rotating your hips before your shoulders. Focus on the kinetic chain.',
        duration: '10 minutes'
      };
    }
    if (weaknesses.includes('Weight Transfer')) {
      return {
        name: 'Step-In Footwork Drill',
        description: 'Practice stepping into each shot with your front foot. Start slow and build rhythm.',
        duration: '15 minutes'
      };
    }

    // Default drill based on stroke type
    if (strokeType === 'serve') {
      return {
        name: 'Toss Consistency Drill',
        description: 'Practice your ball toss without hitting. Aim for consistent height and placement.',
        duration: '5 minutes'
      };
    }

    return {
      name: 'Mini Tennis Warm-up',
      description: 'Start at the service line and rally with focus on control and consistency.',
      duration: '10 minutes'
    };
  }

  /**
   * Archive a completed session to history
   */
  archiveSession(session) {
    try {
      const history = this.getSessionHistory();

      // Add new session at the beginning
      history.unshift({
        id: session.id,
        date: session.startTime,
        summary: session.summary
      });

      // Keep only last MAX_SESSIONS
      if (history.length > this.MAX_SESSIONS) {
        history.length = this.MAX_SESSIONS;
      }

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('Failed to archive session:', e);
    }
  }

  /**
   * Get session history (summaries only)
   */
  async getSessionHistory() {
    if (this._useSupabase()) {
      return await supabaseClient.getSessionHistory(this.MAX_SESSIONS);
    }
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load session history:', e);
      return [];
    }
  }

  /**
   * Get aggregated statistics across all sessions
   */
  getAggregatedStats() {
    const history = this.getSessionHistory();
    if (history.length === 0) return null;

    const totalStrokes = history.reduce((sum, s) => sum + (s.summary?.totalStrokes || 0), 0);
    const totalDuration = history.reduce((sum, s) => sum + (s.summary?.duration || 0), 0);
    const avgScores = history.map(s => s.summary?.averageScore).filter(s => s);
    const overallAverage = avgScores.length > 0
      ? avgScores.reduce((a, b) => a + b, 0) / avgScores.length
      : 0;

    // Calculate trend (last 5 sessions vs previous 5)
    let trend = 'stable';
    if (history.length >= 10) {
      const recent5Avg = history.slice(0, 5).reduce((sum, s) => sum + (s.summary?.averageScore || 0), 0) / 5;
      const prev5Avg = history.slice(5, 10).reduce((sum, s) => sum + (s.summary?.averageScore || 0), 0) / 5;
      if (recent5Avg > prev5Avg + 3) trend = 'improving';
      else if (recent5Avg < prev5Avg - 3) trend = 'declining';
    }

    // Most practiced stroke type
    const strokeCounts = {};
    history.forEach(s => {
      if (s.summary?.strokeDistribution) {
        Object.entries(s.summary.strokeDistribution).forEach(([type, count]) => {
          strokeCounts[type] = (strokeCounts[type] || 0) + count;
        });
      }
    });
    const mostPracticed = Object.entries(strokeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    // Best session
    const bestSession = history.reduce((best, s) => {
      if (!s.summary) return best;
      if (!best || s.summary.averageScore > best.summary.averageScore) return s;
      return best;
    }, null);

    return {
      totalSessions: history.length,
      totalStrokes,
      totalDuration,
      overallAverage: Math.round(overallAverage),
      trend,
      mostPracticed,
      bestSession: bestSession ? {
        date: bestSession.date,
        score: bestSession.summary.averageScore
      } : null,
      recentSessions: history.slice(0, 10)
    };
  }

  /**
   * Get current rally context from the global rally tracker (if available).
   */
  getRallyContext() {
    if (typeof tennisAI === 'undefined' || !tennisAI?.rallyTracker) return null;
    const rt = tennisAI.rallyTracker;
    if (!rt.currentRally) return null;
    return {
      rallyNumber: rt.currentRally.number,
      strokeInRally: rt.currentRally.strokes.length,
      origin: rt.currentRally.origin
    };
  }

  /**
   * Compute average of an array, returning 0 for empty arrays.
   */
  avg(values) {
    if (!values || values.length === 0) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  /**
   * Build an anonymized telemetry payload for the submit-telemetry Edge Function.
   * Contains per-stroke-type metric distributions with zero PII.
   * @param {Object} session - ended session with strokes array
   * @param {Object} summary - session summary
   * @returns {Object} { entries: [...] } ready to POST
   */
  buildTelemetryPayload(session, summary) {
    if (!session?.strokes || session.strokes.length === 0 || !summary) return null;

    const skillLevel = summary.skillLevel || 'intermediate';
    const ntrpLevel = (typeof playerProfile !== 'undefined' && playerProfile.profile?.ntrpLevel)
      ? playerProfile.profile.ntrpLevel : null;
    const sessionNumber = (typeof playerProfile !== 'undefined' && playerProfile.profile?.totalSessions)
      ? playerProfile.profile.totalSessions : null;
    const durationMinutes = summary.duration ? +(summary.duration / 60000).toFixed(1) : null;

    // Group strokes by type
    const byType = {};
    for (const s of session.strokes) {
      const type = s.type || 'unknown';
      if (!byType[type]) byType[type] = [];
      byType[type].push(s);
    }

    const entries = [];
    for (const [strokeType, strokes] of Object.entries(byType)) {
      if (strokes.length === 0) continue;

      const qualities = strokes.map(s => s.quality).filter(q => q != null);
      const formScores = strokes.map(s => s.qualityBreakdown?.biomechanical).filter(v => v != null);

      // Per-metric distributions
      const metrics = {};
      const metricAccessors = {
        rotation: s => s.physics?.rotation ? Math.abs(s.physics.rotation) : null,
        hipSep: s => s.technique?.hipShoulderSeparation,
        elbowAngle: s => s.technique?.elbowAngle,
        smoothness: s => s.physics?.smoothness,
        velocity: s => s.physics?.velocity,
        acceleration: s => s.physics?.acceleration
      };

      for (const [metricName, accessor] of Object.entries(metricAccessors)) {
        const vals = strokes.map(accessor).filter(v => v != null).sort((a, b) => a - b);
        if (vals.length >= 2) {
          metrics[metricName] = {
            avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
            p25: +vals[Math.floor(vals.length * 0.25)].toFixed(2),
            p50: +vals[Math.floor(vals.length * 0.50)].toFixed(2),
            p75: +vals[Math.floor(vals.length * 0.75)].toFixed(2)
          };
        }
      }

      // Fault frequencies (ratio 0-1)
      const faultCounts = {};
      strokes.forEach(s => {
        (s.biomechanical?.faults || []).forEach(f => {
          faultCounts[f] = (faultCounts[f] || 0) + 1;
        });
      });
      const faultFrequencies = {};
      for (const [fault, count] of Object.entries(faultCounts)) {
        faultFrequencies[fault] = +(count / strokes.length).toFixed(3);
      }

      entries.push({
        skillLevel,
        ntrpLevel,
        sessionNumber,
        strokeType,
        strokeCount: strokes.length,
        avgQuality: qualities.length ? +(qualities.reduce((a, b) => a + b, 0) / qualities.length).toFixed(1) : null,
        avgFormScore: formScores.length ? +(formScores.reduce((a, b) => a + b, 0) / formScores.length).toFixed(1) : null,
        metrics,
        faultFrequencies,
        sessionDurationMinutes: durationMinutes,
        telemetryVersion: 1
      });
    }

    return entries.length > 0 ? { entries } : null;
  }

  /**
   * Clear all stored data
   */
  clearAllData() {
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem(this.CURRENT_SESSION_KEY);
  }
}

// Global instance
const sessionStorage = new SessionStorage();
