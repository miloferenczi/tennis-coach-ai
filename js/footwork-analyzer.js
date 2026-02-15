/**
 * FootworkAnalyzer — Proper stance, base width, weight distribution,
 * weight transfer direction, step patterns, and recovery detection.
 *
 * Replaces the crude detectStance() / calculateWeightTransfer() in
 * EnhancedTennisAnalyzer with biomechanically grounded measurements.
 */
class FootworkAnalyzer {
  constructor() {
    this.torsoLength = null;
    this.dominantHand = null; // 'left' or 'right'
  }

  /** Called once torso calibration completes */
  setTorsoLength(tl) {
    this.torsoLength = tl;
  }

  setDominantHand(hand) {
    this.dominantHand = hand;
  }

  // ── Main entry point ──────────────────────────────────────────────

  /**
   * Run full footwork analysis for a detected stroke.
   * @param {Array} poseHistory  - recent frames (each has .joints, .timestamp)
   * @param {object} phases      - from MotionSequenceAnalyzer (.phases with start/end indices)
   * @param {string} strokeType  - 'Forehand', 'Backhand', 'Serve', etc.
   * @returns {object} full footwork analysis
   */
  analyzeFootwork(poseHistory, phases, strokeType) {
    if (!poseHistory || poseHistory.length < 10) return null;

    // Find contact frame (end of acceleration / start of follow-through)
    const contactIdx = this._contactIndex(poseHistory, phases);
    const contactFrame = poseHistory[contactIdx];
    if (!contactFrame?.joints) return null;

    const stanceResult = this.detectStanceType(contactFrame, strokeType);
    const baseWidth = this.calculateBaseWidth(contactFrame);
    const distribution = this.calculateWeightDistribution(poseHistory, phases);
    const transfer = this.calculateWeightTransferDirection(poseHistory, phases);
    const stepPattern = this.detectStepPattern(poseHistory, phases);
    const recovery = this.detectRecovery(poseHistory, phases);

    const analysis = {
      stance: stanceResult,
      baseWidth,
      weightDistribution: distribution,
      weightTransfer: transfer,
      stepPattern,
      recovery,
      score: 0
    };

    analysis.score = this.calculateFootworkScore(analysis, strokeType);
    return analysis;
  }

  // ── Stance type detection ─────────────────────────────────────────

  /**
   * Detect stance type at contact from body-orientation vs foot-line angle.
   * Can detect closed stance (negative relative angle).
   */
  detectStanceType(contactFrame, strokeType) {
    const j = contactFrame.joints;
    if (!j.leftAnkle || !j.rightAnkle || !j.leftHip || !j.rightHip) {
      return { type: 'neutral', angle: 0 };
    }
    // Skip when ankles or hips not visible
    if (typeof isLandmarkVisible === 'function' &&
        (!isLandmarkVisible(j.leftAnkle) || !isLandmarkVisible(j.rightAnkle) ||
         !isLandmarkVisible(j.leftHip) || !isLandmarkVisible(j.rightHip))) {
      return { type: 'neutral', angle: 0 };
    }

    // Body-facing direction: hip midpoint → shoulder midpoint
    const hipMidX = (j.leftHip.x + j.rightHip.x) / 2;
    const hipMidY = (j.leftHip.y + j.rightHip.y) / 2;
    const shoulderMidX = ((j.leftShoulder?.x || j.leftHip.x) + (j.rightShoulder?.x || j.rightHip.x)) / 2;
    const shoulderMidY = ((j.leftShoulder?.y || j.leftHip.y) + (j.rightShoulder?.y || j.rightHip.y)) / 2;

    // Perpendicular to body-facing ≈ direction player faces the net
    const bodyAngle = Math.atan2(shoulderMidY - hipMidY, shoulderMidX - hipMidX);
    const facingAngle = bodyAngle + Math.PI / 2; // perpendicular

    // Foot-line angle
    const footAngle = Math.atan2(
      j.rightAnkle.y - j.leftAnkle.y,
      j.rightAnkle.x - j.leftAnkle.x
    );

    // Relative angle: positive = open, negative = closed
    let relativeAngle = (footAngle - facingAngle) * 180 / Math.PI;
    // Normalize to -180..180
    while (relativeAngle > 180) relativeAngle -= 360;
    while (relativeAngle < -180) relativeAngle += 360;

    // Flip sign for backhand or left-handed player (mirrored body orientation)
    const isBackhand = strokeType === 'Backhand';
    const isLeft = this.dominantHand === 'left';
    if (isBackhand !== isLeft) {
      relativeAngle = -relativeAngle;
    }

    let type;
    if (relativeAngle < -15) type = 'closed';
    else if (relativeAngle <= 15) type = 'neutral';
    else if (relativeAngle <= 45) type = 'semi-open';
    else type = 'open';

    return { type, angle: Math.round(relativeAngle) };
  }

  // ── Base width ────────────────────────────────────────────────────

  calculateBaseWidth(contactFrame) {
    const j = contactFrame.joints;
    if (!j.leftAnkle || !j.rightAnkle || !j.leftShoulder || !j.rightShoulder) {
      return { distance: 0, shoulderWidth: 0, ratio: 1.0, assessment: 'normal' };
    }
    // Skip when key landmarks not visible
    if (typeof isLandmarkVisible === 'function' &&
        (!isLandmarkVisible(j.leftAnkle) || !isLandmarkVisible(j.rightAnkle) ||
         !isLandmarkVisible(j.leftShoulder) || !isLandmarkVisible(j.rightShoulder))) {
      return { distance: 0, shoulderWidth: 0, ratio: 1.0, assessment: 'normal' };
    }

    const dx = j.rightAnkle.x - j.leftAnkle.x;
    const dy = j.rightAnkle.y - j.leftAnkle.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const sx = j.rightShoulder.x - j.leftShoulder.x;
    const sy = j.rightShoulder.y - j.leftShoulder.y;
    const shoulderWidth = Math.sqrt(sx * sx + sy * sy);

    const ratio = shoulderWidth > 0.001 ? distance / shoulderWidth : 1.0;

    let assessment;
    if (ratio < 0.6) assessment = 'very_narrow';
    else if (ratio < 0.8) assessment = 'narrow';
    else if (ratio <= 1.2) assessment = 'normal';
    else if (ratio <= 1.5) assessment = 'wide';
    else assessment = 'very_wide';

    return { distance, shoulderWidth, ratio: Math.round(ratio * 100) / 100, assessment };
  }

  // ── Weight distribution (per-phase) ───────────────────────────────

  calculateWeightDistribution(poseHistory, phases) {
    const result = {};
    const phaseMap = this._phaseRanges(phases);

    for (const phaseName of ['loading', 'acceleration', 'contact']) {
      const range = phaseMap[phaseName];
      if (!range) { result[phaseName] = { ratio: 0, label: 'unknown' }; continue; }

      const frames = poseHistory.slice(range.start, range.end + 1);
      if (frames.length === 0) { result[phaseName] = { ratio: 0, label: 'unknown' }; continue; }

      // Average hip-midpoint X relative to base-of-support midpoint X
      let totalRatio = 0;
      let count = 0;
      for (const f of frames) {
        const r = this._weightRatio(f);
        if (r !== null) { totalRatio += r; count++; }
      }
      const avgRatio = count > 0 ? totalRatio / count : 0;
      result[phaseName] = { ratio: Math.round(avgRatio * 100) / 100, label: this._weightLabel(avgRatio) };
    }

    return result;
  }

  // ── Weight transfer direction ─────────────────────────────────────

  calculateWeightTransferDirection(poseHistory, phases) {
    const phaseMap = this._phaseRanges(phases);
    const loadStart = phaseMap.loading?.start ?? 0;
    const contactEnd = phaseMap.contact?.end ?? poseHistory.length - 1;
    const ftEnd = phaseMap.followThrough?.end ?? poseHistory.length - 1;

    const startFrame = poseHistory[loadStart];
    const contactFrame = poseHistory[Math.min(contactEnd, poseHistory.length - 1)];
    const endFrame = poseHistory[Math.min(ftEnd, poseHistory.length - 1)];

    if (!startFrame?.joints || !contactFrame?.joints) {
      return { overall: 'static', momentumScore: 0.5, legacyLabel: 'static' };
    }

    const startHipX = this._hipMidX(startFrame);
    const contactHipX = this._hipMidX(contactFrame);
    const endHipX = endFrame?.joints ? this._hipMidX(endFrame) : contactHipX;

    // Total shift from loading start → follow-through end
    let shift = endHipX - startHipX;
    // Normalize by torso length if available
    if (this.torsoLength && this.torsoLength > 0.01) {
      shift /= this.torsoLength;
    }

    let overall;
    if (shift > 0.15) overall = 'forward';
    else if (shift > 0.05) overall = 'slight_forward';
    else if (shift > -0.05) overall = 'static';
    else if (shift > -0.15) overall = 'slight_backward';
    else overall = 'backward';

    // Momentum score 0-1 (higher = more forward)
    const momentumScore = Math.max(0, Math.min(1, 0.5 + shift * 2));

    // Legacy label for backward compat
    const legacyLabel = (overall === 'forward' || overall === 'slight_forward')
      ? 'back-to-front' : 'static';

    return { overall, momentumScore: Math.round(momentumScore * 100) / 100, legacyLabel };
  }

  // ── Step pattern detection ────────────────────────────────────────

  detectStepPattern(poseHistory, phases) {
    const phaseMap = this._phaseRanges(phases);
    const prepStart = phaseMap.preparation?.start ?? 0;
    const contactEnd = phaseMap.contact?.end ?? poseHistory.length - 1;

    const frames = poseHistory.slice(prepStart, contactEnd + 1);
    if (frames.length < 3) return { pattern: 'unknown', totalFootMovement: 0, hasStepIn: false };

    // Cumulative ankle path length
    let totalLeft = 0, totalRight = 0;
    let leadFootDisplacement = 0;
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1].joints;
      const curr = frames[i].joints;
      if (!prev?.leftAnkle || !curr?.leftAnkle) continue;

      totalLeft += this._dist(prev.leftAnkle, curr.leftAnkle);
      totalRight += this._dist(prev.rightAnkle, curr.rightAnkle);
    }

    // Lead-foot displacement (front foot net displacement from start to contact)
    const startJ = frames[0].joints;
    const endJ = frames[frames.length - 1].joints;
    if (startJ?.leftAnkle && endJ?.leftAnkle && startJ?.rightAnkle && endJ?.rightAnkle) {
      const leftDisp = this._dist(startJ.leftAnkle, endJ.leftAnkle);
      const rightDisp = this._dist(startJ.rightAnkle, endJ.rightAnkle);
      leadFootDisplacement = Math.max(leftDisp, rightDisp);
    }

    const totalFootMovement = totalLeft + totalRight;
    const hasStepIn = leadFootDisplacement > 0.04;

    // Normalize movement by torso length if available
    const norm = this.torsoLength && this.torsoLength > 0.01
      ? totalFootMovement / this.torsoLength : totalFootMovement;

    let pattern;
    if (hasStepIn && norm > 0.3) pattern = 'step_into_ball';
    else if (norm > 0.5) pattern = 'adjustment_steps';
    else if (norm > 0.1) pattern = 'minimal_movement';
    else pattern = 'planted';

    return { pattern, totalFootMovement: Math.round(norm * 100) / 100, hasStepIn };
  }

  // ── Recovery detection ────────────────────────────────────────────

  detectRecovery(poseHistory, phases) {
    const phaseMap = this._phaseRanges(phases);
    const ftStart = phaseMap.followThrough?.start;
    const ftEnd = phaseMap.followThrough?.end ?? poseHistory.length - 1;

    if (ftStart == null || ftEnd - ftStart < 3) {
      return { recovered: false, widthOk: false, balanceOk: false };
    }

    // Check last few frames of follow-through
    const lastFrames = poseHistory.slice(Math.max(ftStart, ftEnd - 4), ftEnd + 1);
    if (lastFrames.length === 0) return { recovered: false, widthOk: false, balanceOk: false };

    const lastFrame = lastFrames[lastFrames.length - 1];
    const base = this.calculateBaseWidth(lastFrame);
    const widthOk = base.ratio >= 0.7 && base.ratio <= 1.4;

    // Balance: hip midpoint roughly centered over base
    const wr = this._weightRatio(lastFrame);
    const balanceOk = wr !== null && Math.abs(wr) < 0.25;

    return { recovered: widthOk && balanceOk, widthOk, balanceOk };
  }

  // ── Composite footwork score ──────────────────────────────────────

  calculateFootworkScore(analysis, strokeType) {
    let score = 0;

    // Stance appropriateness (25 pts)
    const st = analysis.stance?.type;
    if (strokeType === 'Serve') {
      // Serve: neutral or semi-open acceptable
      score += (st === 'neutral' || st === 'semi-open') ? 25 : 15;
    } else {
      // Groundstrokes: semi-open or open preferred, neutral ok, closed less ideal
      if (st === 'semi-open' || st === 'open') score += 25;
      else if (st === 'neutral') score += 20;
      else if (st === 'closed') score += 10;
    }

    // Base width (20 pts)
    const bw = analysis.baseWidth?.assessment;
    if (bw === 'normal' || bw === 'wide') score += 20;
    else if (bw === 'narrow') score += 12;
    else if (bw === 'very_wide') score += 10;
    else score += 5;

    // Weight transfer (25 pts)
    const wt = analysis.weightTransfer?.overall;
    if (wt === 'forward') score += 25;
    else if (wt === 'slight_forward') score += 20;
    else if (wt === 'static') score += 10;
    else score += 5;

    // Step pattern (15 pts)
    const sp = analysis.stepPattern?.pattern;
    if (sp === 'step_into_ball') score += 15;
    else if (sp === 'adjustment_steps') score += 12;
    else if (sp === 'minimal_movement') score += 8;
    else score += 3;

    // Recovery (15 pts)
    if (analysis.recovery?.recovered) score += 15;
    else if (analysis.recovery?.widthOk || analysis.recovery?.balanceOk) score += 8;

    return Math.min(100, score);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _contactIndex(poseHistory, phases) {
    if (phases?.contact?.start != null) return phases.contact.start;
    if (phases?.acceleration?.end != null) return phases.acceleration.end;
    // Fallback: peak velocity frame
    let maxV = 0, idx = poseHistory.length - 1;
    for (let i = 0; i < poseHistory.length; i++) {
      const v = poseHistory[i].velocity?.magnitude || 0;
      if (v > maxV) { maxV = v; idx = i; }
    }
    return idx;
  }

  _phaseRanges(phases) {
    if (!phases) return {};
    const out = {};
    for (const name of ['preparation', 'loading', 'acceleration', 'contact', 'followThrough']) {
      if (phases[name]) out[name] = { start: phases[name].start, end: phases[name].end };
    }
    return out;
  }

  _hipMidX(frame) {
    const j = frame.joints;
    if (!j?.leftHip || !j?.rightHip) return 0;
    return (j.leftHip.x + j.rightHip.x) / 2;
  }

  /** Weight ratio: positive = forward, negative = back */
  _weightRatio(frame) {
    const j = frame.joints;
    if (!j?.leftHip || !j?.rightHip || !j?.leftAnkle || !j?.rightAnkle) return null;

    const hipMidX = (j.leftHip.x + j.rightHip.x) / 2;
    const baseMidX = (j.leftAnkle.x + j.rightAnkle.x) / 2;
    const baseWidth = Math.abs(j.rightAnkle.x - j.leftAnkle.x);

    if (baseWidth < 0.001) return 0;
    return (hipMidX - baseMidX) / baseWidth;
  }

  _weightLabel(ratio) {
    if (ratio < -0.3) return 'back_foot_heavy';
    if (ratio < -0.1) return 'slightly_back';
    if (ratio <= 0.1) return 'balanced';
    if (ratio <= 0.3) return 'slightly_forward';
    return 'front_foot_heavy';
  }

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FootworkAnalyzer;
} else {
  window.FootworkAnalyzer = FootworkAnalyzer;
}
