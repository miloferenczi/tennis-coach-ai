/**
 * ChallengeMode - Gamification with challenges and rewards
 */
class ChallengeMode {
  constructor() {
    this.CHALLENGES_KEY = 'techniqueai_challenges';
    this.activeChallenge = null;
    this.challengeProgress = {};
    this.completedChallenges = this.loadCompletedChallenges();

    // Define available challenges
    this.challenges = {
      consistency_king: {
        id: 'consistency_king',
        name: 'Consistency King',
        description: 'Hit 10 forehands with a score above 80',
        icon: '👑',
        goal: { strokeType: 'Forehand', minScore: 80, count: 10 },
        reward: 'Unlocks advanced analytics',
        difficulty: 'medium'
      },
      rotation_pro: {
        id: 'rotation_pro',
        name: 'Rotation Pro',
        description: 'Hit 5 strokes with 40°+ hip-shoulder separation',
        icon: '🔄',
        goal: { metric: 'hipShoulderSeparation', minValue: 40, count: 5 },
        reward: 'Unlocks pro comparison feature',
        difficulty: 'medium'
      },
      power_player: {
        id: 'power_player',
        name: 'Power Player',
        description: 'Hit 5 strokes at advanced skill level or above',
        icon: '💪',
        goal: { skillLevel: 'advanced', count: 5 },
        reward: 'Unlocks power training drills',
        difficulty: 'hard'
      },
      smooth_operator: {
        id: 'smooth_operator',
        name: 'Smooth Operator',
        description: 'Complete 15 strokes with 70+ smoothness score',
        icon: '✨',
        goal: { metric: 'smoothness', minValue: 70, count: 15 },
        reward: 'Unlocks rhythm training',
        difficulty: 'easy'
      },
      backhand_boss: {
        id: 'backhand_boss',
        name: 'Backhand Boss',
        description: 'Hit 8 backhands with a score above 75',
        icon: '🎯',
        goal: { strokeType: 'Backhand', minScore: 75, count: 8 },
        reward: 'Unlocks backhand analysis',
        difficulty: 'medium'
      },
      serve_ace: {
        id: 'serve_ace',
        name: 'Serve Ace',
        description: 'Hit 5 serves with a score above 85',
        icon: '🚀',
        goal: { strokeType: 'Serve', minScore: 85, count: 5 },
        reward: 'Unlocks serve power metrics',
        difficulty: 'hard'
      },
      warm_up: {
        id: 'warm_up',
        name: 'Warm Up',
        description: 'Complete 20 strokes of any type',
        icon: '🔥',
        goal: { count: 20 },
        reward: 'First milestone!',
        difficulty: 'easy'
      },
      perfect_form: {
        id: 'perfect_form',
        name: 'Perfect Form',
        description: 'Hit 3 strokes with a score of 90 or above',
        icon: '💯',
        goal: { minScore: 90, count: 3 },
        reward: 'Technique mastery badge',
        difficulty: 'hard'
      }
    };
  }

  /**
   * Get all available challenges
   */
  getAvailableChallenges() {
    return Object.values(this.challenges).map(challenge => ({
      ...challenge,
      isCompleted: this.isCompleted(challenge.id),
      isActive: this.activeChallenge?.id === challenge.id,
      progress: this.getProgress(challenge.id)
    }));
  }

  /**
   * Start a challenge
   */
  startChallenge(challengeId) {
    const challenge = this.challenges[challengeId];
    if (!challenge) return null;

    this.activeChallenge = challenge;
    this.challengeProgress[challengeId] = {
      current: 0,
      target: challenge.goal.count,
      startedAt: Date.now(),
      strokes: []
    };

    console.log(`Challenge started: ${challenge.name}`);
    return challenge;
  }

  /**
   * Stop/abandon current challenge
   */
  stopChallenge() {
    if (this.activeChallenge) {
      console.log(`Challenge abandoned: ${this.activeChallenge.name}`);
      this.activeChallenge = null;
    }
  }

  /**
   * Record a stroke and check challenge progress
   */
  recordStroke(strokeData) {
    if (!this.activeChallenge) return null;

    const challenge = this.activeChallenge;
    const goal = challenge.goal;
    const progress = this.challengeProgress[challenge.id];

    if (!progress) return null;

    // Check if stroke qualifies
    let qualifies = true;

    // Check stroke type requirement
    if (goal.strokeType && strokeData.type !== goal.strokeType) {
      qualifies = false;
    }

    // Check minimum score requirement
    if (goal.minScore && strokeData.quality.overall < goal.minScore) {
      qualifies = false;
    }

    // Check skill level requirement
    if (goal.skillLevel) {
      const skillLevels = ['beginner', 'intermediate', 'advanced', 'professional'];
      const requiredLevel = skillLevels.indexOf(goal.skillLevel);
      const actualLevel = skillLevels.indexOf(strokeData.proComparison?.skillLevel || 'beginner');
      if (actualLevel < requiredLevel) {
        qualifies = false;
      }
    }

    // Check specific metric requirement
    if (goal.metric && goal.minValue) {
      let metricValue = 0;
      if (goal.metric === 'hipShoulderSeparation') {
        metricValue = strokeData.technique?.hipShoulderSeparation || 0;
      } else if (goal.metric === 'smoothness') {
        metricValue = strokeData.smoothness || 0;
      }
      if (metricValue < goal.minValue) {
        qualifies = false;
      }
    }

    if (qualifies) {
      progress.current++;
      progress.strokes.push({
        type: strokeData.type,
        score: strokeData.quality.overall,
        timestamp: Date.now()
      });
    }

    // Check if challenge is complete
    if (progress.current >= progress.target) {
      return this.completeChallenge();
    }

    return {
      qualified: qualifies,
      progress: progress.current,
      target: progress.target,
      complete: false
    };
  }

  /**
   * Complete the active challenge
   */
  completeChallenge() {
    if (!this.activeChallenge) return null;

    const challenge = this.activeChallenge;
    const progress = this.challengeProgress[challenge.id];

    // Mark as completed
    this.completedChallenges[challenge.id] = {
      completedAt: Date.now(),
      duration: Date.now() - progress.startedAt,
      strokes: progress.strokes.length
    };

    this.saveCompletedChallenges();

    // Save to player profile if available
    if (typeof playerProfile !== 'undefined') {
      const milestone = {
        type: `challenge_${challenge.id}`,
        date: Date.now(),
        label: challenge.name
      };
      if (!playerProfile.hasMilestone(milestone.type)) {
        playerProfile.profile.milestones.push(milestone);
        playerProfile.saveProfile();
      }
    }

    console.log(`Challenge completed: ${challenge.name}!`);

    const result = {
      challenge: challenge,
      qualified: true,
      progress: progress.target,
      target: progress.target,
      complete: true,
      reward: challenge.reward
    };

    this.activeChallenge = null;

    return result;
  }

  /**
   * Check if a challenge is completed
   */
  isCompleted(challengeId) {
    return !!this.completedChallenges[challengeId];
  }

  /**
   * Get progress for a challenge
   */
  getProgress(challengeId) {
    const progress = this.challengeProgress[challengeId];
    if (!progress) return { current: 0, target: this.challenges[challengeId]?.goal.count || 0 };
    return { current: progress.current, target: progress.target };
  }

  /**
   * Get active challenge info
   */
  getActiveChallengeInfo() {
    if (!this.activeChallenge) return null;

    const progress = this.challengeProgress[this.activeChallenge.id];
    return {
      ...this.activeChallenge,
      progress: progress?.current || 0,
      target: progress?.target || this.activeChallenge.goal.count
    };
  }

  /**
   * Save completed challenges to localStorage
   */
  saveCompletedChallenges() {
    try {
      localStorage.setItem(this.CHALLENGES_KEY, JSON.stringify(this.completedChallenges));
    } catch (e) {
      console.error('Failed to save challenges:', e);
    }
  }

  /**
   * Load completed challenges from localStorage
   */
  loadCompletedChallenges() {
    try {
      const data = localStorage.getItem(this.CHALLENGES_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.error('Failed to load challenges:', e);
      return {};
    }
  }

  /**
   * Get completion stats
   */
  getStats() {
    const total = Object.keys(this.challenges).length;
    const completed = Object.keys(this.completedChallenges).length;

    return {
      total,
      completed,
      percentage: Math.round((completed / total) * 100),
      remaining: total - completed
    };
  }

  /**
   * Reset all challenges (for testing)
   */
  resetAll() {
    this.completedChallenges = {};
    this.activeChallenge = null;
    this.challengeProgress = {};
    this.saveCompletedChallenges();
  }
}

// Global instance
const challengeMode = new ChallengeMode();
