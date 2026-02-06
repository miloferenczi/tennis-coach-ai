/**
 * Calibration Tool
 *
 * Analyzes video files using the same pipeline as the main app
 * to extract metric distributions for threshold calibration.
 *
 * Usage:
 * 1. Upload a pro tennis video via the calibration UI
 * 2. The tool runs it through MediaPipe + our analysis pipeline
 * 3. Collects all metrics from detected strokes
 * 4. Generates recommended threshold updates
 */

class CalibrationTool {
  constructor() {
    this.isCalibrating = false;
    this.calibrationData = {
      label: '',  // e.g., "professional", "advanced", "beginner"
      player: '',
      strokeType: '',
      strokes: [],
      metrics: {}
    };

    // Reference to the main analyzer (uses same pipeline)
    this.analyzer = null;
    this.pose = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;

    // Calibration results storage
    this.allCalibrationRuns = this.loadCalibrationRuns();
  }

  /**
   * Initialize MediaPipe Pose for calibration
   */
  async initialize() {
    this.pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    this.pose.setOptions({
      modelComplexity: 2,  // Use highest accuracy for calibration
      smoothLandmarks: false,  // Don't smooth - we want raw data
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    // Create a dedicated analyzer for calibration
    this.analyzer = new EnhancedTennisAnalyzer();

    return new Promise((resolve, reject) => {
      this.pose.onResults((results) => this.onPoseResults(results));
      this.pose.initialize().then(() => {
        console.log('Calibration tool initialized');
        resolve();
      }).catch(reject);
    });
  }

  /**
   * Start calibration from a video file
   */
  async calibrateFromVideo(file, options = {}) {
    const {
      label = 'professional',
      player = 'unknown',
      strokeType = 'all',
      onProgress = null,
      onStrokeDetected = null
    } = options;

    this.isCalibrating = true;
    this.calibrationData = {
      label,
      player,
      strokeType,
      strokes: [],
      metrics: {},
      startTime: Date.now()
    };

    // Reset analyzer state
    this.analyzer.resetSession();

    // Load video
    const videoInfo = await this.loadVideo(file);
    console.log(`Calibrating video: ${videoInfo.duration.toFixed(1)}s, ${videoInfo.width}x${videoInfo.height}`);

    // Process video frame by frame
    const fps = 30;
    const totalFrames = Math.floor(videoInfo.duration * fps);
    const frameInterval = 1;  // Analyze every frame for accuracy

    let processedFrames = 0;
    let lastStrokeCount = 0;

    for (let frameNum = 0; frameNum < totalFrames && this.isCalibrating; frameNum += frameInterval) {
      const time = frameNum / fps;

      // Seek to frame
      await this.seekToTime(time);

      // Draw frame to canvas
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

      // Run pose detection
      await this.pose.send({ image: this.canvas });

      // Check for new strokes
      if (this.calibrationData.strokes.length > lastStrokeCount) {
        const newStroke = this.calibrationData.strokes[this.calibrationData.strokes.length - 1];
        if (onStrokeDetected) {
          onStrokeDetected(newStroke, this.calibrationData.strokes.length);
        }
        lastStrokeCount = this.calibrationData.strokes.length;
      }

      processedFrames++;

      // Progress callback
      if (onProgress && processedFrames % 30 === 0) {
        onProgress({
          progress: (frameNum / totalFrames) * 100,
          framesProcessed: processedFrames,
          strokesDetected: this.calibrationData.strokes.length,
          currentTime: time
        });
      }
    }

    this.isCalibrating = false;

    // Calculate statistics
    const results = this.calculateCalibrationResults();

    // Store this calibration run
    this.saveCalibrationRun(results);

    return results;
  }

  /**
   * Load video file
   */
  loadVideo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);

      this.video = document.createElement('video');
      this.video.src = url;
      this.video.muted = true;
      this.video.playsInline = true;

      this.video.onloadedmetadata = () => {
        // Create canvas matching video dimensions
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx = this.canvas.getContext('2d');

        resolve({
          duration: this.video.duration,
          width: this.video.videoWidth,
          height: this.video.videoHeight
        });
      };

      this.video.onerror = () => reject(new Error('Failed to load video'));
    });
  }

  /**
   * Seek video to specific time
   */
  seekToTime(time) {
    return new Promise((resolve) => {
      this.video.currentTime = time;
      this.video.onseeked = () => resolve();
    });
  }

  /**
   * Handle pose detection results
   */
  onPoseResults(results) {
    if (!results.poseLandmarks || !this.isCalibrating) return;

    // Convert landmarks to the format our analyzer expects
    const landmarks = results.poseLandmarks;

    // Build pose data structure matching what the main app uses
    const poseData = this.buildPoseData(landmarks);

    // Feed to analyzer (same as main app)
    this.analyzer.analyze(poseData);

    // Check if a stroke was detected
    const strokeData = this.analyzer.getLastStrokeData();
    if (strokeData && !this.isStrokeAlreadyRecorded(strokeData)) {
      this.recordStroke(strokeData);
    }
  }

  /**
   * Build pose data structure from landmarks
   */
  buildPoseData(landmarks) {
    // Map MediaPipe landmarks to our joint structure
    const joints = {
      nose: landmarks[0],
      leftShoulder: landmarks[11],
      rightShoulder: landmarks[12],
      leftElbow: landmarks[13],
      rightElbow: landmarks[14],
      leftWrist: landmarks[15],
      rightWrist: landmarks[16],
      leftHip: landmarks[23],
      rightHip: landmarks[24],
      leftKnee: landmarks[25],
      rightKnee: landmarks[26],
      leftAnkle: landmarks[27],
      rightAnkle: landmarks[28]
    };

    return {
      landmarks,
      joints,
      timestamp: Date.now()
    };
  }

  /**
   * Check if stroke is already recorded (prevent duplicates)
   */
  isStrokeAlreadyRecorded(strokeData) {
    if (this.calibrationData.strokes.length === 0) return false;

    const lastStroke = this.calibrationData.strokes[this.calibrationData.strokes.length - 1];
    return Math.abs(strokeData.timestamp - lastStroke.timestamp) < 500;
  }

  /**
   * Record a detected stroke with all metrics
   */
  recordStroke(strokeData) {
    const strokeRecord = {
      timestamp: strokeData.timestamp,
      type: strokeData.type,

      // Physics metrics
      velocity: strokeData.velocity?.magnitude || 0,
      velocityX: strokeData.velocity?.components?.x || 0,
      velocityY: strokeData.velocity?.components?.y || 0,
      acceleration: strokeData.acceleration?.magnitude || 0,
      rotation: strokeData.rotation || 0,
      verticalMotion: strokeData.verticalMotion || 0,
      smoothness: strokeData.smoothness || 0,

      // Technique metrics
      elbowAngle: strokeData.technique?.elbowAngleAtContact || 0,
      shoulderRotation: strokeData.technique?.shoulderRotation || 0,
      hipShoulderSeparation: strokeData.technique?.hipShoulderSeparation || 0,
      kneeBend: strokeData.technique?.kneeBend || 0,
      stance: strokeData.technique?.stance || 'unknown',
      weightTransfer: strokeData.technique?.weightTransfer || 'unknown',

      // Contact point
      contactHeight: strokeData.contactPoint?.height || 0,
      contactDistance: strokeData.contactPoint?.distance || 0,

      // Quality scores
      qualityOverall: strokeData.quality?.overall || 0,
      qualityVelocity: strokeData.quality?.breakdown?.velocity || 0,
      qualityAcceleration: strokeData.quality?.breakdown?.acceleration || 0,
      qualityRotation: strokeData.quality?.breakdown?.rotation || 0,
      qualitySmoothness: strokeData.quality?.breakdown?.smoothness || 0,

      // Sequence analysis (if available)
      sequenceQuality: strokeData.sequenceAnalysis?.sequenceQuality?.overall || null,
      kineticChainQuality: strokeData.sequenceAnalysis?.kineticChain?.chainQuality || null,

      // Biomechanical (if available)
      biomechanicalScore: strokeData.biomechanicalEvaluation?.overall || null,
      detectedFaults: strokeData.biomechanicalEvaluation?.detectedFaults?.map(f => f.name) || []
    };

    this.calibrationData.strokes.push(strokeRecord);

    console.log(`Calibration: Recorded ${strokeRecord.type} stroke #${this.calibrationData.strokes.length}`, {
      velocity: strokeRecord.velocity.toFixed(4),
      rotation: strokeRecord.rotation.toFixed(1),
      quality: strokeRecord.qualityOverall
    });
  }

  /**
   * Calculate statistics from calibration data
   */
  calculateCalibrationResults() {
    const strokes = this.calibrationData.strokes;

    if (strokes.length === 0) {
      return {
        error: 'No strokes detected in video',
        label: this.calibrationData.label,
        player: this.calibrationData.player
      };
    }

    // Metrics to analyze
    const metricsToAnalyze = [
      'velocity', 'acceleration', 'rotation', 'smoothness',
      'elbowAngle', 'hipShoulderSeparation', 'kneeBend',
      'contactHeight', 'contactDistance',
      'qualityOverall', 'sequenceQuality', 'kineticChainQuality', 'biomechanicalScore'
    ];

    const stats = {};

    for (const metric of metricsToAnalyze) {
      const values = strokes
        .map(s => s[metric])
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      if (values.length > 0) {
        stats[metric] = this.calculateMetricStats(values);
      }
    }

    // Stroke type distribution
    const strokeTypes = {};
    strokes.forEach(s => {
      strokeTypes[s.type] = (strokeTypes[s.type] || 0) + 1;
    });

    // Stance distribution
    const stances = {};
    strokes.forEach(s => {
      stances[s.stance] = (stances[s.stance] || 0) + 1;
    });

    // Weight transfer distribution
    const weightTransfers = {};
    strokes.forEach(s => {
      weightTransfers[s.weightTransfer] = (weightTransfers[s.weightTransfer] || 0) + 1;
    });

    // Detected faults frequency
    const faultFrequency = {};
    strokes.forEach(s => {
      (s.detectedFaults || []).forEach(fault => {
        faultFrequency[fault] = (faultFrequency[fault] || 0) + 1;
      });
    });

    const results = {
      label: this.calibrationData.label,
      player: this.calibrationData.player,
      strokeType: this.calibrationData.strokeType,
      totalStrokes: strokes.length,
      duration: (Date.now() - this.calibrationData.startTime) / 1000,

      metrics: stats,
      distributions: {
        strokeTypes,
        stances,
        weightTransfers,
        faultFrequency
      },

      // Generate recommended thresholds
      recommendedThresholds: this.generateThresholdRecommendations(stats, this.calibrationData.label),

      // Raw strokes for detailed analysis
      strokes: strokes
    };

    return results;
  }

  /**
   * Calculate statistics for a single metric
   */
  calculateMetricStats(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / n;

    const variance = values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return {
      count: n,
      min: sorted[0],
      max: sorted[n - 1],
      avg: avg,
      median: sorted[Math.floor(n / 2)],
      stdDev: stdDev,
      p10: sorted[Math.floor(n * 0.1)] || sorted[0],
      p25: sorted[Math.floor(n * 0.25)] || sorted[0],
      p75: sorted[Math.floor(n * 0.75)] || sorted[n - 1],
      p90: sorted[Math.floor(n * 0.9)] || sorted[n - 1]
    };
  }

  /**
   * Generate threshold recommendations based on calibration data
   */
  generateThresholdRecommendations(stats, label) {
    const recommendations = {};

    // Velocity thresholds
    if (stats.velocity) {
      recommendations.velocity = {
        current: this.getCurrentThreshold('velocity', label),
        recommended: {
          average: stats.velocity.avg,
          good: stats.velocity.p25,  // 25th percentile of pro = "good" for others
          excellent: stats.velocity.p75  // 75th percentile
        },
        note: `Based on ${stats.velocity.count} strokes, range ${stats.velocity.min.toFixed(4)} - ${stats.velocity.max.toFixed(4)}`
      };
    }

    // Acceleration thresholds
    if (stats.acceleration) {
      recommendations.acceleration = {
        current: this.getCurrentThreshold('acceleration', label),
        recommended: {
          average: stats.acceleration.avg,
          good: stats.acceleration.p25,
          excellent: stats.acceleration.p75
        },
        note: `Based on ${stats.acceleration.count} strokes`
      };
    }

    // Rotation thresholds
    if (stats.rotation) {
      recommendations.rotation = {
        current: this.getCurrentThreshold('rotation', label),
        recommended: {
          minimum: stats.rotation.p10,
          average: stats.rotation.avg,
          excellent: stats.rotation.p75
        },
        note: `Based on ${stats.rotation.count} strokes, range ${stats.rotation.min.toFixed(1)}° - ${stats.rotation.max.toFixed(1)}°`
      };
    }

    // Elbow angle at contact
    if (stats.elbowAngle) {
      recommendations.elbowAngle = {
        recommended: {
          min: stats.elbowAngle.p10,
          ideal: stats.elbowAngle.avg,
          max: stats.elbowAngle.p90
        },
        note: `Pro average: ${stats.elbowAngle.avg.toFixed(0)}°`
      };
    }

    // Hip-shoulder separation
    if (stats.hipShoulderSeparation) {
      recommendations.hipShoulderSeparation = {
        recommended: {
          min: stats.hipShoulderSeparation.p25,
          ideal: stats.hipShoulderSeparation.avg,
          excellent: stats.hipShoulderSeparation.p75
        },
        note: `Pro average: ${stats.hipShoulderSeparation.avg.toFixed(1)}°`
      };
    }

    return recommendations;
  }

  /**
   * Get current threshold from professional references
   */
  getCurrentThreshold(metric, level) {
    // Reference current values from professional-references.js
    const currentThresholds = {
      velocity: {
        professional: { average: 0.055, good: 0.045, excellent: 0.065 },
        advanced: { average: 0.045, good: 0.035, excellent: 0.055 },
        intermediate: { average: 0.035, good: 0.025, excellent: 0.045 }
      },
      acceleration: {
        professional: { average: 0.018, good: 0.015, excellent: 0.022 },
        advanced: { average: 0.015, good: 0.012, excellent: 0.018 },
        intermediate: { average: 0.012, good: 0.008, excellent: 0.015 }
      },
      rotation: {
        professional: { average: 25, good: 18, excellent: 35 },
        advanced: { average: 20, good: 15, excellent: 28 },
        intermediate: { average: 15, good: 10, excellent: 22 }
      }
    };

    return currentThresholds[metric]?.[level] || null;
  }

  /**
   * Save calibration run to localStorage
   */
  saveCalibrationRun(results) {
    const run = {
      id: `cal_${Date.now()}`,
      timestamp: Date.now(),
      ...results
    };

    this.allCalibrationRuns.push(run);

    // Keep last 20 runs
    if (this.allCalibrationRuns.length > 20) {
      this.allCalibrationRuns = this.allCalibrationRuns.slice(-20);
    }

    try {
      localStorage.setItem('techniqueai_calibration_runs', JSON.stringify(this.allCalibrationRuns));
    } catch (e) {
      console.warn('Failed to save calibration run:', e);
    }

    return run;
  }

  /**
   * Load previous calibration runs
   */
  loadCalibrationRuns() {
    try {
      const data = localStorage.getItem('techniqueai_calibration_runs');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Get aggregate statistics across all calibration runs
   */
  getAggregateStats(filterLabel = null) {
    let runs = this.allCalibrationRuns;

    if (filterLabel) {
      runs = runs.filter(r => r.label === filterLabel);
    }

    if (runs.length === 0) {
      return { error: 'No calibration data available' };
    }

    // Combine all strokes
    const allStrokes = runs.flatMap(r => r.strokes || []);

    // Recalculate stats
    const metricsToAnalyze = ['velocity', 'acceleration', 'rotation', 'smoothness', 'elbowAngle', 'hipShoulderSeparation'];
    const stats = {};

    for (const metric of metricsToAnalyze) {
      const values = allStrokes
        .map(s => s[metric])
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      if (values.length > 0) {
        stats[metric] = this.calculateMetricStats(values);
      }
    }

    return {
      totalRuns: runs.length,
      totalStrokes: allStrokes.length,
      labels: [...new Set(runs.map(r => r.label))],
      players: [...new Set(runs.map(r => r.player))],
      metrics: stats
    };
  }

  /**
   * Export calibration data as JSON
   */
  exportCalibrationData() {
    const data = {
      exportDate: new Date().toISOString(),
      runs: this.allCalibrationRuns,
      aggregateStats: this.getAggregateStats()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `techniqueai-calibration-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Print comparison of current vs recommended thresholds
   */
  printThresholdComparison() {
    const proStats = this.getAggregateStats('professional');

    if (proStats.error) {
      console.log('No professional calibration data. Run calibration on pro videos first.');
      return;
    }

    console.group('Threshold Comparison: Current vs Calibrated');

    console.log('\n=== VELOCITY ===');
    if (proStats.metrics.velocity) {
      const v = proStats.metrics.velocity;
      console.log(`Current "professional" threshold: 0.055`);
      console.log(`Calibrated from ${v.count} pro strokes:`);
      console.log(`  Min: ${v.min.toFixed(4)}, Max: ${v.max.toFixed(4)}`);
      console.log(`  Avg: ${v.avg.toFixed(4)}, Median: ${v.median.toFixed(4)}`);
      console.log(`  Recommended: avg=${v.avg.toFixed(4)}, good=${v.p25.toFixed(4)}, excellent=${v.p75.toFixed(4)}`);
    }

    console.log('\n=== ACCELERATION ===');
    if (proStats.metrics.acceleration) {
      const a = proStats.metrics.acceleration;
      console.log(`Current "professional" threshold: 0.018`);
      console.log(`Calibrated from ${a.count} pro strokes:`);
      console.log(`  Min: ${a.min.toFixed(4)}, Max: ${a.max.toFixed(4)}`);
      console.log(`  Avg: ${a.avg.toFixed(4)}, Median: ${a.median.toFixed(4)}`);
    }

    console.log('\n=== ROTATION ===');
    if (proStats.metrics.rotation) {
      const r = proStats.metrics.rotation;
      console.log(`Current "professional" threshold: 25°`);
      console.log(`Calibrated from ${r.count} pro strokes:`);
      console.log(`  Min: ${r.min.toFixed(1)}°, Max: ${r.max.toFixed(1)}°`);
      console.log(`  Avg: ${r.avg.toFixed(1)}°, Median: ${r.median.toFixed(1)}°`);
    }

    console.log('\n=== ELBOW ANGLE ===');
    if (proStats.metrics.elbowAngle) {
      const e = proStats.metrics.elbowAngle;
      console.log(`Calibrated from ${e.count} pro strokes:`);
      console.log(`  Range: ${e.min.toFixed(0)}° - ${e.max.toFixed(0)}°`);
      console.log(`  Avg: ${e.avg.toFixed(0)}°`);
    }

    console.groupEnd();
  }

  /**
   * Cancel ongoing calibration
   */
  cancel() {
    this.isCalibrating = false;
  }

  /**
   * Clear all calibration data
   */
  clearAllData() {
    this.allCalibrationRuns = [];
    localStorage.removeItem('techniqueai_calibration_runs');
    console.log('Calibration data cleared');
  }
}

// Global instance
const calibrationTool = new CalibrationTool();
