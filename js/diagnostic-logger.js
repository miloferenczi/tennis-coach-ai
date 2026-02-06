/**
 * Diagnostic Logger for TechniqueAI
 *
 * Captures raw metric values from every detected stroke to:
 * 1. Understand actual value distributions
 * 2. Validate/calibrate thresholds
 * 3. Debug false positives/negatives
 */

class DiagnosticLogger {
  constructor() {
    this.enabled = true;
    this.logToConsole = true;
    this.logToStorage = true;
    this.storageKey = 'techniqueai_diagnostic_logs';
    this.maxStoredLogs = 500;

    // Metric statistics for real-time analysis
    this.stats = {
      strokeCount: 0,
      metrics: {}
    };
  }

  /**
   * Log a detected stroke with all raw metrics
   */
  logStroke(strokeData, sequenceAnalysis, biomechanicalEval) {
    if (!this.enabled) return;

    const timestamp = Date.now();

    const log = {
      timestamp,
      dateTime: new Date(timestamp).toISOString(),
      strokeType: strokeData.type,

      // Raw physics metrics
      physics: {
        velocity: strokeData.velocity?.magnitude || 0,
        velocityX: strokeData.velocity?.components?.x || 0,
        velocityY: strokeData.velocity?.components?.y || 0,
        acceleration: strokeData.acceleration?.magnitude || 0,
        rotation: strokeData.rotation || 0,
        verticalMotion: strokeData.verticalMotion || 0,
        smoothness: strokeData.smoothness || 0
      },

      // Technique metrics
      technique: {
        elbowAngle: strokeData.technique?.elbowAngleAtContact || 0,
        shoulderRotation: strokeData.technique?.shoulderRotation || 0,
        hipShoulderSeparation: strokeData.technique?.hipShoulderSeparation || 0,
        kneeBend: strokeData.technique?.kneeBend || 0,
        stance: strokeData.technique?.stance || 'unknown',
        weightTransfer: strokeData.technique?.weightTransfer || 'unknown'
      },

      // Contact point
      contactPoint: {
        height: strokeData.contactPoint?.height || 0,
        distance: strokeData.contactPoint?.distance || 0,
        variance: strokeData.contactPointVariance || 0
      },

      // Quality scores
      quality: {
        overall: strokeData.quality?.overall || 0,
        velocity: strokeData.quality?.breakdown?.velocity || 0,
        acceleration: strokeData.quality?.breakdown?.acceleration || 0,
        rotation: strokeData.quality?.breakdown?.rotation || 0,
        smoothness: strokeData.quality?.breakdown?.smoothness || 0
      },

      // Sequence analysis (if available)
      sequence: sequenceAnalysis ? {
        sequenceQuality: sequenceAnalysis.sequenceQuality?.overall || 0,
        kineticChainQuality: sequenceAnalysis.kineticChain?.chainQuality || 0,
        phases: sequenceAnalysis.phases?.durations || {},
        phaseBreakdown: sequenceAnalysis.sequenceQuality?.breakdown || {}
      } : null,

      // Biomechanical evaluation (if available)
      biomechanical: biomechanicalEval ? {
        overall: biomechanicalEval.overall || 0,
        phaseScores: Object.fromEntries(
          Object.entries(biomechanicalEval.byPhase || {})
            .map(([phase, data]) => [phase, Math.round(data.score)])
        ),
        faultsDetected: (biomechanicalEval.detectedFaults || []).map(f => f.name),
        failedCheckpoints: (biomechanicalEval.failedCheckpoints || [])
          .map(c => `${c.phase}.${c.checkpoint}`)
      } : null,

      // Pro comparison
      proComparison: strokeData.proComparison ? {
        skillLevel: strokeData.proComparison.skillLevel,
        percentile: strokeData.proComparison.percentile,
        similarityScore: strokeData.proComparison.overallSimilarity
      } : null
    };

    // Update statistics
    this.updateStats(log);

    // Console logging
    if (this.logToConsole) {
      this.logToConsolePretty(log);
    }

    // Storage logging
    if (this.logToStorage) {
      this.saveToStorage(log);
    }

    return log;
  }

  /**
   * Pretty print to console
   */
  logToConsolePretty(log) {
    const qualityColor = log.quality.overall >= 80 ? '🟢' :
                         log.quality.overall >= 60 ? '🟡' : '🔴';

    console.group(`${qualityColor} ${log.strokeType} - Score: ${log.quality.overall}`);

    console.log('Physics:', {
      velocity: log.physics.velocity.toFixed(4),
      acceleration: log.physics.acceleration.toFixed(4),
      rotation: log.physics.rotation.toFixed(1) + '°',
      smoothness: log.physics.smoothness.toFixed(0)
    });

    console.log('Technique:', {
      elbow: log.technique.elbowAngle.toFixed(0) + '°',
      hipShoulder: log.technique.hipShoulderSeparation.toFixed(1) + '°',
      stance: log.technique.stance,
      weight: log.technique.weightTransfer
    });

    if (log.biomechanical) {
      console.log('Biomechanical:', {
        overall: log.biomechanical.overall,
        faults: log.biomechanical.faultsDetected.join(', ') || 'None'
      });
    }

    if (log.sequence) {
      console.log('Sequence:', {
        quality: log.sequence.sequenceQuality,
        kineticChain: log.sequence.kineticChainQuality,
        phases: log.sequence.phases
      });
    }

    console.groupEnd();
  }

  /**
   * Update running statistics
   */
  updateStats(log) {
    this.stats.strokeCount++;

    // Track metric distributions
    const metricsToTrack = [
      ['velocity', log.physics.velocity],
      ['acceleration', log.physics.acceleration],
      ['rotation', Math.abs(log.physics.rotation)],
      ['smoothness', log.physics.smoothness],
      ['elbowAngle', log.technique.elbowAngle],
      ['hipShoulderSep', log.technique.hipShoulderSeparation],
      ['quality', log.quality.overall]
    ];

    for (const [name, value] of metricsToTrack) {
      if (!this.stats.metrics[name]) {
        this.stats.metrics[name] = {
          count: 0,
          sum: 0,
          min: Infinity,
          max: -Infinity,
          values: []
        };
      }

      const metric = this.stats.metrics[name];
      metric.count++;
      metric.sum += value;
      metric.min = Math.min(metric.min, value);
      metric.max = Math.max(metric.max, value);
      metric.values.push(value);

      // Keep last 100 values for percentile calculation
      if (metric.values.length > 100) {
        metric.values.shift();
      }
    }
  }

  /**
   * Get metric statistics
   */
  getStats() {
    const result = {
      strokeCount: this.stats.strokeCount,
      metrics: {}
    };

    for (const [name, data] of Object.entries(this.stats.metrics)) {
      const avg = data.count > 0 ? data.sum / data.count : 0;
      const sorted = [...data.values].sort((a, b) => a - b);
      const p25 = sorted[Math.floor(sorted.length * 0.25)] || 0;
      const p50 = sorted[Math.floor(sorted.length * 0.50)] || 0;
      const p75 = sorted[Math.floor(sorted.length * 0.75)] || 0;

      result.metrics[name] = {
        count: data.count,
        min: data.min === Infinity ? 0 : data.min,
        max: data.max === -Infinity ? 0 : data.max,
        avg: avg,
        p25, p50, p75
      };
    }

    return result;
  }

  /**
   * Print statistics summary
   */
  printStats() {
    const stats = this.getStats();

    console.group('📊 Diagnostic Statistics');
    console.log(`Total strokes analyzed: ${stats.strokeCount}`);

    console.table(
      Object.entries(stats.metrics).map(([name, data]) => ({
        Metric: name,
        Min: data.min.toFixed(4),
        P25: data.p25.toFixed(4),
        Median: data.p50.toFixed(4),
        P75: data.p75.toFixed(4),
        Max: data.max.toFixed(4),
        Avg: data.avg.toFixed(4)
      }))
    );

    console.groupEnd();
  }

  /**
   * Save log to localStorage
   */
  saveToStorage(log) {
    try {
      let logs = this.getStoredLogs();
      logs.push(log);

      // Trim to max size
      if (logs.length > this.maxStoredLogs) {
        logs = logs.slice(-this.maxStoredLogs);
      }

      localStorage.setItem(this.storageKey, JSON.stringify(logs));
    } catch (e) {
      console.warn('Failed to save diagnostic log:', e);
    }
  }

  /**
   * Get stored logs
   */
  getStoredLogs() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Export logs as JSON
   */
  exportLogs() {
    const logs = this.getStoredLogs();
    const stats = this.getStats();

    const exportData = {
      exportDate: new Date().toISOString(),
      totalLogs: logs.length,
      statistics: stats,
      logs: logs
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `techniqueai-diagnostics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Clear stored logs
   */
  clearLogs() {
    localStorage.removeItem(this.storageKey);
    this.stats = { strokeCount: 0, metrics: {} };
    console.log('Diagnostic logs cleared');
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`Diagnostic logging ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Global instance
const diagnosticLogger = new DiagnosticLogger();

// Add keyboard shortcut for stats (Ctrl+Shift+D)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    diagnosticLogger.printStats();
  }
});
