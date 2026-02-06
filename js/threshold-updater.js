/**
 * Threshold Updater
 *
 * Automatically generates updated threshold values based on calibration data
 * and can apply them to the running application or export for permanent changes.
 */

class ThresholdUpdater {
  constructor() {
    this.calibrationTool = null;
    this.currentThresholds = this.captureCurrentThresholds();
    this.calibratedThresholds = null;
  }

  /**
   * Capture current thresholds from running application
   */
  captureCurrentThresholds() {
    const thresholds = {
      strokeClassifier: {},
      professionalReferences: {},
      coachingTree: {},
      biomechanicalCheckpoints: {}
    };

    // From StrokeClassifier
    if (typeof StrokeClassifier !== 'undefined') {
      const sc = new StrokeClassifier();
      thresholds.strokeClassifier = {
        strokeThresholds: sc.strokeThresholds,
        velocityThresholds: sc.velocityThresholds,
        accelerationThresholds: sc.accelerationThresholds,
        qualityWeights: sc.qualityWeights
      };
    }

    // From ProfessionalReferences
    if (typeof ProfessionalReferences !== 'undefined') {
      const pr = new ProfessionalReferences();
      thresholds.professionalReferences = {
        strokePatterns: pr.strokePatterns,
        benchmarkMetrics: pr.benchmarkMetrics
      };
    }

    return thresholds;
  }

  /**
   * Generate new thresholds from calibration data
   */
  generateCalibratedThresholds() {
    if (typeof calibrationTool === 'undefined') {
      return { error: 'Calibration tool not available' };
    }

    const proStats = calibrationTool.getAggregateStats('professional');
    const advStats = calibrationTool.getAggregateStats('advanced');
    const intStats = calibrationTool.getAggregateStats('intermediate');
    const begStats = calibrationTool.getAggregateStats('beginner');

    if (proStats.error && advStats.error) {
      return { error: 'No calibration data available. Run calibration on videos first.' };
    }

    const calibrated = {
      timestamp: new Date().toISOString(),
      basedOnStrokes: {
        professional: proStats.totalStrokes || 0,
        advanced: advStats.totalStrokes || 0,
        intermediate: intStats.totalStrokes || 0,
        beginner: begStats.totalStrokes || 0
      },

      // Stroke detection thresholds
      strokeDetection: this.generateStrokeDetectionThresholds(proStats, advStats, intStats, begStats),

      // Velocity thresholds by stroke type
      velocityThresholds: this.generateVelocityThresholds(proStats, advStats, intStats),

      // Acceleration thresholds by stroke type
      accelerationThresholds: this.generateAccelerationThresholds(proStats, advStats, intStats),

      // Professional reference patterns
      professionalPatterns: this.generateProfessionalPatterns(proStats),

      // Skill level classification thresholds
      skillLevelThresholds: this.generateSkillLevelThresholds(proStats, advStats, intStats, begStats),

      // Biomechanical checkpoint thresholds
      biomechanicalThresholds: this.generateBiomechanicalThresholds(proStats)
    };

    this.calibratedThresholds = calibrated;
    return calibrated;
  }

  /**
   * Generate stroke detection thresholds
   */
  generateStrokeDetectionThresholds(pro, adv, int, beg) {
    // Use the lowest skill level's minimum as the detection threshold
    // This ensures we catch all strokes, even slow beginner ones
    const allStats = [pro, adv, int, beg].filter(s => s.metrics?.velocity);

    if (allStats.length === 0) {
      return this.currentThresholds.strokeClassifier?.strokeThresholds || {};
    }

    // Find the minimum velocity that should still be detected as a stroke
    let minVelocity = 0.025; // default
    let minAcceleration = 0.008; // default

    for (const stats of allStats) {
      if (stats.metrics?.velocity?.p10) {
        // Use 10th percentile as the minimum (catches 90% of strokes)
        minVelocity = Math.min(minVelocity, stats.metrics.velocity.p10 * 0.8);
      }
      if (stats.metrics?.acceleration?.p10) {
        minAcceleration = Math.min(minAcceleration, stats.metrics.acceleration.p10 * 0.8);
      }
    }

    return {
      minVelocity: Math.max(0.015, minVelocity), // Floor at 0.015 to avoid noise
      minAcceleration: Math.max(0.005, minAcceleration),
      serveVerticalThreshold: 0.25, // Keep existing
      overheadVerticalThreshold: 0.2,
      volleyVerticalThreshold: 0.1,
      rotationThreshold: 15
    };
  }

  /**
   * Generate velocity thresholds by skill level
   */
  generateVelocityThresholds(pro, adv, int) {
    const thresholds = {};
    const strokeTypes = ['Forehand', 'Backhand', 'Serve', 'Volley', 'Overhead'];

    for (const strokeType of strokeTypes) {
      // Use overall velocity stats (we don't have per-stroke-type data yet)
      thresholds[strokeType] = {
        professional: this.extractThresholdTier(pro.metrics?.velocity, 'professional'),
        advanced: this.extractThresholdTier(adv.metrics?.velocity, 'advanced'),
        intermediate: this.extractThresholdTier(int.metrics?.velocity, 'intermediate')
      };
    }

    return thresholds;
  }

  /**
   * Extract threshold tier from stats
   */
  extractThresholdTier(stats, level) {
    if (!stats) {
      // Return current defaults
      const defaults = {
        professional: { average: 0.055, good: 0.045, excellent: 0.065 },
        advanced: { average: 0.045, good: 0.035, excellent: 0.055 },
        intermediate: { average: 0.035, good: 0.025, excellent: 0.045 }
      };
      return defaults[level];
    }

    return {
      average: stats.median || stats.avg,
      good: stats.p25 || stats.avg * 0.8,
      excellent: stats.p75 || stats.avg * 1.2
    };
  }

  /**
   * Generate acceleration thresholds
   */
  generateAccelerationThresholds(pro, adv, int) {
    const thresholds = {};
    const strokeTypes = ['Forehand', 'Backhand', 'Serve', 'Volley', 'Overhead'];

    for (const strokeType of strokeTypes) {
      thresholds[strokeType] = {
        professional: this.extractAccelThreshold(pro.metrics?.acceleration, 'professional'),
        advanced: this.extractAccelThreshold(adv.metrics?.acceleration, 'advanced'),
        intermediate: this.extractAccelThreshold(int.metrics?.acceleration, 'intermediate')
      };
    }

    return thresholds;
  }

  extractAccelThreshold(stats, level) {
    if (!stats) {
      const defaults = {
        professional: { average: 0.018, good: 0.015, excellent: 0.025 },
        advanced: { average: 0.015, good: 0.012, excellent: 0.020 },
        intermediate: { average: 0.012, good: 0.008, excellent: 0.016 }
      };
      return defaults[level];
    }

    return {
      average: stats.median || stats.avg,
      good: stats.p25 || stats.avg * 0.75,
      excellent: stats.p75 || stats.avg * 1.3
    };
  }

  /**
   * Generate professional pattern references
   */
  generateProfessionalPatterns(pro) {
    if (!pro.metrics) return null;

    return {
      Forehand: {
        averageVelocity: pro.metrics.velocity?.avg || 0.055,
        peakVelocity: pro.metrics.velocity?.max || 0.075,
        averageAcceleration: pro.metrics.acceleration?.avg || 0.018,
        peakAcceleration: pro.metrics.acceleration?.max || 0.028,
        averageRotation: pro.metrics.rotation?.avg || 25,
        elbowAngleAtContact: pro.metrics.elbowAngle?.avg || 150,
        hipShoulderSeparation: pro.metrics.hipShoulderSeparation?.avg || 30
      },
      Backhand: {
        averageVelocity: (pro.metrics.velocity?.avg || 0.055) * 0.9,
        peakVelocity: (pro.metrics.velocity?.max || 0.075) * 0.9,
        averageAcceleration: pro.metrics.acceleration?.avg || 0.016,
        averageRotation: (pro.metrics.rotation?.avg || 25) * -1, // Negative for backhand
        elbowAngleAtContact: pro.metrics.elbowAngle?.avg || 145
      },
      Serve: {
        averageVelocity: (pro.metrics.velocity?.avg || 0.055) * 1.2,
        peakVelocity: (pro.metrics.velocity?.max || 0.075) * 1.2,
        averageAcceleration: (pro.metrics.acceleration?.avg || 0.018) * 1.3
      }
    };
  }

  /**
   * Generate skill level classification thresholds
   */
  generateSkillLevelThresholds(pro, adv, int, beg) {
    return {
      beginner: {
        velocity: { max: int.metrics?.velocity?.p25 || 0.032 },
        consistency: { max: 65 },
        quality: { max: 60 }
      },
      intermediate: {
        velocity: {
          min: int.metrics?.velocity?.p25 || 0.032,
          max: adv.metrics?.velocity?.p50 || 0.047
        },
        consistency: { min: 65, max: 80 },
        quality: { min: 60, max: 75 }
      },
      advanced: {
        velocity: {
          min: adv.metrics?.velocity?.p25 || 0.047,
          max: pro.metrics?.velocity?.p50 || 0.055
        },
        consistency: { min: 80, max: 88 },
        quality: { min: 75, max: 82 }
      },
      elite: {
        velocity: { min: pro.metrics?.velocity?.p50 || 0.055 },
        consistency: { min: 88 },
        quality: { min: 82 }
      }
    };
  }

  /**
   * Generate biomechanical checkpoint thresholds
   */
  generateBiomechanicalThresholds(pro) {
    if (!pro.metrics) return null;

    return {
      elbowAngle: {
        ideal: {
          min: pro.metrics.elbowAngle?.p25 || 140,
          max: pro.metrics.elbowAngle?.p75 || 170
        },
        chickenWingThreshold: pro.metrics.elbowAngle?.p10 || 130
      },
      hipShoulderSeparation: {
        ideal: {
          min: pro.metrics.hipShoulderSeparation?.p25 || 25,
          max: pro.metrics.hipShoulderSeparation?.p75 || 50
        },
        minimumForPower: pro.metrics.hipShoulderSeparation?.p10 || 20
      },
      rotation: {
        minimumForGroundstroke: pro.metrics.rotation?.p10 || 15,
        goodRotation: pro.metrics.rotation?.p50 || 25,
        excellentRotation: pro.metrics.rotation?.p75 || 35
      }
    };
  }

  /**
   * Apply calibrated thresholds to running application
   */
  applyToRunningApp() {
    if (!this.calibratedThresholds) {
      this.generateCalibratedThresholds();
    }

    if (!this.calibratedThresholds || this.calibratedThresholds.error) {
      console.error('No calibrated thresholds to apply');
      return { success: false, error: this.calibratedThresholds?.error || 'No calibration data available' };
    }

    const ct = this.calibratedThresholds;
    const updatedModules = [];

    // Apply to StrokeClassifier
    if (typeof tennisAI !== 'undefined' && tennisAI.enhancedAnalyzer) {
      const sc = tennisAI.enhancedAnalyzer.strokeClassifier;

      if (ct.strokeDetection) {
        sc.strokeThresholds = { ...sc.strokeThresholds, ...ct.strokeDetection };
        updatedModules.push('Stroke Detection');
        console.log('Applied stroke detection thresholds');
      }

      if (ct.velocityThresholds) {
        for (const [strokeType, levels] of Object.entries(ct.velocityThresholds)) {
          if (levels.professional) {
            sc.velocityThresholds[strokeType] = levels.professional;
          }
        }
        updatedModules.push('Velocity Thresholds');
        console.log('Applied velocity thresholds');
      }

      if (ct.accelerationThresholds) {
        for (const [strokeType, levels] of Object.entries(ct.accelerationThresholds)) {
          if (levels.professional) {
            sc.accelerationThresholds[strokeType] = levels.professional;
          }
        }
        updatedModules.push('Acceleration Thresholds');
        console.log('Applied acceleration thresholds');
      }
    }

    // Apply to ProfessionalReferences
    if (typeof tennisAI !== 'undefined' && tennisAI.enhancedAnalyzer) {
      const pr = tennisAI.enhancedAnalyzer.proReferences;

      if (ct.professionalPatterns && pr) {
        for (const [strokeType, pattern] of Object.entries(ct.professionalPatterns)) {
          if (pr.strokePatterns && pr.strokePatterns[strokeType]) {
            pr.strokePatterns[strokeType].professional = {
              ...pr.strokePatterns[strokeType].professional,
              ...pattern
            };
          }
        }
        updatedModules.push('Pro Reference Patterns');
        console.log('Applied professional reference patterns');
      }
    }

    console.log('Calibrated thresholds applied to running application');
    return { success: true, updatedModules };
  }

  /**
   * Generate code snippets to permanently update source files
   */
  generateCodeUpdates() {
    if (!this.calibratedThresholds) {
      this.generateCalibratedThresholds();
    }

    if (!this.calibratedThresholds || this.calibratedThresholds.error) {
      return { error: this.calibratedThresholds?.error || 'No calibration data' };
    }

    const ct = this.calibratedThresholds;

    return {
      // Update for stroke-classifier.js
      strokeClassifier: this.generateStrokeClassifierUpdate(ct),

      // Update for professional-references.js
      professionalReferences: this.generateProfessionalReferencesUpdate(ct),

      // Update for tennis_coaching_tree.json
      coachingTree: this.generateCoachingTreeUpdate(ct),

      // Update for biomechanical-checkpoints.js
      biomechanicalCheckpoints: this.generateBiomechanicalUpdate(ct)
    };
  }

  /**
   * Generate stroke-classifier.js update
   */
  generateStrokeClassifierUpdate(ct) {
    return `
// ============================================
// CALIBRATED THRESHOLDS - Generated ${ct.timestamp}
// Based on ${ct.basedOnStrokes.professional} professional strokes
// ============================================

// Replace strokeThresholds in stroke-classifier.js constructor:
this.strokeThresholds = ${JSON.stringify(ct.strokeDetection, null, 2)};

// Replace velocityThresholds:
this.velocityThresholds = {
${Object.entries(ct.velocityThresholds).map(([stroke, data]) =>
  `  '${stroke}': ${JSON.stringify(data.professional)}`
).join(',\n')}
};

// Replace accelerationThresholds:
this.accelerationThresholds = {
${Object.entries(ct.accelerationThresholds).map(([stroke, data]) =>
  `  '${stroke}': ${JSON.stringify(data.professional)}`
).join(',\n')}
};
`;
  }

  /**
   * Generate professional-references.js update
   */
  generateProfessionalReferencesUpdate(ct) {
    if (!ct.professionalPatterns) return '// No professional pattern data available';

    return `
// ============================================
// CALIBRATED PROFESSIONAL PATTERNS - Generated ${ct.timestamp}
// ============================================

// Update strokePatterns in professional-references.js:
'Forehand': {
  professional: ${JSON.stringify(ct.professionalPatterns.Forehand, null, 4)},
  // ... keep advanced and intermediate as before
},
'Backhand': {
  professional: ${JSON.stringify(ct.professionalPatterns.Backhand, null, 4)},
  // ... keep advanced and intermediate as before
},
'Serve': {
  professional: ${JSON.stringify(ct.professionalPatterns.Serve, null, 4)},
  // ... keep advanced and intermediate as before
}
`;
  }

  /**
   * Generate tennis_coaching_tree.json update
   */
  generateCoachingTreeUpdate(ct) {
    return `
// ============================================
// CALIBRATED SKILL LEVEL THRESHOLDS - Generated ${ct.timestamp}
// ============================================

// Update skillLevelThresholds in tennis_coaching_tree.json:
"skillLevelThresholds": ${JSON.stringify(ct.skillLevelThresholds, null, 2)}
`;
  }

  /**
   * Generate biomechanical-checkpoints.js update
   */
  generateBiomechanicalUpdate(ct) {
    if (!ct.biomechanicalThresholds) return '// No biomechanical data available';

    return `
// ============================================
// CALIBRATED BIOMECHANICAL THRESHOLDS - Generated ${ct.timestamp}
// ============================================

// Update checkpoint ideal ranges in biomechanical-checkpoints.js:

// armExtension checkpoint:
armExtension: {
  metric: 'elbowAngleAtContact',
  ideal: { min: ${ct.biomechanicalThresholds.elbowAngle.ideal.min}, max: ${ct.biomechanicalThresholds.elbowAngle.ideal.max} },
  // ...
}

// hipShoulderSeparation checkpoint:
hipShoulderSeparation: {
  metric: 'maxHipShoulderSeparation',
  ideal: { min: ${ct.biomechanicalThresholds.hipShoulderSeparation.ideal.min}, max: ${ct.biomechanicalThresholds.hipShoulderSeparation.ideal.max} },
  // ...
}

// Update fault detectors:
collapsingElbow: {
  detection: (metrics) => metrics.elbowAngleAtContact < ${ct.biomechanicalThresholds.elbowAngle.chickenWingThreshold},
  // ...
}

armOnlySwing: {
  detection: (metrics) => metrics.maxHipShoulderSeparation < ${ct.biomechanicalThresholds.hipShoulderSeparation.minimumForPower},
  // ...
}
`;
  }

  /**
   * Export all updates as a downloadable file
   */
  exportUpdates() {
    const updates = this.generateCodeUpdates();

    if (updates.error) {
      console.error(updates.error);
      return;
    }

    const content = `
/*
 * TechniqueAI Calibrated Thresholds
 * Generated: ${new Date().toISOString()}
 *
 * Instructions:
 * 1. Review the recommended changes below
 * 2. Copy the relevant sections to update each file
 * 3. Test with a few strokes to verify the changes work
 */

// ============================================
// STROKE-CLASSIFIER.JS UPDATES
// ============================================
${updates.strokeClassifier}

// ============================================
// PROFESSIONAL-REFERENCES.JS UPDATES
// ============================================
${updates.professionalReferences}

// ============================================
// TENNIS_COACHING_TREE.JSON UPDATES
// ============================================
${updates.coachingTree}

// ============================================
// BIOMECHANICAL-CHECKPOINTS.JS UPDATES
// ============================================
${updates.biomechanicalCheckpoints}

// ============================================
// RAW CALIBRATION DATA
// ============================================
const calibrationData = ${JSON.stringify(this.calibratedThresholds, null, 2)};
`;

    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `threshold-updates-${new Date().toISOString().split('T')[0]}.js`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Threshold updates exported');
  }

  /**
   * Print summary of current vs calibrated thresholds
   */
  printComparison() {
    if (!this.calibratedThresholds) {
      this.generateCalibratedThresholds();
    }

    if (!this.calibratedThresholds || this.calibratedThresholds.error) {
      console.log('No calibration data available');
      return;
    }

    const ct = this.calibratedThresholds;
    const current = this.currentThresholds;

    console.group('Threshold Comparison: Current vs Calibrated');

    console.log('\n=== STROKE DETECTION ===');
    console.table({
      'Min Velocity': {
        Current: current.strokeClassifier?.strokeThresholds?.minVelocity || 0.025,
        Calibrated: ct.strokeDetection?.minVelocity?.toFixed(4) || 'N/A'
      },
      'Min Acceleration': {
        Current: current.strokeClassifier?.strokeThresholds?.minAcceleration || 0.008,
        Calibrated: ct.strokeDetection?.minAcceleration?.toFixed(4) || 'N/A'
      }
    });

    console.log('\n=== PROFESSIONAL VELOCITY (Forehand) ===');
    const currVel = current.strokeClassifier?.velocityThresholds?.Forehand;
    const calVel = ct.velocityThresholds?.Forehand?.professional;
    if (currVel && calVel) {
      console.table({
        'Average': { Current: currVel.average, Calibrated: calVel.average?.toFixed(4) },
        'Good': { Current: currVel.good, Calibrated: calVel.good?.toFixed(4) },
        'Excellent': { Current: currVel.excellent, Calibrated: calVel.excellent?.toFixed(4) }
      });
    }

    console.log('\n=== SKILL LEVEL THRESHOLDS ===');
    if (ct.skillLevelThresholds) {
      console.table({
        'Beginner Max Velocity': { Value: ct.skillLevelThresholds.beginner?.velocity?.max?.toFixed(4) },
        'Intermediate Min': { Value: ct.skillLevelThresholds.intermediate?.velocity?.min?.toFixed(4) },
        'Advanced Min': { Value: ct.skillLevelThresholds.advanced?.velocity?.min?.toFixed(4) },
        'Elite Min': { Value: ct.skillLevelThresholds.elite?.velocity?.min?.toFixed(4) }
      });
    }

    console.log('\n=== BASED ON ===');
    console.table(ct.basedOnStrokes);

    console.groupEnd();
  }
}

// Global instance
const thresholdUpdater = new ThresholdUpdater();

// Add keyboard shortcut (Ctrl+Shift+U)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'U') {
    thresholdUpdater.printComparison();
  }
});
