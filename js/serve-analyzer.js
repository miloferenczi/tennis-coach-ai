/**
 * ServeAnalyzer — Serve-specific biomechanical analysis.
 *
 * Detects trophy position, measures leg drive, shoulder tilt, toss arm
 * extension, contact height, trunk rotation, and follow-through.
 * Follows the FootworkAnalyzer self-contained pattern.
 *
 * MediaPipe Y-axis: 0 = top, 1 = bottom. "Higher" = LOWER Y value.
 */
class ServeAnalyzer {
  constructor() {
    this.torsoLength = null;
    this.dominantHand = null; // 'right' or 'left'
  }

  setTorsoLength(tl) { this.torsoLength = tl; }
  setDominantHand(hand) { this.dominantHand = hand; }

  // ── Main entry point ──────────────────────────────────────────────

  /**
   * Full serve analysis. Only runs for serves.
   * @param {Array} poseHistory — recent frames (each has .joints, .landmarks, .timestamp)
   * @param {object} phases — generic phases from PhaseDetector (used as fallback)
   * @param {string} strokeType
   * @returns {object|null}
   */
  analyzeServe(poseHistory, phases, strokeType) {
    if (strokeType !== 'Serve' || !poseHistory || poseHistory.length < 15) return null;

    // Determine landmark indices based on handedness
    const isLeft = this.dominantHand === 'left';
    const idx = {
      domWrist:      isLeft ? 15 : 16,
      nonDomWrist:   isLeft ? 16 : 15,
      domElbow:      isLeft ? 13 : 14,
      nonDomElbow:   isLeft ? 14 : 13,
      domShoulder:   isLeft ? 11 : 12,
      nonDomShoulder: isLeft ? 12 : 11,
      domHip:        isLeft ? 23 : 24,
      nonDomHip:     isLeft ? 24 : 23,
      domKnee:       isLeft ? 25 : 26,
      nonDomKnee:    isLeft ? 26 : 25,
      domAnkle:      isLeft ? 27 : 28,
      nonDomAnkle:   isLeft ? 28 : 27,
      nose: 0
    };

    // Detect serve-specific phases (trophy + contact)
    const servePhases = this.detectServePhases(poseHistory, idx);
    if (!servePhases) return null;

    const trophy      = this.analyzeTrophyPosition(poseHistory, servePhases, idx);
    const legDrive    = this.measureLegDrive(poseHistory, servePhases, idx);
    const shoulderTilt = this.measureShoulderTilt(poseHistory, servePhases, idx);
    const tossArm     = this.measureTossArm(poseHistory, servePhases, idx);
    const contactHeight = this.measureContactHeight(poseHistory, servePhases, idx);
    const trunkRotation = this.measureTrunkRotation(poseHistory, servePhases, idx);
    const followThrough = this.measureServeFollowThrough(poseHistory, servePhases, idx);

    const serveScore = this.calculateServeScore(
      trophy, legDrive, shoulderTilt, tossArm, contactHeight, trunkRotation, followThrough
    );

    return {
      servePhases,
      trophyPosition: trophy,
      legDrive,
      shoulderTilt,
      tossArmExtension: tossArm,
      contactHeight,
      trunkRotation,
      followThrough,
      serveScore
    };
  }

  // ── Serve phase detection ─────────────────────────────────────────

  /**
   * Detect serve-specific phases using landmark positions (not just velocity).
   * Trophy = peak trophy score. Contact = peak dom-wrist height after trophy.
   */
  detectServePhases(poseHistory, idx) {
    const len = poseHistory.length;
    const searchEnd = Math.floor(len * 0.7); // Trophy must be in first 70%

    // Score each frame for "trophy-ness"
    let bestTrophyScore = -Infinity;
    let trophyIdx = -1;

    for (let i = 3; i < searchEnd; i++) {
      const lm = poseHistory[i].landmarks;
      if (!lm || !lm[idx.nonDomWrist] || !lm[idx.domElbow]) continue;
      // Skip frames where key serve landmarks are not visible
      if (typeof isLandmarkVisible === 'function') {
        const needed = [idx.nonDomWrist, idx.domElbow, idx.domShoulder, idx.domWrist, idx.domHip, idx.domKnee, idx.domAnkle];
        let skip = false;
        for (const n of needed) {
          if (!isLandmarkVisible(lm[n], 0.4)) { skip = true; break; }
        }
        if (skip) continue;
      }

      // 1) Toss hand height — lower Y = higher = better (scale 0-50)
      const tossY = lm[idx.nonDomWrist].y;
      const shoulderY = lm[idx.nonDomShoulder].y;
      const tossHeightScore = Math.max(0, (shoulderY - tossY) * 100); // positive if toss above shoulder

      // 2) Elbow cock — closer to 90° = better (scale 0-30)
      const elbowAngle = this._angle(
        lm[idx.domShoulder], lm[idx.domElbow], lm[idx.domWrist]
      );
      const elbowCockScore = Math.max(0, 30 - Math.abs(elbowAngle - 90) * 0.6);

      // 3) Knee bend — lower angle = more bend = better (scale 0-20)
      const kneeAngle = this._angle(
        lm[idx.domHip], lm[idx.domKnee], lm[idx.domAnkle]
      );
      const kneeBendScore = Math.max(0, 20 - Math.max(0, kneeAngle - 130) * 0.5);

      const score = tossHeightScore + elbowCockScore + kneeBendScore;
      if (score > bestTrophyScore) {
        bestTrophyScore = score;
        trophyIdx = i;
      }
    }

    if (trophyIdx < 0) return null;

    // Find contact: peak dom-wrist height (lowest Y) AFTER trophy
    let bestContactY = Infinity;
    let contactIdx = trophyIdx + 2;

    for (let i = trophyIdx + 2; i < len; i++) {
      const lm = poseHistory[i].landmarks;
      if (!lm || !lm[idx.domWrist]) continue;
      const y = lm[idx.domWrist].y;
      if (y < bestContactY) {
        bestContactY = y;
        contactIdx = i;
      }
    }

    // Ensure contact is after trophy
    if (contactIdx <= trophyIdx) contactIdx = Math.min(trophyIdx + 3, len - 1);

    const trophyStart = Math.max(0, trophyIdx - 2);
    const trophyEnd = Math.min(len - 1, trophyIdx + 2);

    return {
      preparation:  { start: 0, end: trophyStart },
      trophy:       { start: trophyStart, end: trophyEnd },
      acceleration: { start: trophyEnd, end: contactIdx },
      contact:      { start: contactIdx, end: Math.min(contactIdx + 1, len - 1) },
      followThrough: { start: Math.min(contactIdx + 1, len - 1), end: len - 1 },
      trophyFrame: trophyIdx,
      contactFrame: contactIdx,
      durations: {
        preparation: trophyStart,
        trophy: trophyEnd - trophyStart,
        acceleration: contactIdx - trophyEnd,
        followThrough: (len - 1) - contactIdx
      }
    };
  }

  // ── Trophy position analysis ──────────────────────────────────────

  analyzeTrophyPosition(poseHistory, servePhases, idx) {
    const tFrame = servePhases.trophyFrame;
    const lm = poseHistory[tFrame]?.landmarks;
    if (!lm) return { detected: false, score: 0 };

    // Elbow angle at trophy
    const elbowAngle = this._angle(
      lm[idx.domShoulder], lm[idx.domElbow], lm[idx.domWrist]
    );

    // Shoulder tilt at trophy (non-dom shoulder should be higher = lower Y)
    const tiltRad = Math.atan2(
      lm[idx.nonDomShoulder].y - lm[idx.domShoulder].y,
      lm[idx.nonDomShoulder].x - lm[idx.domShoulder].x
    );
    const shoulderTilt = Math.abs(tiltRad * 180 / Math.PI);

    // Knee bend at trophy
    const kneeBend = this._angle(
      lm[idx.domHip], lm[idx.domKnee], lm[idx.domAnkle]
    );

    // Back arch: vertical distance between shoulder midpoint and hip midpoint
    const shoulderMidY = (lm[idx.domShoulder].y + lm[idx.nonDomShoulder].y) / 2;
    const hipMidY = (lm[idx.domHip].y + lm[idx.nonDomHip].y) / 2;
    let backArch = hipMidY - shoulderMidY; // positive if shoulders above hips
    if (this.torsoLength && this.torsoLength > 0.01) {
      backArch /= this.torsoLength;
    }

    const detected = elbowAngle >= 60 && elbowAngle <= 130;

    // Score components
    let score = 0;
    // Elbow: ideal 85-100, good within ±15
    score += Math.max(0, 40 - Math.abs(elbowAngle - 92) * 1.5);
    // Shoulder tilt: ideal 20-45°
    if (shoulderTilt >= 20 && shoulderTilt <= 45) score += 25;
    else if (shoulderTilt >= 10) score += 15;
    else score += 5;
    // Knee bend: ideal 120-150° (less = more bend)
    if (kneeBend >= 110 && kneeBend <= 150) score += 25;
    else if (kneeBend < 110) score += 20; // very bent, still good
    else score += Math.max(0, 25 - (kneeBend - 150) * 1.5);
    // Back arch bonus
    if (backArch > 0.3) score += 10;
    else if (backArch > 0.15) score += 5;

    return {
      detected,
      elbowAngle: Math.round(elbowAngle),
      shoulderTilt: Math.round(shoulderTilt),
      kneeBend: Math.round(kneeBend),
      backArch: Math.round(backArch * 100) / 100,
      score: Math.min(100, Math.round(score))
    };
  }

  // ── Leg drive ─────────────────────────────────────────────────────

  measureLegDrive(poseHistory, servePhases, idx) {
    const tFrame = servePhases.trophyFrame;
    const cFrame = servePhases.contactFrame;
    const tLm = poseHistory[tFrame]?.landmarks;
    const cLm = poseHistory[cFrame]?.landmarks;
    if (!tLm || !cLm) return { score: 0 };

    const kneeBendAtTrophy = this._angle(
      tLm[idx.domHip], tLm[idx.domKnee], tLm[idx.domAnkle]
    );
    const kneeBendAtContact = this._angle(
      cLm[idx.domHip], cLm[idx.domKnee], cLm[idx.domAnkle]
    );

    // Hip vertical displacement: trophy → contact
    // In MediaPipe, lower Y = higher position. Hips going UP = Y decreasing = negative delta
    const tHipY = (tLm[idx.domHip].y + tLm[idx.nonDomHip].y) / 2;
    const cHipY = (cLm[idx.domHip].y + cLm[idx.nonDomHip].y) / 2;
    let hipDisplacement = tHipY - cHipY; // positive = hips went UP (good)
    if (this.torsoLength && this.torsoLength > 0.01) {
      hipDisplacement /= this.torsoLength;
    }

    // Knee extension = leg drive (angle increase from trophy to contact)
    const kneeExtension = kneeBendAtContact - kneeBendAtTrophy;

    // Score
    let score = 0;
    // Hip upward displacement (0-50 points)
    if (hipDisplacement > 0.3) score += 50;
    else if (hipDisplacement > 0.15) score += 35;
    else if (hipDisplacement > 0.05) score += 20;
    else score += 5;

    // Knee extension (0-30 points)
    if (kneeExtension > 20) score += 30;
    else if (kneeExtension > 10) score += 20;
    else if (kneeExtension > 0) score += 10;

    // Knee bend depth at trophy (0-20 points)
    if (kneeBendAtTrophy < 140) score += 20;
    else if (kneeBendAtTrophy < 155) score += 10;
    else score += 3;

    return {
      kneeBendAtTrophy: Math.round(kneeBendAtTrophy),
      kneeBendAtContact: Math.round(kneeBendAtContact),
      hipVerticalDisplacement: Math.round(hipDisplacement * 100) / 100,
      kneeExtension: Math.round(kneeExtension),
      score: Math.min(100, Math.round(score))
    };
  }

  // ── Shoulder tilt ─────────────────────────────────────────────────

  measureShoulderTilt(poseHistory, servePhases, idx) {
    const tFrame = servePhases.trophyFrame;
    const cFrame = servePhases.contactFrame;
    const tLm = poseHistory[tFrame]?.landmarks;
    const cLm = poseHistory[cFrame]?.landmarks;

    const calcTilt = (lm) => {
      if (!lm) return 0;
      // Non-dom shoulder should be HIGHER (lower Y) at trophy
      const dy = lm[idx.nonDomShoulder].y - lm[idx.domShoulder].y;
      const dx = lm[idx.nonDomShoulder].x - lm[idx.domShoulder].x;
      return Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    };

    const atTrophy = calcTilt(tLm);
    const atContact = calcTilt(cLm);

    // Score: ideal tilt at trophy is 20-45°
    let score = 0;
    if (atTrophy >= 20 && atTrophy <= 45) score = 100;
    else if (atTrophy >= 15 && atTrophy <= 55) score = 75;
    else if (atTrophy >= 10) score = 50;
    else score = 20;

    return {
      atTrophy: Math.round(atTrophy),
      atContact: Math.round(atContact),
      score: Math.round(score)
    };
  }

  // ── Toss arm extension ────────────────────────────────────────────

  measureTossArm(poseHistory, servePhases, idx) {
    const prepEnd = servePhases.trophy.end;

    // Find peak toss hand height during preparation → trophy
    let peakY = Infinity;
    let peakFrame = 0;
    for (let i = 0; i <= prepEnd && i < poseHistory.length; i++) {
      const lm = poseHistory[i].landmarks;
      if (!lm || !lm[idx.nonDomWrist]) continue;
      if (lm[idx.nonDomWrist].y < peakY) {
        peakY = lm[idx.nonDomWrist].y;
        peakFrame = i;
      }
    }

    const peakLm = poseHistory[peakFrame]?.landmarks;
    if (!peakLm) return { score: 0 };

    // Is peak above shoulder?
    const shoulderY = peakLm[idx.nonDomShoulder].y;
    const aboveShoulder = peakY < shoulderY;

    // Is toss arm straight? (elbow angle > 150°)
    const elbowAngle = this._angle(
      peakLm[idx.nonDomShoulder], peakLm[idx.nonDomElbow], peakLm[idx.nonDomWrist]
    );
    const armStraight = elbowAngle > 150;

    // How far above shoulder
    const heightAboveShoulder = shoulderY - peakY; // positive = above

    // Score
    let score = 0;
    if (aboveShoulder) {
      score += 50;
      if (heightAboveShoulder > 0.15) score += 20;
      else if (heightAboveShoulder > 0.05) score += 10;
    } else {
      score += 10;
    }
    if (armStraight) score += 30;
    else if (elbowAngle > 130) score += 15;

    return {
      peakHeight: Math.round(peakY * 1000) / 1000,
      aboveShoulder,
      armStraight,
      elbowAngle: Math.round(elbowAngle),
      score: Math.min(100, Math.round(score))
    };
  }

  // ── Contact height ────────────────────────────────────────────────

  measureContactHeight(poseHistory, servePhases, idx) {
    const cFrame = servePhases.contactFrame;
    const lm = poseHistory[cFrame]?.landmarks;
    if (!lm) return { score: 0 };

    const wristY = lm[idx.domWrist].y;
    const noseY = lm[idx.nose]?.y ?? 0.3;

    // Positive = wrist above nose (lower Y = higher)
    const relativeToHead = noseY - wristY;

    let assessment;
    if (relativeToHead > 0.15) assessment = 'high';
    else if (relativeToHead > 0.05) assessment = 'good';
    else assessment = 'low';

    // Score
    let score = 0;
    if (assessment === 'high') score = 100;
    else if (assessment === 'good') score = 75;
    else if (relativeToHead > 0) score = 50;
    else if (relativeToHead > -0.05) score = 30;
    else score = 10;

    return {
      height: Math.round(wristY * 1000) / 1000,
      relativeToHead: Math.round(relativeToHead * 1000) / 1000,
      assessment,
      score: Math.round(score)
    };
  }

  // ── Trunk rotation ────────────────────────────────────────────────

  measureTrunkRotation(poseHistory, servePhases, idx) {
    const tFrame = servePhases.trophyFrame;
    const cFrame = servePhases.contactFrame;
    const tLm = poseHistory[tFrame]?.landmarks;
    const cLm = poseHistory[cFrame]?.landmarks;

    const calcSep = (lm) => {
      if (!lm) return 0;
      const shoulderAngle = Math.atan2(
        lm[idx.domShoulder].y - lm[idx.nonDomShoulder].y,
        lm[idx.domShoulder].x - lm[idx.nonDomShoulder].x
      ) * 180 / Math.PI;
      const hipAngle = Math.atan2(
        lm[idx.domHip].y - lm[idx.nonDomHip].y,
        lm[idx.domHip].x - lm[idx.nonDomHip].x
      ) * 180 / Math.PI;
      return Math.abs(shoulderAngle - hipAngle);
    };

    const sepAtTrophy = calcSep(tLm);
    const sepAtContact = calcSep(cLm);
    const uncoilRange = Math.abs(sepAtTrophy - sepAtContact);

    // Score: good coil at trophy (>20°) and good uncoil range (>15°)
    let score = 0;
    if (sepAtTrophy > 30) score += 50;
    else if (sepAtTrophy > 20) score += 35;
    else if (sepAtTrophy > 10) score += 20;
    else score += 5;

    if (uncoilRange > 20) score += 50;
    else if (uncoilRange > 10) score += 30;
    else score += 10;

    return {
      hipShoulderSepAtTrophy: Math.round(sepAtTrophy),
      uncoilRange: Math.round(uncoilRange),
      score: Math.min(100, Math.round(score))
    };
  }

  // ── Follow-through ────────────────────────────────────────────────

  measureServeFollowThrough(poseHistory, servePhases, idx) {
    const ftEnd = servePhases.followThrough.end;
    const lastFrames = poseHistory.slice(
      Math.max(servePhases.followThrough.start, ftEnd - 5), ftEnd + 1
    );
    if (lastFrames.length === 0) return { score: 0 };

    const lastLm = lastFrames[lastFrames.length - 1].landmarks;
    if (!lastLm) return { score: 0 };

    // Body midline X = average of shoulders
    const midlineX = (lastLm[idx.domShoulder].x + lastLm[idx.nonDomShoulder].x) / 2;
    const domWristX = lastLm[idx.domWrist].x;

    // Did dominant wrist cross to non-dominant side?
    // For right-hander: non-dom side is left (lower X). Wrist should go to lower X.
    // For left-hander: non-dom side is right (higher X). Wrist should go to higher X.
    const isLeft = this.dominantHand === 'left';
    const wristCrossedBody = isLeft
      ? domWristX > midlineX + 0.02
      : domWristX < midlineX - 0.02;

    let followThroughDepth = isLeft
      ? domWristX - midlineX
      : midlineX - domWristX;

    if (this.torsoLength && this.torsoLength > 0.01) {
      followThroughDepth /= this.torsoLength;
    }

    let score = 0;
    if (wristCrossedBody) {
      score += 60;
      if (followThroughDepth > 0.3) score += 40;
      else if (followThroughDepth > 0.15) score += 25;
      else score += 10;
    } else {
      score += 20;
    }

    return {
      wristCrossedBody,
      followThroughDepth: Math.round(followThroughDepth * 100) / 100,
      score: Math.min(100, Math.round(score))
    };
  }

  // ── Composite serve score ─────────────────────────────────────────

  calculateServeScore(trophy, legDrive, shoulderTilt, tossArm, contactHeight, trunkRotation, followThrough) {
    const w = {
      trophy: 0.25,
      legDrive: 0.20,
      contactHeight: 0.20,
      shoulderTilt: 0.10,
      tossArm: 0.10,
      trunkRotation: 0.10,
      followThrough: 0.05
    };

    const score =
      (trophy?.score || 0) * w.trophy +
      (legDrive?.score || 0) * w.legDrive +
      (contactHeight?.score || 0) * w.contactHeight +
      (shoulderTilt?.score || 0) * w.shoulderTilt +
      (tossArm?.score || 0) * w.tossArm +
      (trunkRotation?.score || 0) * w.trunkRotation +
      (followThrough?.score || 0) * w.followThrough;

    return Math.min(100, Math.round(score));
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /** Calculate angle at p2 (vertex) formed by p1-p2-p3, in degrees */
  _angle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return 180;
    // Skip if any of the three landmarks are not visible
    if (typeof isLandmarkVisible === 'function' &&
        (!isLandmarkVisible(p1) || !isLandmarkVisible(p2) || !isLandmarkVisible(p3))) {
      return 180; // neutral default (straight)
    }
    const rad = Math.atan2(p3.y - p2.y, p3.x - p2.x) -
                Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let deg = Math.abs(rad * 180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    return deg;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ServeAnalyzer;
} else {
  window.ServeAnalyzer = ServeAnalyzer;
}
