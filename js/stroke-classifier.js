/**
 * Stroke Classification and Quality Assessment Module
 * Classifies tennis strokes and evaluates technique quality
 */

class StrokeClassifier {
    constructor() {
        // Thresholds for stroke detection and classification
        // CALIBRATED: Based on 243 pro strokes from court-level video (2026-02-04)
        this.strokeThresholds = {
            minVelocity: 2.75,        // Calibrated: p10 * 0.8 = 3.44 * 0.8
            minAcceleration: 108.5,   // Calibrated: p10 * 0.8
            serveVerticalThreshold: 0.25,
            overheadVerticalThreshold: 0.2,
            volleyVerticalThreshold: 0.1,
            rotationThreshold: 15
        };

        // Quality assessment weights
        this.qualityWeights = {
            velocity: 0.35,
            acceleration: 0.25,
            rotation: 0.20,
            smoothness: 0.20
        };

        // Stroke-specific velocity thresholds (normalized units per second)
        // CALIBRATED: Based on 243 pro strokes - median=9.25, p25=5.28, p75=16.04
        this.velocityThresholds = {
            'Serve': { average: 11.1, good: 6.3, excellent: 19.2 },      // 1.2x groundstroke
            'Forehand': { average: 9.25, good: 5.28, excellent: 16.04 }, // Calibrated median/p25/p75
            'Backhand': { average: 8.3, good: 4.75, excellent: 14.4 },   // 0.9x forehand
            'Volley': { average: 5.0, good: 3.0, excellent: 8.0 },       // Compact strokes
            'Overhead': { average: 10.2, good: 5.8, excellent: 17.6 },   // 1.1x forehand
            'Groundstroke': { average: 9.25, good: 5.28, excellent: 16.04 }
        };

        // Stroke-specific acceleration thresholds (normalized units per second²)
        // CALIBRATED: Based on 243 pro strokes - median=409, p25=227, p75=892
        this.accelerationThresholds = {
            'Serve': { average: 491, good: 272, excellent: 1070 },        // 1.2x groundstroke
            'Forehand': { average: 409, good: 227, excellent: 892 },      // Calibrated median/p25/p75
            'Backhand': { average: 368, good: 204, excellent: 803 },      // 0.9x forehand
            'Volley': { average: 200, good: 120, excellent: 400 },        // Compact strokes
            'Overhead': { average: 450, good: 250, excellent: 981 },      // 1.1x forehand
            'Groundstroke': { average: 409, good: 227, excellent: 892 }
        };
    }

    /**
     * Main stroke classification method
     */
    classifyStroke(velocity, acceleration, rotation, verticalMotion) {
        // Primary classification based on motion characteristics
        if (this.isServe(velocity, verticalMotion)) {
            return 'Serve';
        } else if (this.isOverhead(velocity, verticalMotion)) {
            return 'Overhead';
        } else if (this.isVolley(velocity, verticalMotion)) {
            return 'Volley';
        } else if (this.isForehand(rotation, velocity)) {
            return 'Forehand';
        } else if (this.isBackhand(rotation, velocity)) {
            return 'Backhand';
        } else {
            return 'Groundstroke';
        }
    }

    /**
     * Stroke type detection methods
     */
    isServe(velocity, verticalMotion) {
        return verticalMotion > this.strokeThresholds.serveVerticalThreshold && 
               velocity.magnitude > 0.04;
    }

    isOverhead(velocity, verticalMotion) {
        return verticalMotion > this.strokeThresholds.overheadVerticalThreshold && 
               velocity.magnitude > 0.03;
    }

    isVolley(velocity, verticalMotion) {
        return verticalMotion < this.strokeThresholds.volleyVerticalThreshold && 
               velocity.magnitude > this.strokeThresholds.minVelocity &&
               velocity.magnitude < 0.045; // Volleys are typically more compact
    }

    isForehand(rotation, velocity) {
        return rotation > this.strokeThresholds.rotationThreshold && 
               velocity.magnitude > this.strokeThresholds.minVelocity;
    }

    isBackhand(rotation, velocity) {
        return rotation < -this.strokeThresholds.rotationThreshold && 
               velocity.magnitude > this.strokeThresholds.minVelocity;
    }

    /**
     * Comprehensive stroke quality assessment
     */
    assessStrokeQuality(strokeType, velocity, acceleration, rotation, swingPath) {
        const scores = {
            velocity: this.assessVelocity(velocity.magnitude, strokeType),
            acceleration: this.assessAcceleration(acceleration.magnitude, strokeType),
            rotation: this.assessRotation(rotation, strokeType),
            smoothness: this.assessSmoothness(swingPath),
            technique: this.assessTechnique(strokeType, velocity, acceleration, rotation)
        };

        // Calculate weighted overall score
        const overallScore = (
            scores.velocity * this.qualityWeights.velocity +
            scores.acceleration * this.qualityWeights.acceleration +
            scores.rotation * this.qualityWeights.rotation +
            scores.smoothness * this.qualityWeights.smoothness
        );

        // Add technique bonus
        const finalScore = Math.min(100, overallScore + scores.technique);

        return {
            overall: Math.round(finalScore),
            breakdown: scores,
            feedback: this.generateQualityFeedback(scores, strokeType)
        };
    }

    /**
     * Velocity assessment
     */
    assessVelocity(magnitude, strokeType) {
        const thresholds = this.velocityThresholds[strokeType] || this.velocityThresholds['Groundstroke'];
        
        if (magnitude >= thresholds.excellent) return 100;
        if (magnitude >= thresholds.good) {
            return 75 + (magnitude - thresholds.good) / (thresholds.excellent - thresholds.good) * 25;
        }
        if (magnitude >= thresholds.average) {
            return 50 + (magnitude - thresholds.average) / (thresholds.good - thresholds.average) * 25;
        }
        
        return Math.max(20, (magnitude / thresholds.average) * 50);
    }

    /**
     * Acceleration assessment
     */
    assessAcceleration(magnitude, strokeType) {
        const thresholds = this.accelerationThresholds[strokeType] || this.accelerationThresholds['Groundstroke'];
        
        if (magnitude >= thresholds.excellent) return 100;
        if (magnitude >= thresholds.good) {
            return 75 + (magnitude - thresholds.good) / (thresholds.excellent - thresholds.good) * 25;
        }
        if (magnitude >= thresholds.average) {
            return 50 + (magnitude - thresholds.average) / (thresholds.good - thresholds.average) * 25;
        }
        
        return Math.max(20, (magnitude / thresholds.average) * 50);
    }

    /**
     * Rotation assessment
     */
    assessRotation(rotation, strokeType) {
        const absRotation = Math.abs(rotation);
        
        switch (strokeType) {
            case 'Forehand':
            case 'Backhand':
                if (absRotation >= 25) return 100;
                if (absRotation >= 18) return 80;
                if (absRotation >= 10) return 60;
                return Math.max(20, (absRotation / 10) * 60);
            
            case 'Serve':
                if (absRotation >= 20) return 100;
                if (absRotation >= 12) return 75;
                return Math.max(40, (absRotation / 12) * 75);
            
            case 'Volley':
                // Volleys don't require as much rotation
                if (absRotation <= 8) return 100;
                if (absRotation <= 15) return 80;
                return Math.max(60, 100 - (absRotation - 8) * 5);
            
            default:
                return 70; // Neutral score for unclassified strokes
        }
    }

    /**
     * Smoothness assessment
     */
    assessSmoothness(swingPath) {
        if (!swingPath || swingPath.length < 3) return 50;
        
        const smoothness = this.calculatePathSmoothness(swingPath);
        return Math.max(30, smoothness);
    }

    /**
     * Calculate swing path smoothness
     */
    calculatePathSmoothness(pathPoints) {
        if (pathPoints.length < 3) return 50;
        
        let totalCurvature = 0;
        let validPoints = 0;

        for (let i = 1; i < pathPoints.length - 1; i++) {
            const p1 = pathPoints[i - 1];
            const p2 = pathPoints[i];
            const p3 = pathPoints[i + 1];
            
            // Calculate curvature at each point
            const curvature = this.calculateCurvature(p1, p2, p3);
            if (curvature !== null) {
                totalCurvature += curvature;
                validPoints++;
            }
        }

        if (validPoints === 0) return 50;
        
        const avgCurvature = totalCurvature / validPoints;
        
        // Convert curvature to smoothness score (lower curvature = higher smoothness)
        return Math.max(20, 100 - (avgCurvature * 1000));
    }

    /**
     * Calculate curvature at a point using three consecutive points
     */
    calculateCurvature(p1, p2, p3) {
        const dx1 = p2.x - p1.x;
        const dy1 = p2.y - p1.y;
        const dx2 = p3.x - p2.x;
        const dy2 = p3.y - p2.y;
        
        const cross = dx1 * dy2 - dy1 * dx2;
        const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        
        if (dist1 === 0 || dist2 === 0) return null;
        
        return Math.abs(cross) / (dist1 * dist2);
    }

    /**
     * Stroke-specific technique assessment
     */
    assessTechnique(strokeType, velocity, acceleration, rotation) {
        let bonus = 0;
        
        switch (strokeType) {
            case 'Serve':
                // Reward upward motion and explosive acceleration
                if (velocity.components.y < -0.02 && acceleration.magnitude > 0.015) {
                    bonus += 10;
                }
                break;
                
            case 'Forehand':
                // Reward proper rotation and follow-through
                if (rotation > 18 && velocity.magnitude > 0.04) {
                    bonus += 10;
                }
                // Reward forward motion
                if (velocity.components.x > 0.02) {
                    bonus += 5;
                }
                break;
                
            case 'Backhand':
                // Reward controlled power and rotation
                if (rotation < -18 && acceleration.magnitude > 0.012) {
                    bonus += 10;
                }
                break;
                
            case 'Volley':
                // Reward compact, controlled motion
                if (velocity.magnitude > 0.02 && velocity.magnitude < 0.04 && acceleration.magnitude > 0.008) {
                    bonus += 10;
                }
                break;
                
            case 'Overhead':
                // Reward aggressive downward motion
                if (velocity.components.y > 0.03 && acceleration.magnitude > 0.015) {
                    bonus += 10;
                }
                break;
        }
        
        return bonus;
    }

    /**
     * Generate comprehensive quality feedback
     */
    generateQualityFeedback(scores, strokeType) {
        const feedback = [];
        
        // Velocity feedback
        if (scores.velocity < 60) {
            feedback.push(this.getVelocityFeedback(strokeType, false));
        } else if (scores.velocity > 85) {
            feedback.push(this.getVelocityFeedback(strokeType, true));
        }
        
        // Acceleration feedback
        if (scores.acceleration < 50) {
            feedback.push("Focus on accelerating through contact");
        }
        
        // Rotation feedback
        if (scores.rotation < 60 && (strokeType === 'Forehand' || strokeType === 'Backhand')) {
            feedback.push("Use more body rotation for power");
        }
        
        // Smoothness feedback
        if (scores.smoothness < 70) {
            feedback.push("Work on swing smoothness and consistency");
        }
        
        // Add stroke-specific feedback
        feedback.push(...this.getStrokeSpecificFeedback(strokeType, scores));
        
        return feedback.length > 0 ? feedback.join('. ') + '.' : this.getPositiveFeedback(strokeType);
    }

    /**
     * Velocity-specific feedback
     */
    getVelocityFeedback(strokeType, isGood) {
        const feedbackMap = {
            positive: {
                'Serve': 'Excellent racquet speed on serve!',
                'Forehand': 'Great pace on that forehand!',
                'Backhand': 'Powerful backhand drive!',
                'Volley': 'Perfect volley tempo!',
                'Overhead': 'Explosive overhead!',
                'default': 'Excellent racquet speed!'
            },
            improvement: {
                'Serve': 'Increase racquet speed through service motion',
                'Forehand': 'Accelerate more through the forehand',
                'Backhand': 'Drive through the backhand with more pace',
                'Volley': 'Quick, firm volley motion needed',
                'Overhead': 'Accelerate aggressively on overheads',
                'default': 'Focus on generating more racquet speed'
            }
        };
        
        const map = isGood ? feedbackMap.positive : feedbackMap.improvement;
        return map[strokeType] || map.default;
    }

    /**
     * Stroke-specific feedback
     */
    getStrokeSpecificFeedback(strokeType, scores) {
        const feedback = [];
        
        switch (strokeType) {
            case 'Serve':
                if (scores.technique < 5) {
                    feedback.push("Focus on upward racquet motion and leg drive");
                }
                break;
                
            case 'Forehand':
                if (scores.rotation < 70) {
                    feedback.push("Turn shoulders more through contact");
                }
                break;
                
            case 'Backhand':
                if (scores.rotation < 70) {
                    feedback.push("Emphasize shoulder turn and weight transfer");
                }
                break;
                
            case 'Volley':
                if (scores.velocity > 90) {
                    feedback.push("Good firm volley - maintain that contact point");
                } else {
                    feedback.push("Keep volley motion compact and controlled");
                }
                break;
                
            case 'Overhead':
                if (scores.technique < 5) {
                    feedback.push("Position early and attack aggressively");
                }
                break;
        }
        
        return feedback;
    }

    /**
     * Positive reinforcement feedback
     */
    getPositiveFeedback(strokeType) {
        const positiveMap = {
            'Serve': 'Good serving technique! Keep practicing your consistency.',
            'Forehand': 'Solid forehand form! Focus on maintaining this level.',
            'Backhand': 'Nice backhand technique! Great control and timing.',
            'Volley': 'Excellent net play! Stay aggressive at the net.',
            'Overhead': 'Good overhead positioning! Keep attacking those lobs.',
            'default': 'Good technique! Keep up the consistent practice.'
        };
        
        return positiveMap[strokeType] || positiveMap.default;
    }

    /**
     * Estimate ball speed from racquet velocity
     */
    estimateBallSpeed(velocity) {
        // Convert normalized velocity to estimated ball speed in mph
        // This is a rough approximation based on typical racquet-ball energy transfer
        const baseSpeed = 35;
        const velocityMultiplier = 500;
        
        const estimatedSpeed = baseSpeed + (velocity.magnitude * velocityMultiplier);
        return Math.round(Math.max(20, Math.min(120, estimatedSpeed))); // Realistic bounds
    }

    /**
     * Update classification thresholds
     */
    updateThresholds(newThresholds) {
        this.strokeThresholds = { ...this.strokeThresholds, ...newThresholds };
    }

    /**
     * Get current thresholds
     */
    getThresholds() {
        return { ...this.strokeThresholds };
    }

    /**
     * Check if motion qualifies as a stroke
     */
    isValidStroke(velocity, acceleration) {
        return velocity.magnitude > this.strokeThresholds.minVelocity &&
               acceleration.magnitude > this.strokeThresholds.minAcceleration;
    }
}

// Export for browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StrokeClassifier;
} else {
    window.StrokeClassifier = StrokeClassifier;
}