/**
 * Motion Sequence Analyzer
 * Orchestrates comprehensive temporal analysis of tennis strokes
 * Integrates phase detection, kinetic chain analysis, and reference comparison
 */

class MotionSequenceAnalyzer {
    constructor() {
        this.phaseDetector = new PhaseDetector();
        this.kineticChainAnalyzer = new KineticChainAnalyzer();
        
        // Store reference sequences for comparison
        this.referenceLibrary = {};
        
        // Track user's historical sequences for adaptive learning
        this.userSequenceHistory = [];
        this.maxHistorySize = 50;
    }

    /**
     * Main analysis method - analyzes complete stroke sequence
     */
    analyzeSequence(poseHistory, strokeType) {
        if (!poseHistory || poseHistory.length < 20) {
            return null;
        }

        // 1. Detect phases
        const phases = this.phaseDetector.detectPhases(poseHistory);
        if (!phases || !this.phaseDetector.validatePhases(phases)) {
            console.warn('Could not detect valid phases');
            return null;
        }

        // 2. Extract phase data
        const phaseData = this.phaseDetector.extractPhaseData(poseHistory, phases);

        // 3. Analyze each phase individually
        const phaseAnalysis = {
            preparation: this.analyzePreparation(phaseData.preparation),
            loading: this.analyzeLoading(phaseData.loading),
            acceleration: this.analyzeAcceleration(phaseData.acceleration),
            contact: this.analyzeContact(phaseData.contact),
            followThrough: this.analyzeFollowThrough(phaseData.followThrough)
        };

        // 4. Analyze kinetic chain
        const kineticChain = this.kineticChainAnalyzer.analyzeChain(poseHistory, phases);

        // 5. Check timing between phases
        const phaseTiming = this.analyzePhaseTimings(phases);

        // 6. Calculate sequence smoothness
        const smoothness = this.calculateSequenceSmoothness(poseHistory, phases);

        // 7. Compare to reference if available
        const referenceComparison = this.compareToReference(
            strokeType, 
            { phases, phaseAnalysis, kineticChain }
        );

        // 8. Calculate overall sequence quality
        const sequenceQuality = this.calculateSequenceQuality(
            phaseAnalysis, 
            kineticChain, 
            phaseTiming, 
            smoothness
        );

        // 9. Store in user history for adaptive learning
        this.addToUserHistory({
            strokeType,
            phases,
            phaseAnalysis,
            kineticChain,
            quality: sequenceQuality
        });

        return {
            phases,
            phaseData,
            phaseAnalysis,
            kineticChain,
            phaseTiming,
            smoothness,
            sequenceQuality,
            referenceComparison,
            feedback: this.generateSequenceFeedback(
                phaseAnalysis, 
                kineticChain, 
                phaseTiming,
                referenceComparison
            )
        };
    }

    /**
     * Analyze preparation phase
     */
    analyzePreparation(preparationData) {
        if (!preparationData || preparationData.length < 3) {
            return { quality: 50, issues: ['Insufficient preparation data'] };
        }

        const issues = [];
        let quality = 100;

        // Check preparation timing (should be early)
        const duration = preparationData.length;
        if (duration < 8) {
            issues.push('Late preparation - set up earlier');
            quality -= 20;
        }

        // Check if player is in ready position
        const firstFrame = preparationData[0];
        const avgVelocity = preparationData.reduce((sum, p) => sum + p.velocity.magnitude, 0) / duration;
        
        if (avgVelocity > 0.015) {
            issues.push('Moving too much during preparation - stabilize first');
            quality -= 15;
        }

        // Check split step (should have slight downward then upward motion)
        const splitStepDetected = this.detectSplitStep(preparationData);
        if (!splitStepDetected) {
            issues.push('No split step detected');
            quality -= 10;
        }

        // Check shoulder turn initiation
        const finalRotation = Math.abs(preparationData[preparationData.length - 1].rotation || 0);
        if (finalRotation < 5) {
            issues.push('Insufficient early shoulder turn');
            quality -= 15;
        }

        return {
            quality: Math.max(0, quality),
            duration,
            avgVelocity,
            splitStepDetected,
            shoulderTurn: finalRotation,
            issues: issues.length > 0 ? issues : ['Good preparation']
        };
    }

    /**
     * Detect split step in preparation phase
     */
    detectSplitStep(preparationData) {
        if (preparationData.length < 5) return false;

        // Look for downward then upward motion in hips/center of mass
        for (let i = 2; i < preparationData.length - 2; i++) {
            const prev = preparationData[i - 2].joints.rightHip.y;
            const current = preparationData[i].joints.rightHip.y;
            const next = preparationData[i + 2].joints.rightHip.y;

            // Split step: down then up
            if (current > prev && next < current) {
                return true;
            }
        }

        return false;
    }

    /**
     * Analyze loading phase
     */
    analyzeLoading(loadingData) {
        if (!loadingData || loadingData.length < 3) {
            return { quality: 50, issues: ['Insufficient loading data'] };
        }

        const issues = [];
        let quality = 100;

        // Check coiling (rotation should increase)
        const startRotation = Math.abs(loadingData[0].rotation || 0);
        const endRotation = Math.abs(loadingData[loadingData.length - 1].rotation || 0);
        const rotationGain = endRotation - startRotation;

        if (rotationGain < 10) {
            issues.push('Insufficient coiling - turn shoulders more');
            quality -= 25;
        } else if (rotationGain > 40) {
            issues.push('Excellent coiling');
        }

        // Check weight transfer to back foot
        const weightOnBackFoot = this.estimateBackFootWeight(loadingData[loadingData.length - 1]);
        if (weightOnBackFoot < 0.6) {
            issues.push('Load more weight onto back foot');
            quality -= 20;
        }

        // Check racket position (should be back)
        const racketBack = this.checkRacketPosition(loadingData);
        if (!racketBack) {
            issues.push('Get racket back earlier');
            quality -= 15;
        }

        return {
            quality: Math.max(0, quality),
            rotationGain,
            weightOnBackFoot,
            racketBack,
            issues: issues.length > 0 ? issues : ['Good loading']
        };
    }

    /**
     * Estimate weight on back foot from pose
     */
    estimateBackFootWeight(poseData) {
        const rightAnkle = poseData.joints.rightAnkle.y;
        const leftAnkle = poseData.joints.leftAnkle.y;
        
        // Lower ankle = more weight (simplified heuristic)
        const heightDiff = leftAnkle - rightAnkle;
        
        // Normalize to 0-1 range
        return 0.5 + Math.max(-0.4, Math.min(0.4, heightDiff * 4));
    }

    /**
     * Check if racket is in proper back position
     */
    checkRacketPosition(loadingData) {
        const lastFrame = loadingData[loadingData.length - 1];
        const wrist = lastFrame.joints.rightWrist;
        const shoulder = lastFrame.joints.rightShoulder;
        
        // Wrist should be behind shoulder during loading
        return wrist.x < shoulder.x;
    }

    /**
     * Analyze acceleration phase
     */
    analyzeAcceleration(accelerationData) {
        if (!accelerationData || accelerationData.length < 3) {
            return { quality: 50, issues: ['Insufficient acceleration data'] };
        }

        const issues = [];
        let quality = 100;

        // Check acceleration magnitude
        const velocities = accelerationData.map(p => p.velocity.magnitude);
        const accelerations = accelerationData.map(p => p.acceleration?.magnitude || 0);
        
        const avgAcceleration = accelerations.reduce((a, b) => a + b, 0) / accelerations.length;
        if (avgAcceleration < 0.012) {
            issues.push('Increase acceleration through the ball');
            quality -= 25;
        }

        // Checkfor smooth acceleration curve
        const accelerationSmoothness = this.checkAccelerationSmoothness(velocities);
        if (accelerationSmoothness < 60) {
            issues.push('Jerky acceleration - smoother motion needed');
            quality -= 15;
        }

        // Check hip-shoulder separation during acceleration
        const hipShoulderSep = this.analyzeHipShoulderSeparation(accelerationData);
        if (hipShoulderSep.max < 20) {
            issues.push('Need more hip-shoulder separation for power');
            quality -= 20;
        }

        // Check forward momentum
        const forwardMomentum = this.calculateForwardMomentum(accelerationData);
        if (forwardMomentum < 0.3) {
            issues.push('Move forward into the shot');
            quality -= 15;
        }

        return {
            quality: Math.max(0, quality),
            avgAcceleration,
            accelerationSmoothness,
            maxHipShoulderSeparation: hipShoulderSep.max,
            forwardMomentum,
            issues: issues.length > 0 ? issues : ['Excellent acceleration']
        };
    }

    /**
     * Check smoothness of acceleration curve
     */
    checkAccelerationSmoothness(velocities) {
        if (velocities.length < 3) return 50;

        // Calculate jerk (rate of change of acceleration)
        let totalJerk = 0;
        for (let i = 2; i < velocities.length; i++) {
            const accel1 = velocities[i-1] - velocities[i-2];
            const accel2 = velocities[i] - velocities[i-1];
            const jerk = Math.abs(accel2 - accel1);
            totalJerk += jerk;
        }

        const avgJerk = totalJerk / (velocities.length - 2);
        
        // Convert to smoothness score (lower jerk = higher smoothness)
        return Math.max(20, 100 - (avgJerk * 500));
    }

    /**
     * Analyze hip-shoulder separation throughout acceleration
     */
    analyzeHipShoulderSeparation(accelerationData) {
        const separations = accelerationData.map(p => {
            const shoulderAngle = Math.atan2(
                p.joints.rightShoulder.y - p.joints.leftShoulder.y,
                p.joints.rightShoulder.x - p.joints.leftShoulder.x
            ) * 180 / Math.PI;

            const hipAngle = Math.atan2(
                p.joints.rightHip.y - p.joints.leftHip.y,
                p.joints.rightHip.x - p.joints.leftHip.x
            ) * 180 / Math.PI;

            return Math.abs(shoulderAngle - hipAngle);
        });

        return {
            max: Math.max(...separations),
            avg: separations.reduce((a, b) => a + b, 0) / separations.length,
            atContact: separations[separations.length - 1]
        };
    }

    /**
     * Calculate forward momentum during acceleration
     */
    calculateForwardMomentum(accelerationData) {
        if (accelerationData.length < 3) return 0;

        const start = accelerationData[0].joints.rightHip;
        const end = accelerationData[accelerationData.length - 1].joints.rightHip;

        // Forward = positive x direction
        const forwardMovement = end.x - start.x;
        
        // Normalize
        return Math.max(0, Math.min(1, forwardMovement * 10));
    }

    /**
     * Analyze contact phase
     */
    analyzeContact(contactData) {
        if (!contactData || contactData.length === 0) {
            return { quality: 50, issues: ['No contact frame detected'] };
        }

        const issues = [];
        let quality = 100;
        const contactFrame = contactData[0];

        // Check contact point height (should be between waist and chest)
        const wristHeight = contactFrame.joints.rightWrist.y;
        const shoulderHeight = contactFrame.joints.rightShoulder.y;
        const hipHeight = contactFrame.joints.rightHip.y;

        const idealHeight = (shoulderHeight + hipHeight) / 2;
        const heightDeviation = Math.abs(wristHeight - idealHeight);

        if (heightDeviation > 0.1) {
            if (wristHeight < idealHeight - 0.1) {
                issues.push('Contact point too low - hit higher');
            } else {
                issues.push('Contact point too high - let ball drop more');
            }
            quality -= 20;
        }

        // Check contact point distance (should be in front)
        const wristX = contactFrame.joints.rightWrist.x;
        const shoulderX = contactFrame.joints.rightShoulder.x;
        
        if (wristX <= shoulderX) {
            issues.push('Contact point too close - hit more in front');
            quality -= 25;
        }

        // Check body rotation at contact
        const rotationAtContact = Math.abs(contactFrame.rotation || 0);
        if (rotationAtContact < 15) {
            issues.push('Need more body rotation at contact');
            quality -= 15;
        }

        // Check weight distribution at contact
        const weightForward = this.estimateBackFootWeight(contactFrame) < 0.4;
        if (!weightForward) {
            issues.push('Transfer weight forward through contact');
            quality -= 20;
        }

        return {
            quality: Math.max(0, quality),
            contactHeight: wristHeight,
            heightDeviation,
            inFront: wristX > shoulderX,
            rotationAtContact,
            weightForward,
            issues: issues.length > 0 ? issues : ['Excellent contact point']
        };
    }

    /**
     * Analyze follow-through phase
     */
    analyzeFollowThrough(followThroughData) {
        if (!followThroughData || followThroughData.length < 5) {
            return { quality: 50, issues: ['Insufficient follow-through'] };
        }

        const issues = [];
        let quality = 100;

        // Check follow-through duration
        const duration = followThroughData.length;
        if (duration < 8) {
            issues.push('Abbreviated follow-through - complete the swing');
            quality -= 25;
        }

        // Check deceleration pattern (should be gradual)
        const velocities = followThroughData.map(p => p.velocity.magnitude);
        const decelerationSmoothness = this.checkDecelerationSmoothness(velocities);
        if (decelerationSmoothness < 60) {
            issues.push('Abrupt stopping - extend follow-through more');
            quality -= 20;
        }

        // Check if racket wraps around body
        const wrapAround = this.checkWrapAround(followThroughData);
        if (!wrapAround) {
            issues.push('Complete wrap-around to opposite shoulder');
            quality -= 15;
        }

        // Check balance at end of follow-through
        const balanced = this.checkBalance(followThroughData[followThroughData.length - 1]);
        if (!balanced) {
            issues.push('Maintain balance through finish');
            quality -= 10;
        }

        return {
            quality: Math.max(0, quality),
            duration,
            decelerationSmoothness,
            wrapAround,
            balanced,
            issues: issues.length > 0 ? issues : ['Complete follow-through']
        };
    }

    /**
     * Check smoothness of deceleration
     */
    checkDecelerationSmoothness(velocities) {
        if (velocities.length < 3) return 50;

        // Velocities should decrease gradually
        let smoothDecel = 0;
        let totalChecks = 0;

        for (let i = 1; i < velocities.length; i++) {
            if (velocities[i] <= velocities[i-1]) {
                smoothDecel++;
            }
            totalChecks++;
        }

        return (smoothDecel / totalChecks) * 100;
    }

    /**
     * Check if racket wraps around body
     */
    checkWrapAround(followThroughData) {
        const start = followThroughData[0].joints.rightWrist;
        const end = followThroughData[followThroughData.length - 1].joints.rightWrist;
        const shoulder = followThroughData[followThroughData.length - 1].joints.leftShoulder;

        // Wrist should end near opposite shoulder
        const distanceToShoulder = Math.sqrt(
            Math.pow(end.x - shoulder.x, 2) + 
            Math.pow(end.y - shoulder.y, 2)
        );

        return distanceToShoulder < 0.3;
    }

    /**
     * Check balance at end of stroke
     */
    checkBalance(finalFrame) {
        const leftAnkle = finalFrame.joints.leftAnkle;
        const rightAnkle = finalFrame.joints.rightAnkle;
        const nose = finalFrame.joints.nose || finalFrame.landmarks[0];

        // Center of mass should be between feet
        const feetCenter = (leftAnkle.x + rightAnkle.x) / 2;
        const deviation = Math.abs(nose.x - feetCenter);

        return deviation < 0.15;
    }

    /**
     * Analyze timing between phases
     */
    analyzePhaseTimings(phases) {
        const timings = {
            prepToLoad: phases.loading.start - phases.preparation.start,
            loadToAccel: phases.acceleration.start - phases.loading.start,
            accelToContact: phases.contact.start - phases.acceleration.start,
            contactToFollow: phases.followThrough.start - phases.contact.start
        };

        const issues = [];
        let quality = 100;

        // Check for rushed transitions (too fast)
        if (timings.loadToAccel < 3) {
            issues.push('Too rushed from loading to acceleration');
            quality -= 15;
        }

        if (timings.accelToContact < 5) {
            issues.push('Insufficient acceleration phase');
            quality -= 20;
        }

        // Check for delayed transitions (too slow)
        if (timings.prepToLoad > 15) {
            issues.push('Loading phase starting too late');
            quality -= 15;
        }

        return {
            timings,
            quality: Math.max(0, quality),
            issues: issues.length > 0 ? issues : ['Good phase timing']
        };
    }

    /**
     * Calculate overall smoothness of entire sequence
     */
    calculateSequenceSmoothness(poseHistory, phases) {
        // Calculate velocity profile smoothness
        const velocities = poseHistory.map(p => p.velocity.magnitude);
        
        let totalVariation = 0;
        for (let i = 1; i < velocities.length; i++) {
            totalVariation += Math.abs(velocities[i] - velocities[i-1]);
        }

        const avgVariation = totalVariation / (velocities.length - 1);
        const smoothness = Math.max(20, 100 - (avgVariation * 200));

        return {
            overall: smoothness,
            avgVariation,
            feedback: smoothness > 75 ? 'Very smooth stroke' : 
                     smoothness > 60 ? 'Decent smoothness' : 
                     'Work on smoother motion'
        };
    }

    /**
     * Calculate overall sequence quality
     */
    calculateSequenceQuality(phaseAnalysis, kineticChain, phaseTiming, smoothness) {
        const weights = {
            preparation: 0.10,
            loading: 0.15,
            acceleration: 0.25,
            contact: 0.25,
            followThrough: 0.10,
            kineticChain: 0.10,
            phaseTiming: 0.05
        };

        let totalScore = 0;

        totalScore += (phaseAnalysis.preparation?.quality || 50) * weights.preparation;
        totalScore += (phaseAnalysis.loading?.quality || 50) * weights.loading;
        totalScore += (phaseAnalysis.acceleration?.quality || 50) * weights.acceleration;
        totalScore += (phaseAnalysis.contact?.quality || 50) * weights.contact;
        totalScore += (phaseAnalysis.followThrough?.quality || 50) * weights.followThrough;
        totalScore += (kineticChain?.chainQuality || 50) * weights.kineticChain;
        totalScore += (phaseTiming?.quality || 50) * weights.phaseTiming;

        return {
            overall: Math.round(totalScore),
            breakdown: {
                preparation: phaseAnalysis.preparation?.quality || 50,
                loading: phaseAnalysis.loading?.quality || 50,
                acceleration: phaseAnalysis.acceleration?.quality || 50,
                contact: phaseAnalysis.contact?.quality || 50,
                followThrough: phaseAnalysis.followThrough?.quality || 50,
                kineticChain: kineticChain?.chainQuality || 50,
                phaseTiming: phaseTiming?.quality || 50
            },
            smoothness: smoothness.overall
        };
    }

    /**
     * Compare to reference sequence
     */
    compareToReference(strokeType, userSequence) {
        const reference = this.referenceLibrary[strokeType];
        if (!reference) {
            return null; // No reference available yet
        }

        const comparison = {
            phaseTimingDifference: this.comparePhaseTimings(
                userSequence.phases, 
                reference.phases
            ),
            kineticChainMatch: this.kineticChainAnalyzer.compareToReference(
                userSequence.kineticChain,
                reference.kineticChain
            ),
            qualityDifference: userSequence.phaseAnalysis - reference.phaseAnalysis
        };

        return comparison;
    }

    /**
     * Compare phase timings to reference
     */
    comparePhaseTimings(userPhases, refPhases) {
        return {
            preparation: userPhases.durations.preparation - refPhases.durations.preparation,
            loading: userPhases.durations.loading - refPhases.durations.loading,
            acceleration: userPhases.durations.acceleration - refPhases.durations.acceleration,
            followThrough: userPhases.durations.followThrough - refPhases.durations.followThrough
        };
    }

    /**
     * Generate comprehensive sequence feedback
     */
    generateSequenceFeedback(phaseAnalysis, kineticChain, phaseTiming, referenceComparison) {
        const feedback = {
            primary: [],
            secondary: [],
            positive: []
        };

        // Collect all issues by severity
        const allIssues = [];

        // Phase issues
        for (const [phaseName, analysis] of Object.entries(phaseAnalysis)) {
            if (analysis && analysis.issues) {
                for (const issue of analysis.issues) {
                    if (!issue.includes('Good') && !issue.includes('Excellent')) {
                        allIssues.push({
                            phase: phaseName,
                            severity: analysis.quality < 60 ? 'high' : 'medium',
                            message: issue,
                            quality: analysis.quality
                        });
                    } else {
                        feedback.positive.push(`${phaseName}: ${issue}`);
                    }
                }
            }
        }

        // Kinetic chain issues
        if (kineticChain && kineticChain.feedback) {
            for (const item of kineticChain.feedback) {
                if (item.severity === 'high' || item.severity === 'medium') {
                    allIssues.push({
                        phase: 'kinetic chain',
                        severity: item.severity,
                        message: item.message,
                        fix: item.fix
                    });
                } else {
                    feedback.positive.push(item.message);
                }
            }
        }

        // Phase timing issues
        if (phaseTiming && phaseTiming.issues) {
            for (const issue of phaseTiming.issues) {
                allIssues.push({
                    phase: 'timing',
                    severity: 'medium',
                    message: issue
                });
            }
        }

        // Sort by severity and quality impact
        allIssues.sort((a, b) => {
            const severityOrder = { high: 3, medium: 2, low: 1 };
            if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                return severityOrder[b.severity] - severityOrder[a.severity];
            }
            return (a.quality || 50) - (b.quality || 50);
        });

        // Take top 2 high severity and top 2 medium severity
        const highSeverity = allIssues.filter(i => i.severity === 'high').slice(0, 2);
        const mediumSeverity = allIssues.filter(i => i.severity === 'medium').slice(0, 2);

        feedback.primary = highSeverity;
        feedback.secondary = mediumSeverity;

        return feedback;
    }

    /**
     * Add sequence to user history for adaptive learning
     */
    addToUserHistory(sequenceData) {
        this.userSequenceHistory.push({
            timestamp: Date.now(),
            ...sequenceData
        });

        // Maintain max history size
        if (this.userSequenceHistory.length > this.maxHistorySize) {
            this.userSequenceHistory.shift();
        }

        // Update adaptive thresholds if enough data
        if (this.userSequenceHistory.length >= 10) {
            this.updateAdaptiveThresholds(sequenceData.strokeType);
        }
    }

    /**
     * Update thresholds based on user's historical performance
     */
    updateAdaptiveThresholds(strokeType) {
        const relevantHistory = this.userSequenceHistory
            .filter(s => s.strokeType === strokeType)
            .slice(-20); // Last 20 strokes of this type

        if (relevantHistory.length < 10) return;

        // Calculate user's baseline performance
        const avgQuality = relevantHistory.reduce((sum, s) => sum + s.quality.overall, 0) / relevantHistory.length;

        // Calculate consistency (std dev)
        const variance = relevantHistory.reduce((sum, s) => 
            sum + Math.pow(s.quality.overall - avgQuality, 2), 0) / relevantHistory.length;
        const consistency = Math.sqrt(variance);

        // Store as reference for this user
        if (!this.referenceLibrary[strokeType]) {
            this.referenceLibrary[strokeType] = {};
        }

        this.referenceLibrary[strokeType].userBaseline = {
            avgQuality,
            consistency,
            sampleSize: relevantHistory.length,
            lastUpdated: Date.now()
        };

        console.log(`Updated ${strokeType} baseline: quality=${avgQuality.toFixed(1)}, consistency=${consistency.toFixed(1)}`);
    }

    /**
     * Get user's improvement trend
     */
    getUserTrend(strokeType) {
        const relevantHistory = this.userSequenceHistory
            .filter(s => s.strokeType === strokeType);

        if (relevantHistory.length < 10) {
            return { trend: 'insufficient_data', message: 'Keep practicing to establish baseline' };
        }

        // Compare recent 5 to previous 5
        const recent = relevantHistory.slice(-5);
        const previous = relevantHistory.slice(-10, -5);

        const recentAvg = recent.reduce((sum, s) => sum + s.quality.overall, 0) / recent.length;
        const previousAvg = previous.reduce((sum, s) => sum + s.quality.overall, 0) / previous.length;

        const improvement = recentAvg - previousAvg;

        if (improvement > 5) {
            return { trend: 'improving', improvement, message: `You've improved ${improvement.toFixed(1)} points!` };
        } else if (improvement < -5) {
            return { trend: 'declining', improvement, message: 'Focus on fundamentals to get back on track' };
        } else {
            return { trend: 'stable', improvement, message: 'Consistent performance - ready for next level' };
        }
    }

    /**
     * Reset analyzer state
     */
    reset() {
        this.userSequenceHistory = [];
        console.log('Motion sequence analyzer reset');
    }

    /**
     * Export user data for analysis
     */
    exportUserData() {
        return {
            sequences: this.userSequenceHistory,
            references: this.referenceLibrary,
            exportDate: new Date().toISOString()
        };
    }

    /**
     * Import reference sequences (for pro comparisons)
     */
    importReferenceSequence(strokeType, referenceData) {
        this.referenceLibrary[strokeType] = {
            ...this.referenceLibrary[strokeType],
            professional: referenceData
        };
        console.log(`Imported professional reference for ${strokeType}`);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MotionSequenceAnalyzer;
} else {
    window.MotionSequenceAnalyzer = MotionSequenceAnalyzer;
}