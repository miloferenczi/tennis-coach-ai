/**
 * Biomechanical Checkpoint System
 *
 * Evaluates tennis strokes against established biomechanical principles
 * Based on tennis coaching science and research
 *
 * References:
 * - USTA High Performance Coaching guidelines
 * - ITF Biomechanics research
 * - Roetert & Groppel "World-Class Tennis Technique"
 */

class BiomechanicalCheckpoints {
  constructor() {
    // Checkpoint definitions for each phase of a tennis stroke
    this.checkpoints = this.defineCheckpoints();

    // Common faults and their detection criteria
    this.faultDetectors = this.defineFaultDetectors();
  }

  /**
   * Define checkpoints for each phase of a tennis stroke
   * Each checkpoint has:
   * - metric: what to measure
   * - ideal: the target range
   * - weight: importance for overall quality
   * - feedback: what to tell the player if failed
   */
  defineCheckpoints() {
    return {
      // ==========================================
      // PREPARATION PHASE
      // Goal: Get ready position, early shoulder turn
      // ==========================================
      preparation: {
        earlyShoulderTurn: {
          metric: 'shoulderRotationAtPrepEnd',
          ideal: { min: 30, max: 90 },  // degrees from neutral
          weight: 0.25,
          feedback: {
            low: "Turn your shoulders earlier - as soon as you read the ball direction",
            high: "Good early preparation!"
          }
        },
        splitStepTiming: {
          metric: 'splitStepDetected',
          ideal: { equals: true },
          weight: 0.15,
          feedback: {
            fail: "Use a split step as your opponent hits - helps you react faster"
          }
        },
        readyPositionStability: {
          metric: 'velocityDuringPrep',
          ideal: { max: 0.015 },  // should be relatively still before loading
          weight: 0.10,
          feedback: {
            high: "Stay more stable in ready position before loading"
          }
        }
      },

      // ==========================================
      // LOADING PHASE
      // Goal: Coil body, load weight on back foot
      // ==========================================
      loading: {
        hipShoulderSeparation: {
          metric: 'maxHipShoulderSeparation',
          // CALIBRATED: pro range p25=34°, median=69° (2026-02-04)
          ideal: { min: 20, max: 80 },  // degrees
          weight: 0.20,
          feedback: {
            low: "Create more separation between hips and shoulders - rotate hips first",
            high: "Good coiling action!"
          }
        },
        weightOnBackFoot: {
          metric: 'backFootWeight',
          ideal: { min: 0.55 },  // >55% weight on back foot
          weight: 0.15,
          feedback: {
            low: "Load your weight onto your back foot during preparation"
          }
        },
        racketBackTiming: {
          metric: 'racketBehindBody',
          ideal: { equals: true },
          weight: 0.15,
          feedback: {
            fail: "Get your racket back earlier - should be back before forward swing starts"
          }
        },
        kneeBend: {
          metric: 'kneeBendAngle',
          ideal: { min: 130, max: 165 },  // degrees (less = more bend)
          weight: 0.10,
          feedback: {
            high: "Bend your knees more to load leg power"
          }
        }
      },

      // ==========================================
      // ACCELERATION PHASE
      // Goal: Uncoil in sequence (kinetic chain), accelerate racket
      // ==========================================
      acceleration: {
        kineticChainSequence: {
          metric: 'kineticChainScore',
          ideal: { min: 70 },  // 0-100 score
          weight: 0.25,
          feedback: {
            low: "Uncoil in sequence: hips lead, then shoulders, then arm, then racket"
          }
        },
        accelerationMagnitude: {
          metric: 'peakAcceleration',
          // CALIBRATED: pro p25=227 acceleration units (2026-02-04)
          ideal: { min: 200 },  // normalized units per second²
          weight: 0.20,
          feedback: {
            low: "Accelerate more explosively through contact"
          }
        },
        forwardMomentum: {
          metric: 'forwardMomentum',
          ideal: { min: 0.3 },  // normalized
          weight: 0.15,
          feedback: {
            low: "Move your body forward into the shot - don't hit off your back foot"
          }
        },
        swingSmoothness: {
          metric: 'accelerationSmoothness',
          ideal: { min: 60 },  // 0-100
          weight: 0.10,
          feedback: {
            low: "Smoother acceleration - avoid jerky motions"
          }
        }
      },

      // ==========================================
      // CONTACT PHASE
      // Goal: Hit at optimal contact point with proper arm extension
      // ==========================================
      contact: {
        contactPointHeight: {
          metric: 'contactHeightRelativeToBody',
          ideal: { min: 0.35, max: 0.55 },  // relative to body height (waist to chest)
          weight: 0.20,
          feedback: {
            low: "Contact point too low - let the ball come up more or adjust position",
            high: "Contact point too high - get under the ball more"
          }
        },
        contactPointInFront: {
          metric: 'contactDistanceInFront',
          ideal: { min: 0.08 },  // should be clearly in front of body
          weight: 0.20,
          feedback: {
            low: "Hit the ball more in front of your body - don't let it get behind you"
          }
        },
        armExtension: {
          metric: 'elbowAngleAtContact',
          // CALIBRATED: pro range p25=114°, p75=169° (2026-02-04)
          ideal: { min: 114, max: 169 },  // degrees (fully bent = ~90, straight = 180)
          weight: 0.15,
          feedback: {
            low: "Extend your arm more at contact - don't hit with a bent 'chicken wing' elbow"
          }
        },
        bodyRotationAtContact: {
          metric: 'shoulderRotationAtContact',
          ideal: { min: 10 },  // degrees of rotation from start
          weight: 0.15,
          feedback: {
            low: "Use more body rotation through contact - don't arm the ball"
          }
        }
      },

      // ==========================================
      // FOLLOW-THROUGH PHASE
      // Goal: Complete the swing, maintain balance
      // ==========================================
      followThrough: {
        swingCompletion: {
          metric: 'followThroughComplete',
          ideal: { equals: true },
          weight: 0.20,
          feedback: {
            fail: "Complete your follow-through - let the racket finish over your opposite shoulder"
          }
        },
        decelerationSmoothness: {
          metric: 'decelerationSmoothness',
          ideal: { min: 60 },
          weight: 0.15,
          feedback: {
            low: "Don't stop your swing abruptly - let it flow through naturally"
          }
        },
        balanceAtFinish: {
          metric: 'balanceAtFinish',
          ideal: { equals: true },
          weight: 0.15,
          feedback: {
            fail: "Maintain balance through the finish - you're falling off the shot"
          }
        }
      }
    };
  }

  /**
   * Define common fault detectors
   * These are specific technique problems with clear detection criteria
   */
  defineFaultDetectors() {
    return {
      latePreparation: {
        name: "Late Preparation",
        priority: 10, // highest priority - foundational issue
        detection: (metrics) => {
          return metrics.preparationDuration < 8 || metrics.shoulderRotationAtPrepEnd < 20;
        },
        fix: "Start your shoulder turn as soon as you read the ball direction",
        drills: ["Shadow swing with early turn", "Split step reaction drill"]
      },

      armOnlySwing: {
        name: "Arm-Only Swing",
        priority: 9,
        // CALIBRATED: pro p10=16° for hip-shoulder separation (2026-02-04)
        detection: (metrics) => {
          return metrics.maxHipShoulderSeparation < 16 && metrics.shoulderRotationTotal < 25;
        },
        fix: "Use your whole body - rotate hips first, then shoulders, then arm",
        drills: ["Medicine ball rotation throws", "Hip-lead shadow swings"]
      },

      collapsingElbow: {
        name: "Chicken Wing / Collapsed Elbow",
        priority: 8,
        // CALIBRATED: pro p10=62°, use 100° as threshold (2026-02-04)
        detection: (metrics) => {
          return metrics.elbowAngleAtContact < 100;
        },
        fix: "Keep space between your elbow and body - hit out in front",
        drills: ["Towel under arm drill", "Contact point markers"]
      },

      hittingOffBackFoot: {
        name: "Hitting Off Back Foot",
        priority: 7,
        detection: (metrics) => {
          return metrics.forwardMomentum < 0.2 && metrics.weightAtContactBack > 0.5;
        },
        fix: "Transfer your weight forward through the shot",
        drills: ["Step-through groundstrokes", "Weight transfer focus"]
      },

      abbreviatedFollowThrough: {
        name: "Abbreviated Follow-Through",
        priority: 6,
        detection: (metrics) => {
          return !metrics.followThroughComplete || metrics.followThroughDuration < 6;
        },
        fix: "Let your swing finish naturally over your opposite shoulder",
        drills: ["Freeze at finish drill", "Slow motion swing completion"]
      },

      inconsistentContactPoint: {
        name: "Inconsistent Contact Point",
        priority: 7,
        detection: (metrics) => {
          return metrics.contactPointVariance > 0.12;
        },
        fix: "Move your feet to find the same contact point every time",
        drills: ["Target zone practice", "Footwork adjustment drill"]
      },

      noKneeBend: {
        name: "No Knee Bend / Stiff Legs",
        priority: 5,
        detection: (metrics) => {
          return metrics.kneeBendAngle > 170; // nearly straight legs
        },
        fix: "Bend your knees to load power and improve balance",
        drills: ["Low ball feeding", "Squat-to-swing drill"]
      },

      rushingTheSwing: {
        name: "Rushing the Swing",
        priority: 6,
        detection: (metrics) => {
          return metrics.loadingDuration < 4 && metrics.accelerationSmoothness < 50;
        },
        fix: "Take your time in the loading phase - don't rush to the ball",
        drills: ["Pause at loading drill", "Rhythm and timing focus"]
      }
    };
  }

  /**
   * Evaluate a stroke against all checkpoints
   */
  evaluateStroke(strokeData, sequenceAnalysis) {
    const results = {
      overall: 0,
      byPhase: {},
      passedCheckpoints: [],
      failedCheckpoints: [],
      detectedFaults: [],
      primaryFeedback: null,
      secondaryFeedback: []
    };

    // Extract metrics from stroke data
    const metrics = this.extractMetrics(strokeData, sequenceAnalysis);

    // Evaluate each phase
    let totalWeight = 0;
    let weightedScore = 0;

    for (const [phaseName, phaseCheckpoints] of Object.entries(this.checkpoints)) {
      const phaseResult = this.evaluatePhase(phaseName, phaseCheckpoints, metrics);
      results.byPhase[phaseName] = phaseResult;

      weightedScore += phaseResult.score * phaseResult.totalWeight;
      totalWeight += phaseResult.totalWeight;

      results.passedCheckpoints.push(...phaseResult.passed);
      results.failedCheckpoints.push(...phaseResult.failed);
    }

    results.overall = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;

    // Detect specific faults
    results.detectedFaults = this.detectFaults(metrics);

    // Generate feedback (prioritize most important issues)
    this.generateFeedback(results);

    return results;
  }

  /**
   * Extract all metrics needed for checkpoint evaluation
   */
  extractMetrics(strokeData, sequenceAnalysis) {
    const metrics = {
      // From stroke data
      velocity: strokeData.velocity?.magnitude || 0,
      acceleration: strokeData.acceleration?.magnitude || 0,
      rotation: strokeData.rotation || 0,
      smoothness: strokeData.smoothness || 50,
      elbowAngleAtContact: strokeData.technique?.elbowAngleAtContact || 140,
      hipShoulderSeparation: strokeData.technique?.hipShoulderSeparation || 0,
      kneeBend: strokeData.technique?.kneeBend || 0,
      stance: strokeData.technique?.stance || 'neutral',
      weightTransfer: strokeData.technique?.weightTransfer || 'static',
      contactPointVariance: strokeData.contactPointVariance || 0.05,

      // Contact point metrics
      contactHeightRelativeToBody: strokeData.contactPoint?.height || 0.5,
      contactDistanceInFront: strokeData.contactPoint?.distance || 0.1
    };

    // Add sequence analysis metrics if available
    if (sequenceAnalysis) {
      const seq = sequenceAnalysis;

      // Phase durations
      metrics.preparationDuration = seq.phases?.durations?.preparation || 0;
      metrics.loadingDuration = seq.phases?.durations?.loading || 0;
      metrics.accelerationDuration = seq.phases?.durations?.acceleration || 0;
      metrics.followThroughDuration = seq.phases?.durations?.followThrough || 0;

      // Phase analysis results
      if (seq.phaseAnalysis) {
        metrics.shoulderRotationAtPrepEnd = seq.phaseAnalysis.preparation?.shoulderTurn || 0;
        metrics.splitStepDetected = seq.phaseAnalysis.preparation?.splitStepDetected || false;
        metrics.velocityDuringPrep = seq.phaseAnalysis.preparation?.avgVelocity || 0;

        metrics.maxHipShoulderSeparation = seq.phaseAnalysis.acceleration?.maxHipShoulderSeparation || 0;
        metrics.backFootWeight = seq.phaseAnalysis.loading?.weightOnBackFoot || 0.5;
        metrics.racketBehindBody = seq.phaseAnalysis.loading?.racketBack || false;
        metrics.kneeBendAngle = 180 - (metrics.kneeBend || 0); // Convert to angle

        metrics.peakAcceleration = seq.phaseAnalysis.acceleration?.avgAcceleration || 0;
        metrics.forwardMomentum = seq.phaseAnalysis.acceleration?.forwardMomentum || 0;
        metrics.accelerationSmoothness = seq.phaseAnalysis.acceleration?.accelerationSmoothness || 50;

        metrics.shoulderRotationAtContact = seq.phaseAnalysis.contact?.rotationAtContact || 0;
        metrics.weightAtContactBack = 1 - (seq.phaseAnalysis.contact?.weightForward ? 0.3 : 0.6);

        metrics.followThroughComplete = seq.phaseAnalysis.followThrough?.quality > 60;
        metrics.decelerationSmoothness = seq.phaseAnalysis.followThrough?.decelerationSmoothness || 50;
        metrics.balanceAtFinish = seq.phaseAnalysis.followThrough?.balanced || false;
      }

      // Kinetic chain
      metrics.kineticChainScore = seq.kineticChain?.chainQuality || 50;

      // Overall sequence quality
      metrics.sequenceQuality = seq.sequenceQuality?.overall || 50;
    }

    return metrics;
  }

  /**
   * Evaluate checkpoints for a single phase
   */
  evaluatePhase(phaseName, checkpoints, metrics) {
    const result = {
      score: 0,
      totalWeight: 0,
      passed: [],
      failed: []
    };

    for (const [checkpointName, checkpoint] of Object.entries(checkpoints)) {
      const metricValue = metrics[checkpoint.metric];
      const evaluation = this.evaluateCheckpoint(checkpoint, metricValue);

      result.totalWeight += checkpoint.weight;

      if (evaluation.passed) {
        result.score += checkpoint.weight * 100;
        result.passed.push({
          phase: phaseName,
          checkpoint: checkpointName,
          value: metricValue
        });
      } else {
        result.score += checkpoint.weight * evaluation.partialScore;
        result.failed.push({
          phase: phaseName,
          checkpoint: checkpointName,
          value: metricValue,
          ideal: checkpoint.ideal,
          feedback: evaluation.feedback,
          weight: checkpoint.weight
        });
      }
    }

    if (result.totalWeight > 0) {
      result.score = result.score / result.totalWeight;
    }

    return result;
  }

  /**
   * Evaluate a single checkpoint
   */
  evaluateCheckpoint(checkpoint, value) {
    const ideal = checkpoint.ideal;

    // Boolean check
    if (ideal.equals !== undefined) {
      const passed = value === ideal.equals;
      return {
        passed,
        partialScore: passed ? 100 : 0,
        feedback: passed ? null : checkpoint.feedback.fail
      };
    }

    // Range check
    let passed = true;
    let feedback = null;
    let partialScore = 100;

    if (ideal.min !== undefined && value < ideal.min) {
      passed = false;
      feedback = checkpoint.feedback.low;
      // Partial credit based on how close
      partialScore = Math.max(0, (value / ideal.min) * 70);
    }

    if (ideal.max !== undefined && value > ideal.max) {
      passed = false;
      feedback = checkpoint.feedback.high;
      partialScore = Math.max(0, (ideal.max / value) * 70);
    }

    return { passed, partialScore, feedback };
  }

  /**
   * Detect specific faults
   */
  detectFaults(metrics) {
    const detected = [];

    for (const [faultId, fault] of Object.entries(this.faultDetectors)) {
      try {
        if (fault.detection(metrics)) {
          detected.push({
            id: faultId,
            name: fault.name,
            priority: fault.priority,
            fix: fault.fix,
            drills: fault.drills
          });
        }
      } catch (e) {
        // Skip faults that can't be evaluated due to missing metrics
      }
    }

    // Sort by priority (highest first)
    detected.sort((a, b) => b.priority - a.priority);

    return detected;
  }

  /**
   * Generate prioritized feedback
   */
  generateFeedback(results) {
    // Priority 1: Detected faults (most impactful)
    if (results.detectedFaults.length > 0) {
      results.primaryFeedback = {
        type: 'fault',
        message: results.detectedFaults[0].fix,
        fault: results.detectedFaults[0].name,
        drills: results.detectedFaults[0].drills
      };

      // Secondary feedback from other faults
      results.secondaryFeedback = results.detectedFaults.slice(1, 3).map(f => ({
        type: 'fault',
        message: f.fix,
        fault: f.name
      }));
      return;
    }

    // Priority 2: Failed checkpoints (sorted by weight)
    const sortedFailed = results.failedCheckpoints
      .filter(f => f.feedback)
      .sort((a, b) => b.weight - a.weight);

    if (sortedFailed.length > 0) {
      results.primaryFeedback = {
        type: 'checkpoint',
        message: sortedFailed[0].feedback,
        phase: sortedFailed[0].phase,
        checkpoint: sortedFailed[0].checkpoint
      };

      results.secondaryFeedback = sortedFailed.slice(1, 3).map(f => ({
        type: 'checkpoint',
        message: f.feedback,
        phase: f.phase
      }));
      return;
    }

    // Priority 3: Everything passed - positive feedback
    results.primaryFeedback = {
      type: 'positive',
      message: "Excellent technique! All checkpoints passed."
    };
  }

  /**
   * Get drill recommendations based on detected issues
   */
  getDrillRecommendations(results) {
    const drills = [];

    // From detected faults
    for (const fault of results.detectedFaults.slice(0, 2)) {
      drills.push(...fault.drills);
    }

    // Deduplicate
    return [...new Set(drills)].slice(0, 5);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BiomechanicalCheckpoints;
} else {
  window.BiomechanicalCheckpoints = BiomechanicalCheckpoints;
}
