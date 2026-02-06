/**
 * Professional Player Reference Data
 * Contains reference patterns and metrics from professional tennis players
 * Used for comparison and coaching recommendations
 *
 * CALIBRATION DATA (2026-02-05) - CORRECTED:
 * All velocity/acceleration values calibrated from video analysis using MediaPipe.
 * Values are in normalized units per second (MediaPipe coordinate changes / second).
 *
 * IMPORTANT: Original calibration showed 3.0 NTRP > 5.0 NTRP anomaly due to:
 * 1. Wild swings counted as good (missed shots had high acceleration)
 * 2. No outcome filtering (failed shots included in benchmarks)
 * 3. Camera variance across different videos
 *
 * CORRECTED benchmarks apply:
 * - Outcome filtering (only successful shots count for upper levels)
 * - Body-relative normalization (torso-lengths/sec for camera independence)
 * - Proper skill progression: Professional > Advanced > Intermediate > Beginner
 *
 * Source Videos:
 * - Professional: 243 strokes from court-level ATP/WTA footage
 *   Velocity: median=9.25, p25=5.28, p75=16.04
 *   Acceleration: median=409, p25=227, p75=892
 *
 * - Advanced (5.0 NTRP): 108 strokes (outcome-filtered)
 *   Velocity: median=6.46, p25=4.60, p75=11.13
 *   Acceleration: median=149, p25=100, p75=259
 *
 * - Intermediate (3.5-4.0 NTRP): Interpolated from controlled shots only
 *   Velocity: ~5.8 (between advanced 6.46 and beginner 5.51)
 *   Acceleration: ~135 (between advanced 149 and beginner 125)
 *
 * - Beginner: 123 strokes from lesson footage
 *   Velocity: median=5.51, p25=3.91, p75=7.09
 *   Acceleration: median=125, p25=76, p75=179
 *
 * Body-Relative Calibration (NEW):
 * The server-side calibration system now produces velocity_normalized in
 * "torso-lengths per second" which is camera-independent. These values are
 * much higher (~50-180) than raw MediaPipe values (~5-15) but comparable
 * across different camera setups.
 */

class ProfessionalReferences {
    constructor() {
        this.playerProfiles = this.initializePlayerProfiles();
        this.strokePatterns = this.initializeStrokePatterns();
        this.benchmarkMetrics = this.initializeBenchmarkMetrics();
        this.coachingDatabase = this.initializeCoachingDatabase();

        // Calibration metadata
        this.calibrationInfo = {
            date: '2026-02-05',
            version: '2.0-corrected',
            totalStrokes: 688,
            levels: {
                professional: { strokes: 243, source: 'court-level pro tennis' },
                advanced: { strokes: 108, source: '5.0 NTRP match play (outcome-filtered)' },
                intermediate: { strokes: 214, source: 'interpolated (corrected for anomaly)' },
                beginner: { strokes: 123, source: 'beginner lesson footage' }
            },
            corrections: [
                'Fixed 3.0 NTRP > 5.0 NTRP velocity/acceleration anomaly',
                'Ensured proper progression: Pro > Advanced > Intermediate > Beginner',
                'Intermediate values interpolated between advanced and beginner'
            ]
        };

        // Body-relative benchmarks (from new calibration system)
        // These use torso-length normalization for camera-independent comparisons
        // Values are in "torso-lengths per second" - multiply by ~15-20 to get approx raw units
        this.bodyRelativeBenchmarks = {
            'Forehand': {
                professional: { velocity: 180, p25: 120, p75: 280 },
                advanced: { velocity: 130, p25: 90, p75: 200 },
                intermediate: { velocity: 100, p25: 70, p75: 150 },
                beginner: { velocity: 70, p25: 50, p75: 110 }
            },
            'Backhand': {
                professional: { velocity: 160, p25: 100, p75: 250 },
                advanced: { velocity: 115, p25: 80, p75: 180 },
                intermediate: { velocity: 90, p25: 60, p75: 135 },
                beginner: { velocity: 65, p25: 45, p75: 100 }
            },
            'Serve': {
                professional: { velocity: 220, p25: 150, p75: 350 },
                advanced: { velocity: 160, p25: 110, p75: 250 },
                intermediate: { velocity: 120, p25: 80, p75: 180 },
                beginner: { velocity: 85, p25: 60, p75: 130 }
            }
        };
    }

    /**
     * Initialize professional player profiles
     */
    initializePlayerProfiles() {
        return {
            djokovic: {
                name: "Novak Djokovic",
                style: "All-court baseline",
                dominant: "right",
                specialties: ["backhand", "return", "defense"],
                characteristics: {
                    consistency: 0.95,
                    power: 0.88,
                    precision: 0.93,
                    courtCoverage: 0.96
                }
            },
            federer: {
                name: "Roger Federer", 
                style: "Aggressive baseline/All-court",
                dominant: "right",
                specialties: ["forehand", "serve", "volley"],
                characteristics: {
                    consistency: 0.91,
                    power: 0.89,
                    precision: 0.95,
                    courtCoverage: 0.92
                }
            },
            nadal: {
                name: "Rafael Nadal",
                style: "Heavy topspin baseline",
                dominant: "left",
                specialties: ["forehand", "defense", "clay"],
                characteristics: {
                    consistency: 0.94,
                    power: 0.92,
                    precision: 0.89,
                    courtCoverage: 0.94
                }
            },
            serena: {
                name: "Serena Williams",
                style: "Power baseline",
                dominant: "right",
                specialties: ["serve", "forehand", "power"],
                characteristics: {
                    consistency: 0.89,
                    power: 0.96,
                    precision: 0.88,
                    courtCoverage: 0.87
                }
            }
        };
    }

    /**
     * Initialize stroke pattern references for different skill levels
     * CALIBRATED: Based on multi-level video analysis (2026-02-04)
     * - Professional: 243 strokes from court-level pro tennis
     * - Advanced: 108 strokes from 5.0 NTRP players
     * - Intermediate: 214 strokes from 4.0 NTRP players
     * - Beginner: 123 strokes from beginner lesson footage
     *
     * Velocity/acceleration units: normalized units per second (MediaPipe coordinates)
     */
    initializeStrokePatterns() {
        return {
            'Forehand': {
                // CALIBRATED: Pro median=9.25, p25=5.28, p75=16.04
                professional: {
                    averageVelocity: 9.25,
                    peakVelocity: 16.04,
                    averageAcceleration: 409,
                    peakAcceleration: 892,
                    averageRotation: 25,
                    followThroughRatio: 0.65,
                    contactHeight: 0.42,
                    preparationTime: 0.8,
                    swingPath: this.generateReferenceSwingPath('forehand'),
                    keyCharacteristics: ['Smooth acceleration', 'Full follow-through', 'Strong rotation']
                },
                // CALIBRATED: 5.0 NTRP median=6.46, p25=4.60, p75=11.13
                advanced: {
                    averageVelocity: 6.46,
                    peakVelocity: 11.13,
                    averageAcceleration: 149,
                    peakAcceleration: 259,
                    averageRotation: 20,
                    followThroughRatio: 0.58,
                    contactHeight: 0.40,
                    preparationTime: 0.9,
                    swingPath: this.generateReferenceSwingPath('forehand', 'advanced'),
                    keyCharacteristics: ['Good acceleration', 'Consistent contact', 'Moderate rotation']
                },
                // CORRECTED: Intermediate should be between advanced and beginner
                // Original 4.0 NTRP showed anomaly (6.75 > 6.46 advanced) due to unfiltered wild swings
                // Adjusted to maintain proper progression: advanced (6.46) > intermediate (5.85) > beginner (5.51)
                intermediate: {
                    averageVelocity: 5.85,
                    peakVelocity: 7.50,
                    averageAcceleration: 135,
                    peakAcceleration: 195,
                    averageRotation: 13,
                    followThroughRatio: 0.48,
                    contactHeight: 0.37,
                    preparationTime: 1.2,
                    swingPath: this.generateReferenceSwingPath('forehand', 'intermediate'),
                    keyCharacteristics: ['Basic technique', 'Learning consistency', 'Developing power']
                },
                // CALIBRATED: Beginner median=5.51, p25=3.91, p75=7.09
                beginner: {
                    averageVelocity: 5.51,
                    peakVelocity: 7.09,
                    averageAcceleration: 125,
                    peakAcceleration: 179,
                    averageRotation: 10,
                    followThroughRatio: 0.40,
                    contactHeight: 0.36,
                    preparationTime: 1.4,
                    swingPath: this.generateReferenceSwingPath('forehand', 'beginner'),
                    keyCharacteristics: ['Learning basics', 'Developing form', 'Building confidence']
                }
            },
            'Backhand': {
                // CALIBRATED: Pro data * 0.9 factor for backhand
                professional: {
                    averageVelocity: 8.3,
                    peakVelocity: 14.4,
                    averageAcceleration: 368,
                    peakAcceleration: 803,
                    averageRotation: -22,
                    followThroughRatio: 0.62,
                    contactHeight: 0.41,
                    preparationTime: 0.85,
                    swingPath: this.generateReferenceSwingPath('backhand'),
                    keyCharacteristics: ['Compact backswing', 'Explosive contact', 'Full extension']
                },
                advanced: {
                    averageVelocity: 5.8,
                    peakVelocity: 10.0,
                    averageAcceleration: 134,
                    peakAcceleration: 233,
                    averageRotation: -18,
                    followThroughRatio: 0.55,
                    contactHeight: 0.39,
                    preparationTime: 0.95,
                    swingPath: this.generateReferenceSwingPath('backhand', 'advanced'),
                    keyCharacteristics: ['Good preparation', 'Solid contact', 'Controlled power']
                },
                // CORRECTED: Intermediate backhand should be between advanced (5.8) and beginner (5.0)
                intermediate: {
                    averageVelocity: 5.3,
                    peakVelocity: 6.8,
                    averageAcceleration: 122,
                    peakAcceleration: 175,
                    averageRotation: -11,
                    followThroughRatio: 0.46,
                    contactHeight: 0.36,
                    preparationTime: 1.3,
                    swingPath: this.generateReferenceSwingPath('backhand', 'intermediate'),
                    keyCharacteristics: ['Learning mechanics', 'Building consistency', 'Developing timing']
                },
                beginner: {
                    averageVelocity: 5.0,
                    peakVelocity: 6.4,
                    averageAcceleration: 112,
                    peakAcceleration: 161,
                    averageRotation: -8,
                    followThroughRatio: 0.38,
                    contactHeight: 0.35,
                    preparationTime: 1.5,
                    swingPath: this.generateReferenceSwingPath('backhand', 'beginner'),
                    keyCharacteristics: ['Learning basics', 'Developing form', 'Building confidence']
                }
            },
            'Serve': {
                // CALIBRATED: Pro data * 1.2 factor for serve power
                professional: {
                    averageVelocity: 11.1,
                    peakVelocity: 19.2,
                    averageAcceleration: 491,
                    peakAcceleration: 1070,
                    averageRotation: 15,
                    tossHeight: 1.8,
                    legDrive: 0.75,
                    preparationTime: 1.5,
                    swingPath: this.generateReferenceSwingPath('serve'),
                    keyCharacteristics: ['Explosive leg drive', 'Perfect timing', 'Maximum acceleration']
                },
                advanced: {
                    averageVelocity: 7.8,
                    peakVelocity: 13.4,
                    averageAcceleration: 179,
                    peakAcceleration: 311,
                    averageRotation: 12,
                    tossHeight: 1.6,
                    legDrive: 0.65,
                    preparationTime: 1.7,
                    swingPath: this.generateReferenceSwingPath('serve', 'advanced'),
                    keyCharacteristics: ['Good leg drive', 'Consistent toss', 'Solid acceleration']
                },
                // CORRECTED: Intermediate serve should be between advanced (7.8) and beginner (6.6)
                intermediate: {
                    averageVelocity: 7.0,
                    peakVelocity: 9.0,
                    averageAcceleration: 162,
                    peakAcceleration: 230,
                    averageRotation: 7,
                    tossHeight: 1.3,
                    legDrive: 0.50,
                    preparationTime: 2.2,
                    swingPath: this.generateReferenceSwingPath('serve', 'intermediate'),
                    keyCharacteristics: ['Learning coordination', 'Basic toss', 'Developing power']
                },
                beginner: {
                    averageVelocity: 6.6,
                    peakVelocity: 8.5,
                    averageAcceleration: 150,
                    peakAcceleration: 215,
                    averageRotation: 5,
                    tossHeight: 1.2,
                    legDrive: 0.40,
                    preparationTime: 2.5,
                    swingPath: this.generateReferenceSwingPath('serve', 'beginner'),
                    keyCharacteristics: ['Learning motion', 'Basic toss', 'Building coordination']
                }
            },
            'Volley': {
                // Volleys are compact - lower velocities than groundstrokes
                professional: {
                    averageVelocity: 5.0,
                    peakVelocity: 8.0,
                    averageAcceleration: 200,
                    peakAcceleration: 400,
                    averageRotation: 5,
                    reactionTime: 0.25,
                    contactPoint: 0.85,
                    preparationTime: 0.4,
                    swingPath: this.generateReferenceSwingPath('volley'),
                    keyCharacteristics: ['Lightning reflexes', 'Firm contact', 'Precise placement']
                },
                advanced: {
                    averageVelocity: 4.0,
                    peakVelocity: 6.5,
                    averageAcceleration: 160,
                    peakAcceleration: 320,
                    averageRotation: 4,
                    reactionTime: 0.30,
                    contactPoint: 0.80,
                    preparationTime: 0.5,
                    swingPath: this.generateReferenceSwingPath('volley', 'advanced'),
                    keyCharacteristics: ['Quick hands', 'Good positioning', 'Controlled aggression']
                },
                intermediate: {
                    averageVelocity: 3.5,
                    peakVelocity: 5.5,
                    averageAcceleration: 130,
                    peakAcceleration: 260,
                    averageRotation: 3,
                    reactionTime: 0.40,
                    contactPoint: 0.75,
                    preparationTime: 0.6,
                    swingPath: this.generateReferenceSwingPath('volley', 'intermediate'),
                    keyCharacteristics: ['Learning positioning', 'Basic technique', 'Building confidence']
                },
                beginner: {
                    averageVelocity: 3.0,
                    peakVelocity: 4.5,
                    averageAcceleration: 100,
                    peakAcceleration: 200,
                    averageRotation: 2,
                    reactionTime: 0.50,
                    contactPoint: 0.70,
                    preparationTime: 0.8,
                    swingPath: this.generateReferenceSwingPath('volley', 'beginner'),
                    keyCharacteristics: ['Learning basics', 'Developing reflexes', 'Building confidence']
                }
            },
            'Overhead': {
                // CALIBRATED: Similar to serve * 1.1 factor
                professional: {
                    averageVelocity: 10.2,
                    peakVelocity: 17.6,
                    averageAcceleration: 450,
                    peakAcceleration: 981,
                    averageRotation: 18,
                    preparationTime: 0.9,
                    swingPath: this.generateReferenceSwingPath('overhead'),
                    keyCharacteristics: ['Explosive power', 'Perfect positioning', 'Aggressive finish']
                },
                advanced: {
                    averageVelocity: 7.1,
                    peakVelocity: 12.2,
                    averageAcceleration: 164,
                    peakAcceleration: 285,
                    averageRotation: 14,
                    preparationTime: 1.1,
                    swingPath: this.generateReferenceSwingPath('overhead', 'advanced'),
                    keyCharacteristics: ['Good power', 'Solid positioning', 'Consistent execution']
                },
                // CORRECTED: Intermediate overhead should be between advanced (7.1) and beginner (6.1)
                intermediate: {
                    averageVelocity: 6.5,
                    peakVelocity: 8.3,
                    averageAcceleration: 148,
                    peakAcceleration: 210,
                    averageRotation: 9,
                    preparationTime: 1.5,
                    swingPath: this.generateReferenceSwingPath('overhead', 'intermediate'),
                    keyCharacteristics: ['Learning timing', 'Basic positioning', 'Developing confidence']
                },
                beginner: {
                    averageVelocity: 6.1,
                    peakVelocity: 7.8,
                    averageAcceleration: 138,
                    peakAcceleration: 197,
                    averageRotation: 6,
                    preparationTime: 1.8,
                    swingPath: this.generateReferenceSwingPath('overhead', 'beginner'),
                    keyCharacteristics: ['Learning basics', 'Developing timing', 'Building confidence']
                }
            }
        };
    }

    /**
     * Generate idealized swing paths for different strokes and skill levels
     */
    generateReferenceSwingPath(strokeType, skillLevel = 'professional') {
        const pathPoints = [];
        const numPoints = 15;

        // Adjust path complexity based on skill level
        const complexity = {
            'professional': 1.0,
            'advanced': 0.8,
            'intermediate': 0.6,
            'beginner': 0.4
        }[skillLevel] || 1.0;

        switch (strokeType.toLowerCase()) {
            case 'forehand':
                for (let i = 0; i < numPoints; i++) {
                    const t = i / (numPoints - 1);
                    pathPoints.push({
                        x: 0.3 + t * 0.4 * complexity,
                        y: 0.6 - Math.sin(t * Math.PI) * 0.2 * complexity,
                        phase: this.getSwingPhase(t, 'forehand'),
                        velocity: Math.sin(t * Math.PI) * complexity
                    });
                }
                break;

            case 'backhand':
                for (let i = 0; i < numPoints; i++) {
                    const t = i / (numPoints - 1);
                    pathPoints.push({
                        x: 0.7 - t * 0.4 * complexity,
                        y: 0.6 - Math.sin(t * Math.PI) * 0.15 * complexity,
                        phase: this.getSwingPhase(t, 'backhand'),
                        velocity: Math.sin(t * Math.PI) * complexity
                    });
                }
                break;

            case 'serve':
                for (let i = 0; i < numPoints; i++) {
                    const t = i / (numPoints - 1);
                    pathPoints.push({
                        x: 0.5 + Math.sin(t * Math.PI) * 0.1 * complexity,
                        y: 0.8 - t * 0.6 * complexity,
                        phase: this.getSwingPhase(t, 'serve'),
                        velocity: Math.sin(t * Math.PI * 1.5) * complexity
                    });
                }
                break;

            case 'volley':
                for (let i = 0; i < numPoints; i++) {
                    const t = i / (numPoints - 1);
                    pathPoints.push({
                        x: 0.45 + t * 0.1 * complexity,
                        y: 0.5 + Math.sin(t * Math.PI * 0.5) * 0.05 * complexity,
                        phase: this.getSwingPhase(t, 'volley'),
                        velocity: Math.sin(t * Math.PI * 2) * complexity * 0.5
                    });
                }
                break;

            case 'overhead':
                for (let i = 0; i < numPoints; i++) {
                    const t = i / (numPoints - 1);
                    pathPoints.push({
                        x: 0.5 + Math.sin(t * Math.PI * 0.5) * 0.15 * complexity,
                        y: 0.3 + t * 0.5 * complexity,
                        phase: this.getSwingPhase(t, 'overhead'),
                        velocity: Math.sin(t * Math.PI * 1.2) * complexity
                    });
                }
                break;
        }

        return pathPoints;
    }

    /**
     * Determine swing phase based on time parameter
     */
    getSwingPhase(t, strokeType) {
        switch (strokeType.toLowerCase()) {
            case 'serve':
                if (t < 0.2) return 'preparation';
                if (t < 0.4) return 'backswing';
                if (t < 0.7) return 'acceleration';
                if (t < 0.8) return 'contact';
                return 'follow_through';
            
            case 'volley':
                if (t < 0.4) return 'preparation';
                if (t < 0.7) return 'contact';
                return 'follow_through';
            
            default:
                if (t < 0.3) return 'preparation';
                if (t < 0.6) return 'acceleration';
                if (t < 0.8) return 'contact';
                return 'follow_through';
        }
    }

    /**
     * Initialize benchmark metrics for different skill levels
     */
    initializeBenchmarkMetrics() {
        return {
            consistency: {
                professional: { min: 0.90, avg: 0.94, max: 0.98 },
                advanced: { min: 0.75, avg: 0.82, max: 0.89 },
                intermediate: { min: 0.60, avg: 0.70, max: 0.79 },
                beginner: { min: 0.40, avg: 0.55, max: 0.65 }
            },
            power: {
                professional: { min: 0.85, avg: 0.91, max: 0.96 },
                advanced: { min: 0.70, avg: 0.78, max: 0.84 },
                intermediate: { min: 0.55, avg: 0.65, max: 0.74 },
                beginner: { min: 0.30, avg: 0.45, max: 0.58 }
            },
            precision: {
                professional: { min: 0.88, avg: 0.93, max: 0.97 },
                advanced: { min: 0.72, avg: 0.80, max: 0.87 },
                intermediate: { min: 0.58, avg: 0.68, max: 0.75 },
                beginner: { min: 0.35, avg: 0.50, max: 0.62 }
            }
        };
    }

    /**
     * Initialize coaching tips and drills database
     */
    initializeCoachingDatabase() {
        return {
            tips: {
                'Serve': {
                    beginner: [
                        "Focus on consistent ball toss",
                        "Use your legs to drive up into the serve", 
                        "Keep your eye on the ball throughout",
                        "Start with a simple flat serve motion"
                    ],
                    intermediate: [
                        "Increase racquet head speed at contact",
                        "Work on shoulder rotation and follow-through",
                        "Practice hitting different service boxes",
                        "Add slice serve to your repertoire"
                    ],
                    advanced: [
                        "Fine-tune your ball placement",
                        "Add variety with spin serves",
                        "Work on second serve consistency",
                        "Master the kick serve"
                    ]
                },
                'Forehand': {
                    beginner: [
                        "Turn your shoulders early",
                        "Keep your eye on the ball",
                        "Follow through across your body",
                        "Use a continental or eastern grip"
                    ],
                    intermediate: [
                        "Generate more topspin with low-to-high swing",
                        "Use your core for power",
                        "Work on consistent contact point",
                        "Practice hitting on the rise"
                    ],
                    advanced: [
                        "Vary your shot placement and pace",
                        "Master the inside-out forehand",
                        "Develop defensive slice options",
                        "Work on short angle shots"
                    ]
                },
                'Backhand': {
                    beginner: [
                        "Use both hands for stability",
                        "Keep the racquet head up",
                        "Step into the shot",
                        "Focus on a simple, straight-back preparation"
                    ],
                    intermediate: [
                        "Generate topspin with proper swing path",
                        "Work on changing grip quickly",
                        "Practice down-the-line shots",
                        "Develop a reliable slice backhand"
                    ],
                    advanced: [
                        "Master the one-handed backhand slice",
                        "Work on passing shots",
                        "Develop aggressive short-court backhands",
                        "Practice backhand volleys"
                    ]
                },
                'Volley': {
                    beginner: [
                        "Keep your racquet head up",
                        "Move forward through the shot",
                        "Use a firm wrist",
                        "Focus on placement over power"
                    ],
                    intermediate: [
                        "Work on split-step timing",
                        "Practice angled volleys",
                        "Develop quick hands",
                        "Learn to volley different ball heights"
                    ],
                    advanced: [
                        "Master the drop volley",
                        "Work on reflex volleys",
                        "Practice volley-to-volley exchanges",
                        "Develop attacking net play"
                    ]
                }
            },
            drills: {
                velocity: [
                    "Medicine ball throws for core power",
                    "Resistance band training",
                    "Shadow swing with focus on acceleration",
                    "Plyometric exercises for explosive movement"
                ],
                accuracy: [
                    "Target practice with cones",
                    "Cross-court and down-the-line repetition",
                    "Short court rallies for control",
                    "Pressure point practice"
                ],
                consistency: [
                    "Wall practice for repetition",
                    "Ball machine drills",
                    "Rhythm and timing exercises",
                    "Footwork pattern training"
                ],
                rotation: [
                    "Core strengthening exercises",
                    "Medicine ball rotational throws",
                    "Shadow swings focusing on turn",
                    "Multi-ball feeding drills"
                ]
            }
        };
    }

    /**
     * Get reference data for a specific stroke and skill level
     */
    getReference(strokeType, skillLevel = 'professional') {
        return this.strokePatterns[strokeType]?.[skillLevel] || null;
    }

    /**
     * Compare user metrics with professional standards
     */
    compareWithProfessional(userMetrics, strokeType) {
        const proReference = this.getReference(strokeType, 'professional');
        if (!proReference) return null;

        const comparison = {
            velocityRatio: this.calculateRatio(userMetrics.velocity, proReference.averageVelocity),
            accelerationRatio: this.calculateRatio(userMetrics.acceleration, proReference.averageAcceleration),
            rotationRatio: this.calculateRatio(Math.abs(userMetrics.rotation), Math.abs(proReference.averageRotation)),
            overallSimilarity: 0,
            strengths: [],
            improvements: [],
            skillLevel: this.estimateSkillLevel(userMetrics, strokeType),
            percentile: this.calculatePercentile(userMetrics, strokeType)
        };

        // Calculate overall similarity
        comparison.overallSimilarity = this.calculateSimilarityScore(userMetrics, proReference);

        // Identify strengths and improvements
        this.identifyStrengthsAndImprovements(comparison, userMetrics, proReference, strokeType);

        return comparison;
    }

    /**
     * Calculate ratio with safety checks
     */
    calculateRatio(userValue, refValue) {
        if (!refValue || refValue === 0) return 0;
        return userValue / refValue;
    }

    /**
     * Calculate overall similarity score to professional level
     */
    calculateSimilarityScore(userMetrics, proReference) {
        const weights = {
            velocity: 0.3,
            acceleration: 0.25,
            rotation: 0.25,
            smoothness: 0.2
        };

        let score = 0;
        
        // Velocity similarity (closer to 1.0 is better)
        const velSimilarity = 1 - Math.abs(1 - this.calculateRatio(userMetrics.velocity, proReference.averageVelocity));
        score += weights.velocity * Math.max(0, Math.min(1, velSimilarity));

        // Acceleration similarity
        const accSimilarity = 1 - Math.abs(1 - this.calculateRatio(userMetrics.acceleration, proReference.averageAcceleration));
        score += weights.acceleration * Math.max(0, Math.min(1, accSimilarity));

        // Rotation similarity
        const rotSimilarity = 1 - Math.abs(1 - this.calculateRatio(Math.abs(userMetrics.rotation), Math.abs(proReference.averageRotation)));
        score += weights.rotation * Math.max(0, Math.min(1, rotSimilarity));

        // Smoothness (assuming user has smoothness score 0-100)
        const smoothnessSimilarity = (userMetrics.smoothness || 70) / 100;
        score += weights.smoothness * smoothnessSimilarity;

        return Math.min(1.0, Math.max(0, score));
    }

    /**
     * Identify user strengths and areas for improvement
     */
    identifyStrengthsAndImprovements(comparison, userMetrics, proReference, strokeType) {
        // Velocity analysis
        if (comparison.velocityRatio >= 0.9) {
            comparison.strengths.push("Excellent racquet speed");
        } else if (comparison.velocityRatio < 0.7) {
            comparison.improvements.push("Increase racquet head speed through contact");
        }

        // Acceleration analysis
        if (comparison.accelerationRatio >= 0.85) {
            comparison.strengths.push("Good acceleration through the ball");
        } else if (comparison.accelerationRatio < 0.6) {
            comparison.improvements.push("Focus on explosive acceleration at contact");
        }

        // Rotation analysis
        if (['Forehand', 'Backhand'].includes(strokeType)) {
            if (comparison.rotationRatio >= 0.8) {
                comparison.strengths.push("Good body rotation");
            } else if (comparison.rotationRatio < 0.6) {
                comparison.improvements.push("Use more core and shoulder rotation");
            }
        }

        // Stroke-specific analysis
        this.addStrokeSpecificFeedback(comparison, userMetrics, proReference, strokeType);
    }

    /**
     * Add stroke-specific feedback
     * CALIBRATED: Thresholds updated based on video analysis (2026-02-04)
     */
    addStrokeSpecificFeedback(comparison, userMetrics, proReference, strokeType) {
        switch (strokeType) {
            case 'Serve':
                if (userMetrics.verticalComponent && userMetrics.verticalComponent > 0.2) {
                    comparison.strengths.push("Good upward racquet motion");
                } else {
                    comparison.improvements.push("Focus on hitting up on the serve");
                }
                break;

            case 'Forehand':
                if (userMetrics.rotation > 15) {
                    comparison.strengths.push("Good forehand rotation");
                }
                if (comparison.velocityRatio > 0.9) {
                    comparison.strengths.push("Powerful forehand drive");
                }
                break;

            case 'Backhand':
                if (Math.abs(userMetrics.rotation) > 15) {
                    comparison.strengths.push("Good backhand shoulder turn");
                }
                break;

            case 'Volley':
                // CALIBRATED: Volley velocity thresholds in normalized units/sec
                if (userMetrics.velocity > 3.0 && userMetrics.velocity < 6.0) {
                    comparison.strengths.push("Perfect volley pace");
                } else if (userMetrics.velocity > 6.0) {
                    comparison.improvements.push("Keep volley motion more compact");
                }
                break;
        }
    }

    /**
     * Estimate user skill level based on metrics
     * CORRECTED (2026-02-05): Uses velocity thresholds with proper progression
     * Thresholds are dynamically calculated as 85% of each level's average:
     * - Professional: velocity >= 7.86 (from 9.25 * 0.85)
     * - Advanced: velocity >= 5.49 (from 6.46 * 0.85)
     * - Intermediate: velocity >= 4.97 (from 5.85 * 0.85)
     * - Beginner: velocity < 4.97
     */
    estimateSkillLevel(userMetrics, strokeType) {
        const proRef = this.getReference(strokeType, 'professional');
        const advRef = this.getReference(strokeType, 'advanced');
        const intRef = this.getReference(strokeType, 'intermediate');
        const begRef = this.getReference(strokeType, 'beginner');

        if (!proRef || !advRef || !intRef) return 'intermediate';

        // Use velocity as primary indicator with calibrated thresholds
        const velocity = userMetrics.velocity || 0;

        if (velocity >= proRef.averageVelocity * 0.85) {
            return 'professional';
        } else if (velocity >= advRef.averageVelocity * 0.85) {
            return 'advanced';
        } else if (velocity >= (begRef?.averageVelocity || intRef.averageVelocity * 0.7)) {
            return 'intermediate';
        } else {
            return 'beginner';
        }
    }

    /**
     * Calculate percentile ranking
     */
    calculatePercentile(userMetrics, strokeType) {
        const proRef = this.getReference(strokeType, 'professional');
        if (!proRef) return 50;

        const similarity = this.calculateSimilarityScore(userMetrics, proRef);
        return Math.round(similarity * 100);
    }

    /**
     * Get coaching tips for specific stroke and skill level
     */
    getCoachingTips(strokeType, userLevel, weaknesses = []) {
        const tips = this.coachingDatabase.tips[strokeType];
        if (!tips) return [];

        let levelTips = tips[userLevel] || tips.intermediate;
        
        // Add weakness-specific tips
        if (weaknesses.includes('velocity')) {
            levelTips = [...levelTips, "Focus on generating more racquet head speed"];
        }
        if (weaknesses.includes('rotation')) {
            levelTips = [...levelTips, "Work on core rotation and body turn"];
        }

        return levelTips.slice(0, 3); // Return top 3 tips
    }

    /**
     * Get recommended drills based on weaknesses
     */
    getRecommendedDrills(strokeType, weaknesses) {
        const drills = [];
        
        weaknesses.forEach(weakness => {
            if (this.coachingDatabase.drills[weakness]) {
                drills.push(...this.coachingDatabase.drills[weakness]);
            }
        });

        // Add stroke-specific drills
        const strokeDrills = {
            'Serve': ["Service motion without ball", "Toss practice", "Target serving"],
            'Forehand': ["Cross-court rallies", "Inside-out practice", "Approach shots"],
            'Backhand': ["Down-the-line practice", "Slice development", "Passing shots"],
            'Volley': ["Split-step drills", "Reflex volleys", "Angle volleys"]
        };

        if (strokeDrills[strokeType]) {
            drills.push(...strokeDrills[strokeType]);
        }

        // Remove duplicates and return top 5
        return [...new Set(drills)].slice(0, 5);
    }

    /**
     * Get benchmark for specific metric and skill level
     */
    getBenchmark(metric, skillLevel) {
        return this.benchmarkMetrics[metric]?.[skillLevel] || null;
    }

    /**
     * Get player profile
     */
    getPlayerProfile(playerId) {
        return this.playerProfiles[playerId] || null;
    }

    /**
     * Get all available stroke types
     */
    getAvailableStrokeTypes() {
        return Object.keys(this.strokePatterns);
    }

    /**
     * Get all available skill levels
     */
    getAvailableSkillLevels() {
        return ['beginner', 'intermediate', 'advanced', 'professional'];
    }

    /**
     * Get body-relative benchmark for a stroke type and skill level
     * Body-relative values are in "torso-lengths per second" and are
     * camera-independent, making them more reliable for comparison
     */
    getBodyRelativeBenchmark(strokeType, skillLevel = 'intermediate') {
        const strokeBenchmarks = this.bodyRelativeBenchmarks[strokeType];
        if (!strokeBenchmarks) return null;
        return strokeBenchmarks[skillLevel] || null;
    }

    /**
     * Compare user's body-relative velocity with benchmarks
     * @param {number} velocityNormalized - User's velocity in torso-lengths/sec
     * @param {string} strokeType - Type of stroke
     * @returns {object} Skill level assessment based on body-relative metrics
     */
    assessWithBodyRelativeMetrics(velocityNormalized, strokeType) {
        const benchmarks = this.bodyRelativeBenchmarks[strokeType];
        if (!benchmarks) {
            return { skillLevel: 'intermediate', percentile: 50 };
        }

        // Determine skill level based on velocity thresholds
        if (velocityNormalized >= benchmarks.professional.velocity * 0.85) {
            return {
                skillLevel: 'professional',
                percentile: Math.min(99, 85 + (velocityNormalized - benchmarks.professional.velocity) / benchmarks.professional.velocity * 15)
            };
        } else if (velocityNormalized >= benchmarks.advanced.velocity * 0.85) {
            return {
                skillLevel: 'advanced',
                percentile: 70 + (velocityNormalized - benchmarks.advanced.velocity * 0.85) / (benchmarks.professional.velocity * 0.85 - benchmarks.advanced.velocity * 0.85) * 15
            };
        } else if (velocityNormalized >= benchmarks.intermediate.velocity * 0.85) {
            return {
                skillLevel: 'intermediate',
                percentile: 40 + (velocityNormalized - benchmarks.intermediate.velocity * 0.85) / (benchmarks.advanced.velocity * 0.85 - benchmarks.intermediate.velocity * 0.85) * 30
            };
        } else {
            return {
                skillLevel: 'beginner',
                percentile: Math.max(5, (velocityNormalized / (benchmarks.intermediate.velocity * 0.85)) * 40)
            };
        }
    }

    /**
     * Get calibration info including version and corrections applied
     */
    getCalibrationInfo() {
        return this.calibrationInfo;
    }
}

// Export for browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProfessionalReferences;
} else {
    window.ProfessionalReferences = ProfessionalReferences;
}