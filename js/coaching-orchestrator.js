/**
 * Coaching Orchestrator
 * Intelligent coaching system that uses the elite decision tree to provide
 * progressive, personalized feedback based on player metrics and issue priority
 */

class CoachingOrchestrator {
    constructor() {
        this.decisionTree = null;
        this.feedbackHistory = [];
        this.issueTracker = {};
        this.strokesSinceLastFeedback = 0;
        this.consecutiveIssues = {};
        this.lastQualityScores = [];
        this.maxQualityHistory = 10;
        
        this.loadDecisionTree();
    }

    /**
     * Load the coaching decision tree from JSON
     */
    async loadDecisionTree() {
        try {
            const response = await fetch('tennis_coaching_tree.json');
            this.decisionTree = await response.json();
            console.log('✅ Coaching decision tree loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load decision tree:', error);
            // Fallback to basic coaching if tree unavailable
            this.decisionTree = null;
        }
    }

    /**
     * Main coaching analysis after each stroke
     * Returns coaching recommendation or null if cooldown active
     */
    analyzeStroke(strokeData, playerMetrics) {
        if (!this.decisionTree) {
            return this.fallbackCoaching(strokeData);
        }

        // Track quality for regression detection
        this.lastQualityScores.push(strokeData.quality.overall);
        if (this.lastQualityScores.length > this.maxQualityHistory) {
            this.lastQualityScores.shift();
        }

        this.strokesSinceLastFeedback++;

        // Detect critical situations that override cooldown
        const criticalSituation = this.detectCriticalSituation(strokeData);
        
        // Apply cooldown unless critical
        const cooldownStrokes = this.decisionTree.diagnosisRules.feedbackCadence.cooldownStrokes;
        if (this.strokesSinceLastFeedback < cooldownStrokes && !criticalSituation) {
            return null; // Stay silent during cooldown
        }

        // Find all matching issues
        const matchingIssues = this.findMatchingIssues(playerMetrics);
        
        // Select highest priority issue with met prerequisites
        const selectedIssue = this.selectIssueToAddress(matchingIssues, playerMetrics);
        
        if (!selectedIssue) {
            // No issues detected or all improving
            if (this.shouldGiveSilence(playerMetrics)) {
                return null;
            }
            // Celebrate excellence
            return this.buildExcellenceFeedback(strokeData, playerMetrics);
        }

        // Build comprehensive coaching context
        const coachingContext = this.buildCoachingContext(
            selectedIssue, 
            strokeData, 
            playerMetrics,
            criticalSituation
        );

        // Track issue for consecutive detection
        this.trackIssue(selectedIssue.id);
        
        // Reset feedback counter
        this.strokesSinceLastFeedback = 0;
        
        return coachingContext;
    }

    /**
     * Find all issues that match current player metrics
     */
    findMatchingIssues(playerMetrics) {
        if (!this.decisionTree) return [];

        const matchingIssues = [];

        for (const issue of this.decisionTree.issues) {
            if (this.meetsDetectionCriteria(issue, playerMetrics)) {
                matchingIssues.push({
                    ...issue,
                    matchStrength: this.calculateMatchStrength(issue, playerMetrics)
                });
            }
        }

        // Sort by priority (higher priority = lower number)
        return matchingIssues.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Check if player metrics meet issue detection criteria
     */
    meetsDetectionCriteria(issue, metrics) {
        const primary = issue.detection.primary;
        const confirming = issue.detection.confirming;

        // Check primary detection rules
        let primaryMatch = this.evaluateConditions(primary, metrics);
        
        if (!primaryMatch) return false;

        // Check confirming rules if present
        if (confirming && Object.keys(confirming).length > 0) {
            const confirmingMatch = this.evaluateConditions(confirming, metrics);
            // Require at least one confirming condition to match
            return confirmingMatch;
        }

        return true;
    }

    /**
     * Evaluate detection conditions against metrics
     */
    evaluateConditions(conditions, metrics) {
        for (const [metricName, rule] of Object.entries(conditions)) {
            const metricValue = this.getMetricValue(metricName, metrics);
            
            if (metricValue === null) continue;

            // Check min condition
            if (rule.min !== undefined && metricValue < rule.min) {
                return false;
            }

            // Check max condition
            if (rule.max !== undefined && metricValue > rule.max) {
                return false;
            }

            // Check equals condition
            if (rule.equals !== undefined && metricValue !== rule.equals) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get metric value from player metrics object
     */
    getMetricValue(metricName, metrics) {
        // Map metric names to actual data structure
        const metricMap = {
            'preparationTime': metrics.preparationTime || 0.5,
            'velocity': metrics.velocity?.magnitude || 0,
            'acceleration': metrics.acceleration?.magnitude || 0,
            'rotation': Math.abs(metrics.rotation || 0),
            'hipShoulderSeparation': metrics.technique?.hipShoulderSeparation || 0,
            'contactPointVariance': metrics.contactPointVariance || 0.05,
            'forwardMomentum': metrics.forwardMomentum || 0.5,
            'backFootWeightAtContact': metrics.backFootWeight || 0.3,
            'elbowAngleAtContact': metrics.technique?.elbowAngleAtContact || 140,
            'armExtension': metrics.armExtension || 0.7,
            'swingPathSmoothness': metrics.smoothness || 70,
            'weightTransfer': metrics.technique?.weightTransfer,
            'stance': metrics.technique?.stance,
            'followThroughComplete': metrics.followThroughComplete !== false
        };

        return metricMap[metricName] !== undefined ? metricMap[metricName] : null;
    }

    /**
     * Calculate how strongly the issue matches (for prioritization)
     */
    calculateMatchStrength(issue, metrics) {
        let strength = 0;
        const primary = issue.detection.primary;

        for (const [metricName, rule] of Object.entries(primary)) {
            const metricValue = this.getMetricValue(metricName, metrics);
            if (metricValue === null) continue;

            // Calculate how far from threshold
            if (rule.min !== undefined) {
                const excess = metricValue - rule.min;
                strength += Math.max(0, excess * 10);
            }
            if (rule.max !== undefined) {
                const deficit = rule.max - metricValue;
                strength += Math.max(0, deficit * 10);
            }
        }

        return strength;
    }

    /**
     * Select the highest priority issue that meets all prerequisites
     */
    selectIssueToAddress(matchingIssues, metrics) {
        if (matchingIssues.length === 0) return null;

        // Check issues in priority order
        for (const issue of matchingIssues) {
            // Check if prerequisites are met
            if (this.prerequisitesMet(issue, metrics)) {
                return issue;
            }
        }

        // If no issues have met prerequisites, return highest priority
        return matchingIssues[0];
    }

    /**
     * Check if issue prerequisites are satisfied
     */
    prerequisitesMet(issue, metrics) {
        const deps = issue.dependencies;
        
        // Check mustFixFirst dependencies
        if (deps.mustFixFirst && deps.mustFixFirst.length > 0) {
            for (const prereqId of deps.mustFixFirst) {
                const prereqIssue = this.decisionTree.issues.find(i => i.id === prereqId);
                if (prereqIssue && this.meetsDetectionCriteria(prereqIssue, metrics)) {
                    // Prerequisite issue still present, can't address this one yet
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Detect critical situations that override cooldown
     */
    detectCriticalSituation(strokeData) {
        const allowFeedback = this.decisionTree.diagnosisRules.feedbackCadence.allowFeedbackIf;

        // Obvious regression
        if (this.detectRegression()) {
            return 'obvious_regression';
        }

        // Repeated mistake 3+ times
        if (this.detectRepeatedMistake()) {
            return 'repeated_mistake_3_plus';
        }

        // Breakthrough opportunity (excellent execution)
        if (strokeData.quality.overall >= 90) {
            return 'excellent_execution';
        }

        // Check if current stroke shows breakthrough
        if (this.detectBreakthrough(strokeData)) {
            return 'breakthrough_opportunity';
        }

        return null;
    }

    /**
     * Detect performance regression
     */
    detectRegression() {
        if (this.lastQualityScores.length < 6) return false;

        const recent = this.lastQualityScores.slice(-3);
        const previous = this.lastQualityScores.slice(-6, -3);

        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

        const threshold = this.decisionTree.diagnosisRules.improvementTracking.regressionThreshold * 100;
        
        return (recentAvg - previousAvg) < threshold;
    }

    /**
     * Detect repeated mistakes
     */
    detectRepeatedMistake() {
        for (const [issueId, count] of Object.entries(this.consecutiveIssues)) {
            if (count >= 3) {
                return true;
            }
        }
        return false;
    }

    /**
     * Detect breakthrough improvement
     */
    detectBreakthrough(strokeData) {
        if (this.lastQualityScores.length < 5) return false;

        const recent = this.lastQualityScores.slice(-3);
        const historical = this.lastQualityScores.slice(0, -3);

        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const historicalAvg = historical.reduce((a, b) => a + b, 0) / historical.length;

        const threshold = this.decisionTree.diagnosisRules.improvementTracking.improvementThreshold * 100;

        return (recentAvg - historicalAvg) > threshold;
    }

    /**
     * Check if we should stay silent
     */
    shouldGiveSilence(metrics) {
        const silenceIf = this.decisionTree.diagnosisRules.feedbackCadence.silenceIf;

        // Recent feedback and improving
        if (this.strokesSinceLastFeedback < 3 && this.lastQualityScores.length >= 5) {
            const recent = this.lastQualityScores.slice(-3);
            const previous = this.lastQualityScores.slice(-6, -3);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
            
            if (recentAvg > previousAvg) {
                return true;
            }
        }

        // High consistency, no issues
        if (metrics.consistency >= 85 && this.lastQualityScores.length >= 3) {
            const recentAvg = this.lastQualityScores.slice(-3).reduce((a, b) => a + b, 0) / 3;
            if (recentAvg >= 80) {
                return true;
            }
        }

        return false;
    }

    /**
     * Track issue occurrence for consecutive detection
     */
    trackIssue(issueId) {
        if (!this.consecutiveIssues[issueId]) {
            this.consecutiveIssues[issueId] = 0;
        }
        this.consecutiveIssues[issueId]++;

        // Reset other issues
        for (const id of Object.keys(this.consecutiveIssues)) {
            if (id !== issueId) {
                this.consecutiveIssues[id] = 0;
            }
        }
    }

    /**
     * Build comprehensive coaching context for GPT
     */
    buildCoachingContext(issue, strokeData, metrics, criticalSituation) {
        // Determine skill level for cue selection
        const skillLevel = this.determineSkillLevel(metrics);
        
        // Get appropriate coaching cue
        const cue = issue.cueSelection[skillLevel] || issue.cueSelection.intermediate;

        // Build context object
        return {
            issue: {
                id: issue.id,
                name: issue.name,
                priority: issue.priority,
                category: issue.category,
                impactLevel: issue.impactLevel
            },
            diagnosis: issue.diagnosis,
            cue: cue,
            keyMetrics: this.extractKeyMetrics(issue, metrics),
            expectedImprovement: issue.expectedImprovement,
            strokeData: strokeData,
            playerLevel: skillLevel,
            criticalSituation: criticalSituation,
            consecutiveOccurrences: this.consecutiveIssues[issue.id] || 1,
            sessionContext: {
                strokesSinceLastFeedback: this.strokesSinceLastFeedback,
                recentQualityTrend: this.getQualityTrend(),
                totalFeedbackGiven: this.feedbackHistory.length
            }
        };
    }

    /**
     * Extract key metrics relevant to the issue
     */
    extractKeyMetrics(issue, metrics) {
        const keyMetrics = {};
        
        for (const metricName of issue.keyMetrics) {
            keyMetrics[metricName] = this.getMetricValue(metricName, metrics);
        }

        return keyMetrics;
    }

    /**
     * Determine player skill level from metrics
     */
    determineSkillLevel(metrics) {
        const thresholds = this.decisionTree.skillLevelThresholds;
        
        const velocity = metrics.velocity?.magnitude || 0;
        const consistency = metrics.consistency || 0;
        const quality = metrics.quality || 0;

        // Check elite
        if (velocity >= thresholds.elite.velocity.min &&
            consistency >= thresholds.elite.consistency.min &&
            quality >= thresholds.elite.quality.min) {
            return 'elite';
        }

        // Check advanced
        if (velocity >= thresholds.advanced.velocity.min &&
            consistency >= thresholds.advanced.consistency.min &&
            quality >= thresholds.advanced.quality.min) {
            return 'advanced';
        }

        // Check intermediate
        if (velocity >= thresholds.intermediate.velocity.min) {
            return 'intermediate';
        }

        return 'beginner';
    }

    /**
     * Get quality trend description
     */
    getQualityTrend() {
        if (this.lastQualityScores.length < 3) return 'establishing_baseline';

        const recent = this.lastQualityScores.slice(-3);
        const previous = this.lastQualityScores.slice(-6, -3);
        
        if (previous.length === 0) return 'establishing_baseline';

        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

        if (recentAvg > previousAvg + 5) return 'improving';
        if (recentAvg < previousAvg - 5) return 'declining';
        return 'stable';
    }

    /**
     * Build excellence feedback when no issues detected
     */
    buildExcellenceFeedback(strokeData, metrics) {
        this.strokesSinceLastFeedback = 0;
        
        return {
            type: 'excellence',
            strokeData: strokeData,
            message: this.getExcellenceMessage(strokeData, metrics),
            sessionContext: {
                recentQualityTrend: this.getQualityTrend(),
                averageQuality: this.lastQualityScores.reduce((a, b) => a + b, 0) / this.lastQualityScores.length
            }
        };
    }

    /**
     * Generate excellence message
     */
    getExcellenceMessage(strokeData, metrics) {
        const quality = strokeData.quality.overall;
        const trend = this.getQualityTrend();

        if (quality >= 95) {
            return "Exceptional stroke! That's professional-level technique.";
        } else if (quality >= 90) {
            return "Outstanding! Your form is looking excellent.";
        } else if (trend === 'improving') {
            return "Great progress! Your consistency is improving nicely.";
        } else {
            return "Solid technique! Keep maintaining this quality.";
        }
    }

    /**
     * Fallback coaching when decision tree unavailable
     */
    fallbackCoaching(strokeData) {
        const quality = strokeData.quality.overall;
        
        if (quality >= 85) {
            return {
                type: 'fallback',
                message: "Excellent stroke! Maintain that form."
            };
        } else if (quality >= 70) {
            return {
                type: 'fallback',
                message: "Good effort. Focus on smooth acceleration through contact."
            };
        } else {
            return {
                type: 'fallback',
                message: "Work on the fundamentals. Prepare early and follow through."
            };
        }
    }

    /**
     * Reset orchestrator state (new session)
     */
    reset() {
        this.feedbackHistory = [];
        this.strokesSinceLastFeedback = 0;
        this.consecutiveIssues = {};
        this.lastQualityScores = [];
        console.log('Coaching orchestrator reset');
    }

    /**
     * Get coaching statistics
     */
    getStatistics() {
        return {
            totalFeedbackGiven: this.feedbackHistory.length,
            strokesSinceLastFeedback: this.strokesSinceLastFeedback,
            currentIssues: Object.keys(this.consecutiveIssues).filter(id => this.consecutiveIssues[id] > 0),
            qualityTrend: this.getQualityTrend(),
            averageQuality: this.lastQualityScores.length > 0 
                ? this.lastQualityScores.reduce((a, b) => a + b, 0) / this.lastQualityScores.length 
                : 0
        };
    }
}

// Export for browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoachingOrchestrator;
} else {
    window.CoachingOrchestrator = CoachingOrchestrator;
}