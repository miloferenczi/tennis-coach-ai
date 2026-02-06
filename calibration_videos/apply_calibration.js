/**
 * TechniqueAI Calibrated Thresholds
 * Generated from professional tennis video analysis
 * Date: 2026-02-04
 *
 * Source: Court-level pro tennis video (13 minutes)
 * Strokes analyzed: 243 (121 Forehand, 114 Backhand, 8 Serve)
 */

const CALIBRATION_DATA = {
  timestamp: "2026-02-04T22:32:23",
  totalStrokes: 243,
  strokeDistribution: {
    Forehand: 121,
    Backhand: 114,
    Serve: 8
  },

  // Raw metrics from professional players (normalized units per second)
  metrics: {
    velocity: {
      min: 1.86,
      max: 61.23,
      avg: 12.60,
      median: 9.25,
      p10: 3.44,
      p25: 5.28,
      p75: 16.04,
      p90: 23.76
    },
    acceleration: {
      min: 43.35,
      max: 3604.65,
      avg: 640.73,
      median: 409.12,
      p10: 135.66,
      p25: 227.20,
      p75: 892.13,
      p90: 1304.30
    },
    elbowAngle: {
      min: 19.40,
      max: 178.77,
      avg: 134.69,
      median: 149.17,
      p10: 62.35,
      p25: 113.56,
      p75: 169.05,
      p90: 174.89
    },
    hipShoulderSeparation: {
      min: 4.59,
      max: 357.02,
      avg: 139.78,
      median: 69.16,
      p10: 15.68,
      p25: 34.26,
      p75: 283.71,
      p90: 332.25
    },
    kneeBend: {
      min: 1.87,
      max: 170.56,
      avg: 86.96,
      median: 99.50,
      p10: 17.59,
      p25: 32.84,
      p75: 133.54,
      p90: 151.68
    }
  }
};

/**
 * NOTE: The calibration was done using MediaPipe's pose landmarker with:
 * - Normalized coordinates (0-1 range)
 * - Velocity = change in position / dt where dt = 1/fps
 * - This gives velocity in "normalized units per second"
 *
 * The browser app uses similar normalized coordinates but may calculate
 * velocity differently (per frame vs per second). Adjust the scaling
 * factor below based on how the app calculates velocity.
 */

// Scaling factor: if app uses velocity per frame at 30fps, divide by 30
// If app uses same per-second calculation, use 1.0
const VELOCITY_SCALE = 1/30;  // Convert per-second to per-frame at 30fps

const CALIBRATED_THRESHOLDS = {
  // Stroke detection - use 10th percentile * 0.8 as minimum
  strokeDetection: {
    minVelocity: CALIBRATION_DATA.metrics.velocity.p10 * VELOCITY_SCALE * 0.8,
    minAcceleration: CALIBRATION_DATA.metrics.acceleration.p10 * VELOCITY_SCALE * VELOCITY_SCALE * 0.8
  },

  // Professional quality thresholds
  velocityThresholds: {
    Forehand: {
      average: CALIBRATION_DATA.metrics.velocity.median * VELOCITY_SCALE,
      good: CALIBRATION_DATA.metrics.velocity.p25 * VELOCITY_SCALE,
      excellent: CALIBRATION_DATA.metrics.velocity.p75 * VELOCITY_SCALE
    },
    Backhand: {
      average: CALIBRATION_DATA.metrics.velocity.median * VELOCITY_SCALE * 0.9,
      good: CALIBRATION_DATA.metrics.velocity.p25 * VELOCITY_SCALE * 0.9,
      excellent: CALIBRATION_DATA.metrics.velocity.p75 * VELOCITY_SCALE * 0.9
    },
    Serve: {
      average: CALIBRATION_DATA.metrics.velocity.median * VELOCITY_SCALE * 1.2,
      good: CALIBRATION_DATA.metrics.velocity.p25 * VELOCITY_SCALE * 1.2,
      excellent: CALIBRATION_DATA.metrics.velocity.p75 * VELOCITY_SCALE * 1.2
    }
  },

  // Biomechanical checkpoints
  biomechanical: {
    elbowAngle: {
      ideal: {
        min: Math.round(CALIBRATION_DATA.metrics.elbowAngle.p25),
        max: Math.round(CALIBRATION_DATA.metrics.elbowAngle.p75)
      },
      chickenWingThreshold: Math.round(CALIBRATION_DATA.metrics.elbowAngle.p10)
    },
    hipShoulderSeparation: {
      ideal: {
        min: Math.round(CALIBRATION_DATA.metrics.hipShoulderSeparation.p25),
        max: Math.min(90, Math.round(CALIBRATION_DATA.metrics.hipShoulderSeparation.p75))
      },
      minimumForPower: Math.round(CALIBRATION_DATA.metrics.hipShoulderSeparation.p10)
    },
    kneeBend: {
      ideal: {
        min: Math.round(CALIBRATION_DATA.metrics.kneeBend.p25),
        max: Math.round(CALIBRATION_DATA.metrics.kneeBend.p75)
      }
    }
  }
};

// Print out the calibrated values
console.log('=== CALIBRATED THRESHOLDS ===');
console.log(JSON.stringify(CALIBRATED_THRESHOLDS, null, 2));

console.log('\n=== CODE UPDATES FOR stroke-classifier.js ===');
console.log(`
// In StrokeClassifier constructor, update strokeThresholds:
this.strokeThresholds = {
  minVelocity: ${CALIBRATED_THRESHOLDS.strokeDetection.minVelocity.toFixed(6)},
  minAcceleration: ${CALIBRATED_THRESHOLDS.strokeDetection.minAcceleration.toFixed(6)},
  // ... keep other thresholds
};

// Update velocityThresholds:
this.velocityThresholds = {
  'Forehand': {
    average: ${CALIBRATED_THRESHOLDS.velocityThresholds.Forehand.average.toFixed(6)},
    good: ${CALIBRATED_THRESHOLDS.velocityThresholds.Forehand.good.toFixed(6)},
    excellent: ${CALIBRATED_THRESHOLDS.velocityThresholds.Forehand.excellent.toFixed(6)}
  },
  'Backhand': {
    average: ${CALIBRATED_THRESHOLDS.velocityThresholds.Backhand.average.toFixed(6)},
    good: ${CALIBRATED_THRESHOLDS.velocityThresholds.Backhand.good.toFixed(6)},
    excellent: ${CALIBRATED_THRESHOLDS.velocityThresholds.Backhand.excellent.toFixed(6)}
  },
  'Serve': {
    average: ${CALIBRATED_THRESHOLDS.velocityThresholds.Serve.average.toFixed(6)},
    good: ${CALIBRATED_THRESHOLDS.velocityThresholds.Serve.good.toFixed(6)},
    excellent: ${CALIBRATED_THRESHOLDS.velocityThresholds.Serve.excellent.toFixed(6)}
  }
};
`);

console.log('\n=== CODE UPDATES FOR biomechanical-checkpoints.js ===');
console.log(`
// Update checkpoint ideal ranges:
armExtension: {
  metric: 'elbowAngleAtContact',
  ideal: { min: ${CALIBRATED_THRESHOLDS.biomechanical.elbowAngle.ideal.min}, max: ${CALIBRATED_THRESHOLDS.biomechanical.elbowAngle.ideal.max} },
  weight: 0.25
}

// Update fault detectors:
collapsingElbow (chicken wing threshold): ${CALIBRATED_THRESHOLDS.biomechanical.elbowAngle.chickenWingThreshold}°
armOnlySwing (min hip-shoulder separation): ${CALIBRATED_THRESHOLDS.biomechanical.hipShoulderSeparation.minimumForPower}°
`);

// Export for use in browser
if (typeof window !== 'undefined') {
  window.CALIBRATION_DATA = CALIBRATION_DATA;
  window.CALIBRATED_THRESHOLDS = CALIBRATED_THRESHOLDS;
}

if (typeof module !== 'undefined') {
  module.exports = { CALIBRATION_DATA, CALIBRATED_THRESHOLDS };
}
