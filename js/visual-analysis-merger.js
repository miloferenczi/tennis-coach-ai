/**
 * VisualAnalysisMerger - Merges MediaPipe skeleton analysis with Gemini visual analysis
 *
 * Gemini sees things skeletons can't: racket face angle, grip, contact point
 * relative to body, ball trajectory off the strings. This module:
 * 1. Deduplicates faults between MediaPipe biomechanics and Gemini visual
 * 2. Builds a follow-up prompt for GPT (sent 1-2s after the instant coaching)
 * 3. Caches the last visual result for injection into the NEXT stroke's context
 */
class VisualAnalysisMerger {
  constructor() {
    this.lastVisualResult = null;   // cached for next stroke's context
    this.lastStrokeType = null;

    // Map Gemini visual fault IDs to coaching tree IDs
    this.faultMapping = {
      'racket_face_open':      'racketFaceOpen',
      'racket_face_closed':    'racketFaceOpen',       // same coaching tree entry
      'contact_behind_body':   'contactBehindBody',
      'contact_too_far_front': 'contactTooFarFront',
      'late_racket_prep':      'latePreparation',      // maps to existing issue
      'wrong_grip':            'wrongGrip',
      'wrist_laid_back':       null,                    // informational only
      'elbow_flying':          'collapsingElbowChickenWing'
    };

    // Faults that are already covered by MediaPipe biomechanics (skip dedup)
    this.mediapipeCoveredFaults = new Set([
      'latePreparation',
      'collapsingElbowChickenWing',
      'insufficientRotation',
      'poorWeightTransfer',
      'poorFollowThrough',
      'poorFootwork'
    ]);
  }

  /**
   * Merge MediaPipe strokeData with Gemini visual result.
   * Returns enriched visual insights (only the NEW ones not already in biomechanics).
   */
  merge(strokeData, visualResult) {
    if (!visualResult) return null;

    const existingFaultIds = new Set(
      (strokeData.biomechanicalEvaluation?.detectedFaults || []).map(f => f.id || f.name)
    );

    const newInsights = [];
    const visualFaults = visualResult.faults || [];

    for (const vf of visualFaults) {
      const treeId = this.faultMapping[vf.id];

      // Skip if already detected by MediaPipe
      if (treeId && existingFaultIds.has(treeId)) continue;
      // Skip if it's a MediaPipe-covered fault that wasn't triggered (means it's fine)
      if (treeId && this.mediapipeCoveredFaults.has(treeId) && !existingFaultIds.has(treeId)) continue;

      newInsights.push({
        source: 'gemini_visual',
        id: vf.id,
        treeId: treeId,
        description: vf.description || vf.id.replace(/_/g, ' '),
        confidence: vf.confidence || 0.5,
        severity: vf.severity || 'medium'
      });
    }

    // Cache for next stroke
    this.lastVisualResult = {
      ...visualResult,
      newInsights,
      timestamp: Date.now()
    };
    this.lastStrokeType = strokeData.type;

    return {
      newInsights,
      racketFace: visualResult.racketFace || null,
      contactPoint: visualResult.contactPoint || null,
      gripType: visualResult.gripType || null,
      bodyPosition: visualResult.bodyPosition || null,
      positives: visualResult.positives || null,
      visualConfidence: visualResult.confidence || 0,
      rawFaults: visualFaults,
      // Serve-specific fields (null for groundstrokes)
      tossPlacement: visualResult.tossPlacement || null,
      trophyVisual: visualResult.trophyVisual || null,
      legExtension: visualResult.legExtension || null
    };
  }

  /**
   * Build a GPT follow-up prompt from visual analysis results.
   * Sent ~1-2s after the instant biomechanical coaching.
   */
  buildVisualFollowUpPrompt(visualResult, strokeType) {
    if (!visualResult) return null;

    let prompt = `VISUAL ANALYSIS UPDATE for that ${strokeType}:\n`;
    prompt += `(This is supplementary — only speak if it adds a NEW insight beyond what you already said.)\n\n`;

    if (visualResult.racketFace) {
      const rf = visualResult.racketFace;
      prompt += `- Racket face: ${rf.angle || rf.state || 'unknown'}`;
      if (rf.atContact) prompt += ` at contact`;
      prompt += `\n`;
    }

    if (visualResult.contactPoint) {
      const cp = visualResult.contactPoint;
      prompt += `- Contact point: ${cp.position || 'unknown'}`;
      if (cp.relative_to_body) prompt += ` (${cp.relative_to_body})`;
      prompt += `\n`;
    }

    if (visualResult.gripType) {
      prompt += `- Grip: ${visualResult.gripType}\n`;
    }

    if (visualResult.bodyPosition) {
      prompt += `- Body position: ${visualResult.bodyPosition}\n`;
    }

    // Serve-specific visual data
    if (visualResult.tossPlacement) {
      const tp = visualResult.tossPlacement;
      prompt += `- Toss placement: ${tp.position || 'unknown'}`;
      if (tp.consistency) prompt += ` (${tp.consistency})`;
      prompt += `\n`;
    }
    if (visualResult.trophyVisual) {
      const tv = visualResult.trophyVisual;
      prompt += `- Trophy depth: ${tv.depth || 'unknown'}`;
      if (tv.elbowPosition) prompt += ` — elbow: ${tv.elbowPosition}`;
      prompt += `\n`;
    }
    if (visualResult.legExtension) {
      const le = visualResult.legExtension;
      prompt += `- Leg extension: knee drive ${le.kneeDrive || 'unknown'}`;
      if (le.jumpVisible != null) prompt += `, jump ${le.jumpVisible ? 'visible' : 'not visible'}`;
      prompt += `\n`;
    }

    const newInsights = visualResult.newInsights || [];
    if (newInsights.length > 0) {
      prompt += `\nVISUAL FAULTS (not detected by skeleton):\n`;
      for (const insight of newInsights.slice(0, 2)) {
        prompt += `- ${insight.description} (confidence: ${(insight.confidence * 100).toFixed(0)}%)\n`;
      }
    }

    if (visualResult.positives && visualResult.positives.length > 0) {
      prompt += `\nVISUAL POSITIVES:\n`;
      for (const pos of visualResult.positives.slice(0, 2)) {
        prompt += `- ${pos}\n`;
      }
    }

    prompt += `\nIf this reveals something new (e.g., racket face issue, grip problem, contact point), give a brief 1-sentence follow-up. Otherwise, say nothing.`;

    return prompt;
  }

  /**
   * Format cached visual result for injection into the NEXT stroke's context.
   */
  formatForNextStrokeContext() {
    if (!this.lastVisualResult) return '';
    // Only use if less than 60 seconds old
    if (Date.now() - this.lastVisualResult.timestamp > 60000) return '';

    let block = `PREVIOUS STROKE VISUAL CONTEXT (from camera):\n`;

    if (this.lastVisualResult.racketFace) {
      block += `- Last racket face: ${this.lastVisualResult.racketFace.angle || this.lastVisualResult.racketFace.state || '?'}\n`;
    }
    if (this.lastVisualResult.gripType) {
      block += `- Last grip: ${this.lastVisualResult.gripType}\n`;
    }

    const insights = this.lastVisualResult.newInsights || [];
    if (insights.length > 0) {
      block += `- Visual issues: ${insights.map(i => i.description).join(', ')}\n`;
    }

    // Serve context for next serve
    if (this.lastVisualResult.tossPlacement) {
      block += `- Last toss: ${this.lastVisualResult.tossPlacement.position || '?'}\n`;
    }
    if (this.lastVisualResult.trophyVisual) {
      block += `- Last trophy depth: ${this.lastVisualResult.trophyVisual.depth || '?'}\n`;
    }

    return block;
  }

  /**
   * Map Gemini visual metrics into coaching orchestrator metric names.
   * Returns an object that can be spread into playerMetrics.
   */
  getOrchestratorMetrics(visualResult) {
    if (!visualResult) return {};

    const metrics = {};

    if (visualResult.racketFace) {
      // Map to a 0-100 score for coaching tree detection
      const rf = visualResult.racketFace;
      if (rf.state === 'open' || rf.angle === 'open') {
        metrics.geminiRacketFace = 'open';
        metrics.geminiRacketFaceScore = 30;
      } else if (rf.state === 'closed' || rf.angle === 'closed') {
        metrics.geminiRacketFace = 'closed';
        metrics.geminiRacketFaceScore = 30;
      } else {
        metrics.geminiRacketFace = 'neutral';
        metrics.geminiRacketFaceScore = 80;
      }
    }

    if (visualResult.contactPoint) {
      const cp = visualResult.contactPoint;
      if (cp.relative_to_body === 'behind' || cp.position === 'behind_body') {
        metrics.geminiContactPoint = 'behind';
        metrics.geminiContactPointScore = 25;
      } else if (cp.relative_to_body === 'too_far_front') {
        metrics.geminiContactPoint = 'too_far_front';
        metrics.geminiContactPointScore = 40;
      } else {
        metrics.geminiContactPoint = 'optimal';
        metrics.geminiContactPointScore = 85;
      }
    }

    if (visualResult.gripType) {
      metrics.geminiGrip = visualResult.gripType;
    }

    metrics.geminiConfidence = visualResult.confidence || 0;

    // Serve-specific metrics
    if (visualResult.tossPlacement) {
      metrics.geminiTossPlacement = visualResult.tossPlacement.position || 'unknown';
    }
    if (visualResult.trophyVisual) {
      metrics.geminiTrophyDepth = visualResult.trophyVisual.depth || 'unknown';
    }

    return metrics;
  }

  /**
   * Clear cached data.
   */
  reset() {
    this.lastVisualResult = null;
    this.lastStrokeType = null;
  }
}
