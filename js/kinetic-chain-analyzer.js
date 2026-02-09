/**
 * Kinetic Chain Analyzer
 * Verifies proper sequencing of body segments during tennis strokes
 * Correct sequence: ankle → knee → hip → torso → shoulder → elbow → wrist
 */

class KineticChainAnalyzer {
    constructor() {
        // Define body segments in correct activation order
        this.chainSequence = [
            'ankle',
            'knee', 
            'hip',
            'torso',
            'shoulder',
            'elbow',
            'wrist'
        ];

        // Map segment names to Kalman joint names for velocity lookup
        this.segmentToJointMap = {
            ankle: ['rightAnkle', 'leftAnkle'],
            knee: ['rightKnee'],
            hip: ['rightHip', 'leftHip'],
            torso: ['rightShoulder', 'leftShoulder'],
            shoulder: ['rightShoulder'],
            elbow: ['rightElbow'],
            wrist: ['rightWrist']
        };

        // Timing tolerance between segments (frames)
        this.timingTolerance = {
            optimal: 2,      // Within 2 frames is optimal
            acceptable: 4,   // Within 4 frames is acceptable
            poor: 8          // More than 8 frames apart is poor
        };
    }

    /**
     * Analyze kinetic chain timing for a stroke sequence
     */
    analyzeChain(poseHistory, phases) {
        if (!phases || poseHistory.length < 15) {
            return null;
        }

        // Focus on acceleration phase (where chain should activate)
        const accelerationPhase = poseHistory.slice(
            phases.acceleration.start, 
            phases.contact.end
        );

        if (accelerationPhase.length < 5) {
            return null;
        }

        // Find peak velocity timing for each segment
        const segmentTimings = this.findSegmentPeakTimings(accelerationPhase);

        // Verify sequence order
        const sequenceAnalysis = this.verifySequence(segmentTimings);

        // Calculate timing gaps
        const timingGaps = this.calculateTimingGaps(segmentTimings);

        // Overall chain quality score
        const chainQuality = this.calculateChainQuality(sequenceAnalysis, timingGaps);

        return {
            segmentTimings,
            sequenceCorrect: sequenceAnalysis.correct,
            violations: sequenceAnalysis.violations,
            timingGaps,
            chainQuality,
            feedback: this.generateChainFeedback(sequenceAnalysis, timingGaps)
        };
    }

    /**
     * Find when each body segment reaches peak velocity
     * Pre-calculates velocities from position deltas between consecutive frames
     */
    findSegmentPeakTimings(accelerationPhase) {
        const timings = {};

        for (const segment of this.chainSequence) {
            const { peakFrame, peakVelocity } = this.findSegmentPeak(accelerationPhase, segment);
            timings[segment] = {
                frame: peakFrame,
                velocity: peakVelocity
            };
        }

        return timings;
    }

    /**
     * Find peak velocity frame for a specific body segment
     * Calculates velocity from position deltas between consecutive frames
     */
    findSegmentPeak(phaseData, segment) {
        let peakFrame = -1;
        let peakVelocity = 0;

        for (let i = 1; i < phaseData.length; i++) {
            const velocity = this.getSegmentVelocity(phaseData[i], phaseData[i - 1], segment);
            if (velocity > peakVelocity) {
                peakVelocity = velocity;
                peakFrame = i;
            }
        }

        return { peakFrame, peakVelocity };
    }

    /**
     * Calculate velocity of a specific body segment between two consecutive frames.
     * Prefers Kalman-estimated velocity when available (smoother, less noise).
     */
    getSegmentVelocity(currentFrame, previousFrame, segment) {
        // Try Kalman estimates first (attached by enhanced-tennis-analyzer)
        const kalman = currentFrame.kalmanEstimates;
        if (kalman) {
            const jointNames = this.segmentToJointMap[segment];
            if (jointNames) {
                let totalSpeed = 0;
                let count = 0;
                for (const name of jointNames) {
                    const est = kalman[name];
                    if (est && est.speed !== undefined) {
                        totalSpeed += est.speed;
                        count++;
                    }
                }
                if (count > 0) {
                    return totalSpeed / count;
                }
            }
        }

        // Fallback: position differencing between consecutive frames
        const current = currentFrame.joints;
        const previous = previousFrame.joints;

        if (!current || !previous) return 0;

        switch (segment) {
            case 'ankle':
                return this.averagePointVelocity(
                    [current.rightAnkle, current.leftAnkle],
                    [previous.rightAnkle, previous.leftAnkle]
                );

            case 'knee':
                return this.pointVelocity(current.rightKnee, previous.rightKnee);

            case 'hip':
                return this.averagePointVelocity(
                    [current.rightHip, current.leftHip],
                    [previous.rightHip, previous.leftHip]
                );

            case 'torso':
                return this.averagePointVelocity(
                    [current.rightShoulder, current.leftShoulder],
                    [previous.rightShoulder, previous.leftShoulder]
                );

            case 'shoulder':
                return this.pointVelocity(current.rightShoulder, previous.rightShoulder);

            case 'elbow':
                return this.pointVelocity(current.rightElbow, previous.rightElbow);

            case 'wrist':
                return this.pointVelocity(current.rightWrist, previous.rightWrist);

            default:
                return 0;
        }
    }

    /**
     * Calculate velocity magnitude between two positions of a single point
     */
    pointVelocity(current, previous) {
        if (!current || !previous) return 0;
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Average velocity across multiple point pairs (e.g. left+right ankle)
     */
    averagePointVelocity(currentPoints, previousPoints) {
        let total = 0;
        let count = 0;
        for (let i = 0; i < currentPoints.length; i++) {
            const v = this.pointVelocity(currentPoints[i], previousPoints[i]);
            if (v > 0) {
                total += v;
                count++;
            }
        }
        return count > 0 ? total / count : 0;
    }

    /**
     * Verify segments activate in correct order
     */
    verifySequence(segmentTimings) {
        const violations = [];
        let correctCount = 0;

        for (let i = 0; i < this.chainSequence.length - 1; i++) {
            const current = this.chainSequence[i];
            const next = this.chainSequence[i + 1];

            const currentTiming = segmentTimings[current].frame;
            const nextTiming = segmentTimings[next].frame;

            if (currentTiming === -1 || nextTiming === -1) {
                continue; // Skip if couldn't detect
            }

            // Next segment should activate after current
            if (nextTiming > currentTiming) {
                correctCount++;
            } else {
                violations.push({
                    segment: next,
                    expected: `${next} should activate after ${current}`,
                    actual: `${next} activated before ${current}`,
                    timingDifference: currentTiming - nextTiming
                });
            }
        }

        const totalChecks = this.chainSequence.length - 1;
        const correctPercentage = (correctCount / totalChecks) * 100;

        return {
            correct: correctPercentage >= 70, // 70% threshold
            correctPercentage,
            violations
        };
    }

    /**
     * Calculate timing gaps between sequential segments
     */
    calculateTimingGaps(segmentTimings) {
        const gaps = {};

        for (let i = 0; i < this.chainSequence.length - 1; i++) {
            const current = this.chainSequence[i];
            const next = this.chainSequence[i + 1];

            const currentTiming = segmentTimings[current].frame;
            const nextTiming = segmentTimings[next].frame;

            if (currentTiming === -1 || nextTiming === -1) {
                gaps[`${current}_to_${next}`] = null;
                continue;
            }

            const gap = Math.abs(nextTiming - currentTiming);
            gaps[`${current}_to_${next}`] = {
                frames: gap,
                quality: this.assessTimingQuality(gap)
            };
        }

        return gaps;
    }

    /**
     * Assess quality of timing gap
     */
    assessTimingQuality(gap) {
        if (gap <= this.timingTolerance.optimal) {
            return 'optimal';
        } else if (gap <= this.timingTolerance.acceptable) {
            return 'acceptable';
        } else if (gap <= this.timingTolerance.poor) {
            return 'poor';
        } else {
            return 'very_poor';
        }
    }

    /**
     * Calculate overall kinetic chain quality score
     */
    calculateChainQuality(sequenceAnalysis, timingGaps) {
        let score = 0;

        // Sequence correctness (50% of score)
        score += (sequenceAnalysis.correctPercentage / 100) * 50;

        // Timing quality (50% of score)
        const gapValues = Object.values(timingGaps).filter(g => g !== null);
        if (gapValues.length > 0) {
            const qualityScores = gapValues.map(g => {
                switch (g.quality) {
                    case 'optimal': return 100;
                    case 'acceptable': return 75;
                    case 'poor': return 50;
                    case 'very_poor': return 25;
                    default: return 0;
                }
            });
            const avgTimingScore = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
            score += (avgTimingScore / 100) * 50;
        }

        return Math.round(score);
    }

    /**
     * Generate feedback based on chain analysis
     */
    generateChainFeedback(sequenceAnalysis, timingGaps) {
        const feedback = [];

        // Sequence violations
        if (sequenceAnalysis.violations.length > 0) {
            const primaryViolation = sequenceAnalysis.violations[0];
            feedback.push({
                type: 'sequence_violation',
                severity: 'high',
                message: `Your ${primaryViolation.segment} is activating too early. ${primaryViolation.expected}.`,
                fix: this.getSequenceFixSuggestion(primaryViolation.segment)
            });
        }

        // Timing gaps
        const poorGaps = Object.entries(timingGaps)
            .filter(([_, gap]) => gap && (gap.quality === 'poor' || gap.quality === 'very_poor'))
            .slice(0, 2); // Top 2 issues

        for (const [transition, gap] of poorGaps) {
            const [from, to] = transition.split('_to_');
            feedback.push({
                type: 'timing_gap',
                severity: gap.quality === 'very_poor' ? 'high' : 'medium',
                message: `Too much delay between ${from} and ${to} activation (${gap.frames} frames).`,
                fix: `Focus on smoother transition from ${from} to ${to}. The movement should feel connected, not segmented.`
            });
        }

        // Positive feedback if chain is good
        if (sequenceAnalysis.correctPercentage >= 85 && feedback.length === 0) {
            feedback.push({
                type: 'positive',
                severity: 'low',
                message: 'Excellent kinetic chain! Energy is flowing smoothly from legs through to racket.',
                fix: null
            });
        }

        return feedback;
    }

    /**
     * Get specific fix suggestion for sequence violation
     */
    getSequenceFixSuggestion(segment) {
        const fixes = {
            'knee': 'Start your swing with a stronger leg drive. Push from the ground first.',
            'hip': 'Delay your hip rotation slightly. Let your legs initiate the movement.',
            'torso': 'Wait for your hips to start rotating before engaging your upper body.',
            'shoulder': 'Let your core rotation build before pulling with your shoulder.',
            'elbow': 'Keep your elbow back longer. Let your shoulder rotation start first.',
            'wrist': 'Delay your wrist snap. Let the arm extend before releasing the wrist.'
        };

        return fixes[segment] || 'Focus on sequential activation from the ground up.';
    }

    /**
     * Compare user's chain to professional reference
     */
    compareToReference(userChain, referenceChain) {
        if (!userChain || !referenceChain) return null;

        const comparison = {
            sequenceMatch: userChain.sequenceCorrect === referenceChain.sequenceCorrect,
            qualityDifference: userChain.chainQuality - referenceChain.chainQuality,
            timingComparison: {}
        };

        // Compare timing gaps
        for (const [transition, userGap] of Object.entries(userChain.timingGaps)) {
            const refGap = referenceChain.timingGaps[transition];
            if (userGap && refGap) {
                comparison.timingComparison[transition] = {
                    userFrames: userGap.frames,
                    refFrames: refGap.frames,
                    difference: userGap.frames - refGap.frames
                };
            }
        }

        return comparison;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KineticChainAnalyzer;
} else {
    window.KineticChainAnalyzer = KineticChainAnalyzer;
}