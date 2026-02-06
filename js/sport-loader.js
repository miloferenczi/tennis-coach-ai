/**
 * SportLoader - Loads and manages sport-specific configuration
 *
 * This enables multi-sport support by abstracting sport-specific data.
 * Currently hardcoded to tennis, but the architecture supports:
 * - Golf (swing analysis)
 * - Boxing (punch tracking)
 * - Weightlifting (form analysis)
 * - And more...
 *
 * To add a new sport:
 * 1. Create sports/{sport}/config.json following tennis structure
 * 2. Add sport to availableSports list
 * 3. Create sport-specific coaching tree if needed
 */
class SportLoader {
  constructor() {
    this.currentSport = 'tennis'; // Default sport
    this.config = null;
    this.availableSports = ['tennis']; // Expand as sports are added
    this.loaded = false;
  }

  /**
   * Load sport configuration
   */
  async load(sport = 'tennis') {
    if (!this.availableSports.includes(sport)) {
      console.warn(`Sport "${sport}" not available, defaulting to tennis`);
      sport = 'tennis';
    }

    try {
      const response = await fetch(`sports/${sport}/config.json`);
      if (!response.ok) {
        throw new Error(`Failed to load ${sport} config`);
      }
      this.config = await response.json();
      this.currentSport = sport;
      this.loaded = true;
      console.log(`Loaded ${sport} configuration`);
      return this.config;
    } catch (error) {
      console.error(`Error loading sport config:`, error);
      // Fall back to inline tennis config
      this.config = this.getDefaultTennisConfig();
      this.currentSport = 'tennis';
      this.loaded = true;
      return this.config;
    }
  }

  /**
   * Get current sport config (synchronous, after load)
   */
  getConfig() {
    if (!this.loaded) {
      console.warn('Sport config not loaded yet, returning default');
      return this.getDefaultTennisConfig();
    }
    return this.config;
  }

  /**
   * Get current sport name
   */
  getCurrentSport() {
    return this.currentSport;
  }

  /**
   * Get display name for current sport
   */
  getDisplayName() {
    return this.config?.displayName || 'Tennis';
  }

  /**
   * Get movement types for current sport
   */
  getMovementTypes() {
    return Object.keys(this.config?.movements || {});
  }

  /**
   * Get detection thresholds
   */
  getDetectionThresholds() {
    return this.config?.detectionThresholds || {
      minVelocity: 2.75,
      minAcceleration: 108.5,
      rotationThreshold: 15
    };
  }

  /**
   * Get quality weights
   */
  getQualityWeights() {
    return this.config?.qualityWeights || {
      velocity: 0.35,
      acceleration: 0.25,
      rotation: 0.20,
      smoothness: 0.20
    };
  }

  /**
   * Get movement config by type
   */
  getMovementConfig(movementType) {
    return this.config?.movements?.[movementType] || null;
  }

  /**
   * Get terminology for the sport
   */
  getTerminology() {
    return this.config?.terminology || {
      movement: 'movement',
      movementPlural: 'movements',
      session: 'session',
      quality: 'quality',
      speed: 'speed'
    };
  }

  /**
   * Get coaching style configuration
   */
  getCoachingStyle() {
    return this.config?.coachingStyle || {
      sport: 'tennis',
      roleDescription: 'expert coach',
      keyTerms: [],
      encouragement: ['Good job!', 'Keep it up!']
    };
  }

  /**
   * Get biomechanical checkpoints
   */
  getBiomechanicalCheckpoints() {
    return this.config?.biomechanicalCheckpoints || {};
  }

  /**
   * Get key body points to track
   */
  getKeyBodyPoints() {
    return this.config?.keyBodyPoints || {
      primary: ['right_wrist', 'left_wrist'],
      secondary: ['right_shoulder', 'left_shoulder'],
      lower: ['right_knee', 'left_knee']
    };
  }

  /**
   * Get phases for a movement category
   */
  getPhases(category) {
    return this.config?.phases?.[category] || ['preparation', 'execution', 'follow_through'];
  }

  /**
   * Check if a sport is available
   */
  isAvailable(sport) {
    return this.availableSports.includes(sport);
  }

  /**
   * Get list of available sports
   */
  getAvailableSports() {
    return [...this.availableSports];
  }

  /**
   * Switch to a different sport
   */
  async switchSport(sport) {
    if (sport === this.currentSport) return this.config;
    return await this.load(sport);
  }

  /**
   * Default tennis config (fallback if JSON fails to load)
   */
  getDefaultTennisConfig() {
    return {
      sport: 'tennis',
      displayName: 'Tennis',
      icon: 'TENNIS',
      movements: {
        'Forehand': { displayName: 'Forehand', category: 'groundstroke' },
        'Backhand': { displayName: 'Backhand', category: 'groundstroke' },
        'Serve': { displayName: 'Serve', category: 'serve' },
        'Volley': { displayName: 'Volley', category: 'net' },
        'Overhead': { displayName: 'Overhead', category: 'overhead' }
      },
      detectionThresholds: {
        minVelocity: 2.75,
        minAcceleration: 108.5,
        rotationThreshold: 15
      },
      qualityWeights: {
        velocity: 0.35,
        acceleration: 0.25,
        rotation: 0.20,
        smoothness: 0.20
      },
      terminology: {
        movement: 'stroke',
        movementPlural: 'strokes',
        session: 'practice session',
        quality: 'stroke quality',
        speed: 'racquet speed'
      },
      coachingStyle: {
        sport: 'tennis',
        roleDescription: 'expert tennis coach',
        keyTerms: ['topspin', 'contact point', 'follow-through'],
        encouragement: ['Great shot!', 'Nice technique!']
      }
    };
  }
}

// Global instance
const sportLoader = new SportLoader();

// Auto-load tennis config
if (typeof window !== 'undefined') {
  sportLoader.load('tennis').catch(console.error);
}
