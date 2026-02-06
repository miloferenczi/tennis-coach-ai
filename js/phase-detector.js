/**
 * Phase Detector
 * Segments tennis strokes into biomechanical phases using velocity and acceleration patterns
 * Phases: preparation → loading → acceleration → contact → follow-through
 */

class PhaseDetector {
    constructor() {
        // Velocity thresholds for phase detection (normalized 0-1 scale)
        this.thresholds = {
            preparation: {
                maxVelocity: 0.015,
                accelerationTrend: 'increasing'
            },
            loading: {
                velocityDirection: 'backward',
                rotationIncreasing: true
            },
            acceleration: {
                minVelocity: 0.020,
                minAcceleration: 0.010,
                velocityTrend: 'rapidly_increasing'
            },
            contact: {
                peakVelocity: true,
                accelerationPeak: true
            },
            followThrough: {
                velocityTrend: 'decreasing',
                minDuration: 8 // frames
            }
        };
    }

    /**
     * Segment a stroke sequence into phases
     * Returns indices marking phase boundaries
     */
    detectPhases(poseHistory) {
        if (poseHistory.length < 20) {
            return null; // Not enough data
        }

        // Extract velocity profile
        const velocities = poseHistory.map(p => p.velocity.magnitude);
        const accelerations = poseHistory.map(p => p.acceleration?.magnitude || 0);

        // Find contact point (peak velocity)
        const contactIndex = this.findContactPoint(velocities, accelerations);
        
        if (contactIndex === -1) {
            return null;
        }

        // Work backwards from contact to find preparation and loading
        const loadingStart = this.findLoadingStart(poseHistory, contactIndex);
        const preparationStart = this.findPreparationStart(poseHistory, loadingStart);
        const accelerationStart = this.findAccelerationStart(poseHistory, loadingStart, contactIndex);
        
        // Work forwards from contact to find follow-through end
        const followThroughEnd = this.findFollowThroughEnd(poseHistory, contactIndex);

        return {
            preparation: { start: preparationStart, end: loadingStart },
            loading: { start: loadingStart, end: accelerationStart },
            acceleration: { start: accelerationStart, end: contactIndex },
            contact: { start: contactIndex, end: contactIndex + 1 },
            followThrough: { start: contactIndex + 1, end: followThroughEnd },
            
            // Metadata
            totalFrames: poseHistory.length,
            contactFrame: contactIndex,
            
            // Phase durations
            durations: {
                preparation: loadingStart - preparationStart,
                loading: accelerationStart - loadingStart,
                acceleration: contactIndex - accelerationStart,
                followThrough: followThroughEnd - contactIndex
            }
        };
    }

    /**
     * Find contact point (peak velocity with confirmed acceleration)
     */
    findContactPoint(velocities, accelerations) {
        let peakIndex = -1;
        let peakValue = 0;

        // Find peak velocity in the sequence
        for (let i = 5; i < velocities.length - 5; i++) {
            if (velocities[i] > peakValue && velocities[i] > 0.025) {
                // Confirm it's a true peak (higher than neighbors)
                if (velocities[i] > velocities[i-1] && velocities[i] > velocities[i+1]) {
                    // Confirm there was acceleration leading to it
                    const hasAcceleration = accelerations[i] > 0.008 || 
                                          accelerations[i-1] > 0.008;
                    if (hasAcceleration) {
                        peakValue = velocities[i];
                        peakIndex = i;
                    }
                }
            }
        }

        return peakIndex;
    }

    /**
     * Find where loading phase starts (backward motion, increasing rotation)
     */
    findLoadingStart(poseHistory, contactIndex) {
        // Work backwards from contact
        for (let i = contactIndex - 1; i >= 5; i--) {
            const velocity = poseHistory[i].velocity.magnitude;
            const rotation = Math.abs(poseHistory[i].rotation || 0);
            
            // Loading characterized by low velocity and building rotation
            if (velocity < 0.015) {
                // Check if rotation is increasing (coiling)
                const prevRotation = Math.abs(poseHistory[i-2]?.rotation || 0);
                if (rotation > prevRotation) {
                    return i;
                }
            }
        }
        
        // Fallback: 60% back from contact
        return Math.max(0, Math.floor(contactIndex * 0.4));
    }

    /**
     * Find where preparation phase starts
     */
    findPreparationStart(poseHistory, loadingStart) {
        // Work backwards from loading
        for (let i = loadingStart - 1; i >= 0; i--) {
            const velocity = poseHistory[i].velocity.magnitude;
            
            // Preparation is very low velocity (ready position)
            if (velocity < 0.010) {
                return i;
            }
        }
        
        // Return beginning of sequence
        return 0;
    }

    /**
     * Find where acceleration phase starts
     */
    findAccelerationStart(poseHistory, loadingStart, contactIndex) {
        // Work forward from loading toward contact
        for (let i = loadingStart; i < contactIndex; i++) {
            const velocity = poseHistory[i].velocity.magnitude;
            const acceleration = poseHistory[i].acceleration?.magnitude || 0;
            
            // Acceleration phase: rapid velocity increase
            if (velocity > 0.020 && acceleration > 0.010) {
                return i;
            }
        }
        
        // Fallback: midpoint between loading and contact
        return Math.floor((loadingStart + contactIndex) / 2);
    }

    /**
     * Find where follow-through ends
     */
    findFollowThroughEnd(poseHistory, contactIndex) {
        const minFollowThrough = 8; // At least 8 frames
        
        // Work forward from contact
        for (let i = contactIndex + minFollowThrough; i < poseHistory.length; i++) {
            const velocity = poseHistory[i].velocity.magnitude;
            
            // Follow-through ends when velocity drops significantly
            if (velocity < 0.015) {
                return i;
            }
        }
        
        // Return end of sequence
        return poseHistory.length - 1;
    }

    /**
     * Validate phase segmentation
     */
    validatePhases(phases) {
        if (!phases) return false;
        
        // Check all phases are present
        const requiredPhases = ['preparation', 'loading', 'acceleration', 'contact', 'followThrough'];
        for (const phase of requiredPhases) {
            if (!phases[phase]) return false;
        }
        
        // Check phases are sequential
        if (phases.loading.start <= phases.preparation.start) return false;
        if (phases.acceleration.start <= phases.loading.start) return false;
        if (phases.contact.start <= phases.acceleration.start) return false;
        if (phases.followThrough.start <= phases.contact.start) return false;
        
        // Check minimum durations
        if (phases.durations.acceleration < 3) return false; // Too short
        if (phases.durations.followThrough < 5) return false; // Too short
        
        return true;
    }

    /**
     * Extract phase data from pose history
     */
    extractPhaseData(poseHistory, phases) {
        if (!this.validatePhases(phases)) {
            return null;
        }

        return {
            preparation: poseHistory.slice(phases.preparation.start, phases.preparation.end),
            loading: poseHistory.slice(phases.loading.start, phases.loading.end),
            acceleration: poseHistory.slice(phases.acceleration.start, phases.acceleration.end),
            contact: poseHistory.slice(phases.contact.start, phases.contact.end),
            followThrough: poseHistory.slice(phases.followThrough.start, phases.followThrough.end)
        };
    }

    /**
     * Get phase at specific frame index
     */
    getPhaseAtFrame(phases, frameIndex) {
        if (frameIndex >= phases.preparation.start && frameIndex < phases.preparation.end) {
            return 'preparation';
        } else if (frameIndex >= phases.loading.start && frameIndex < phases.loading.end) {
            return 'loading';
        } else if (frameIndex >= phases.acceleration.start && frameIndex < phases.acceleration.end) {
            return 'acceleration';
        } else if (frameIndex >= phases.contact.start && frameIndex < phases.contact.end) {
            return 'contact';
        } else if (frameIndex >= phases.followThrough.start && frameIndex <= phases.followThrough.end) {
            return 'followThrough';
        }
        return 'unknown';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PhaseDetector;
} else {
    window.PhaseDetector = PhaseDetector;
}