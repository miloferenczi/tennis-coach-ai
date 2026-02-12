/**
 * CorrectedPoseEngine — Computes "ideal" landmark positions from a player's
 * actual pose based on detected faults. Used by Coach's Eye ghost skeleton
 * to show what correct form looks like for the player's specific body.
 *
 * Phase-aware: only applies corrections during relevant stroke phases.
 * Uses skill-level targets from ImprovementTracker + biomechanical checkpoint ideals.
 */
class CorrectedPoseEngine {
  constructor() {
    // Fault → correction rule mapping
    // pivot: joint index to rotate around
    // moved: joint indices that get rotated/translated
    // target: desired angle or position delta
    // phases: only apply during these phases
    this.correctionRules = {
      collapsingElbow: {
        getCorrection: (lm, skillLevel, dom) => {
          const targets = this._getFormTargets(skillLevel);
          const elbowIdx = dom === 'left' ? 13 : 14;
          const shoulderIdx = dom === 'left' ? 11 : 12;
          const wristIdx = dom === 'left' ? 15 : 16;
          const current = this._calculateAngle(lm[shoulderIdx], lm[elbowIdx], lm[wristIdx]);
          const target = targets.elbowAngle || 150;
          if (current >= target - 5) return null;
          return { pivot: elbowIdx, moved: [wristIdx], targetAngle: target, currentAngle: current, label: 'Elbow Extension' };
        },
        phases: ['contact', 'acceleration']
      },

      collapsingElbowChickenWing: {
        getCorrection: (lm, skillLevel, dom) => {
          // Same correction as collapsingElbow
          return CorrectedPoseEngine.prototype.correctionRules.collapsingElbow.getCorrection(lm, skillLevel, dom);
        },
        phases: ['contact', 'acceleration']
      },

      noKneeBend: {
        getCorrection: (lm, skillLevel) => {
          // Correct both knees
          const corrections = [];
          for (const side of [[23, 25, 27], [24, 26, 28]]) {
            const [hipIdx, kneeIdx, ankleIdx] = side;
            const current = this._calculateAngle(lm[hipIdx], lm[kneeIdx], lm[ankleIdx]);
            const target = 140;
            if (current >= target - 5) continue;
            corrections.push({ pivot: kneeIdx, moved: [ankleIdx], targetAngle: target, currentAngle: current, label: 'Knee Bend' });
          }
          return corrections.length > 0 ? corrections : null;
        },
        phases: ['loading', 'acceleration']
      },

      armOnlySwing: {
        getCorrection: (lm, skillLevel, dom) => {
          const targets = this._getFormTargets(skillLevel);
          const targetRot = targets.rotation || 20;
          return this._buildRotationCorrection(lm, targetRot, dom, 'Trunk Rotation');
        },
        phases: ['loading', 'acceleration']
      },

      insufficientRotation: {
        getCorrection: (lm, skillLevel, dom) => {
          const targets = this._getFormTargets(skillLevel);
          const targetRot = targets.rotation || 20;
          return this._buildRotationCorrection(lm, targetRot, dom, 'Trunk Rotation');
        },
        phases: ['loading', 'acceleration', 'contact']
      },

      hittingOffBackFoot: {
        getCorrection: (lm, skillLevel, dom) => {
          // Translate hips + legs forward by 0.03 normalized
          const delta = dom === 'left' ? -0.03 : 0.03;
          return {
            type: 'translate',
            moved: [23, 24, 25, 26, 27, 28],
            dx: delta,
            dy: 0,
            label: 'Weight Forward',
            pivot: -1, targetAngle: 0, currentAngle: 0
          };
        },
        phases: ['contact']
      },

      narrowBase: {
        getCorrection: (lm) => {
          const hipMidX = (lm[23].x + lm[24].x) / 2;
          const corrections = [];
          // Push ankles outward
          for (const ankleIdx of [27, 28]) {
            const ankle = lm[ankleIdx];
            const dir = ankle.x < hipMidX ? -0.025 : 0.025;
            corrections.push({
              type: 'translate',
              moved: [ankleIdx],
              dx: dir,
              dy: 0,
              label: 'Wider Base',
              pivot: -1, targetAngle: 0, currentAngle: 0
            });
          }
          return corrections;
        },
        phases: ['loading', 'contact']
      },

      abbreviatedFollowThrough: {
        getCorrection: (lm, skillLevel, dom) => {
          const shoulderIdx = dom === 'left' ? 11 : 12;
          const elbowIdx = dom === 'left' ? 13 : 14;
          const wristIdx = dom === 'left' ? 15 : 16;
          // Extend wrist past body midline
          const midX = (lm[11].x + lm[12].x) / 2;
          const wrist = lm[wristIdx];
          const pastMidline = dom === 'left' ? wrist.x > midX : wrist.x < midX;
          if (pastMidline) return null;
          // Rotate wrist around shoulder to extend follow-through
          const current = this._calculateAngle(lm[elbowIdx], lm[shoulderIdx], lm[wristIdx]);
          return {
            pivot: shoulderIdx,
            moved: [elbowIdx, wristIdx],
            targetAngle: current + 25,
            currentAngle: current,
            label: 'Follow Through'
          };
        },
        phases: ['followThrough']
      },

      poorFollowThrough: {
        getCorrection: (lm, skillLevel, dom) => {
          return CorrectedPoseEngine.prototype.correctionRules.abbreviatedFollowThrough.getCorrection(lm, skillLevel, dom);
        },
        phases: ['followThrough']
      },

      // Serve-specific faults
      noLegDrive: {
        getCorrection: (lm) => {
          const corrections = [];
          for (const [hipIdx, kneeIdx, ankleIdx] of [[23, 25, 27], [24, 26, 28]]) {
            const current = this._calculateAngle(lm[hipIdx], lm[kneeIdx], lm[ankleIdx]);
            const target = 130;
            if (current <= target + 5) continue;
            corrections.push({ pivot: kneeIdx, moved: [ankleIdx], targetAngle: target, currentAngle: current, label: 'Knee Drive' });
          }
          return corrections.length > 0 ? corrections : null;
        },
        phases: ['loading']
      },

      noTrophyPosition: {
        getCorrection: (lm, skillLevel, dom) => {
          const shoulderIdx = dom === 'left' ? 11 : 12;
          const elbowIdx = dom === 'left' ? 13 : 14;
          const wristIdx = dom === 'left' ? 15 : 16;
          const current = this._calculateAngle(lm[shoulderIdx], lm[elbowIdx], lm[wristIdx]);
          const target = 90;
          if (Math.abs(current - target) < 10) return null;
          return { pivot: elbowIdx, moved: [wristIdx], targetAngle: target, currentAngle: current, label: 'Trophy Position' };
        },
        phases: ['loading']
      },

      flatServeNoTilt: {
        getCorrection: (lm) => {
          // Tilt shoulders — move one shoulder up, one down
          const targetTilt = 30;
          const shoulderDy = Math.abs(lm[11].y - lm[12].y);
          const torsoLen = this._torsoLength(lm);
          const currentTiltDeg = torsoLen > 0 ? Math.atan2(shoulderDy, torsoLen) * (180 / Math.PI) : 0;
          if (currentTiltDeg >= targetTilt - 5) return null;
          const tiltDelta = (targetTilt - currentTiltDeg) * (Math.PI / 180);
          const midX = (lm[11].x + lm[12].x) / 2;
          const midY = (lm[11].y + lm[12].y) / 2;
          return {
            type: 'rotate_pair',
            indices: [11, 12],
            pivotX: midX, pivotY: midY,
            deltaRadians: tiltDelta * 0.5,
            label: 'Shoulder Tilt',
            targetAngle: targetTilt, currentAngle: Math.round(currentTiltDeg),
            pivot: -1
          };
        },
        phases: ['loading', 'acceleration']
      },

      lowServeContactPoint: {
        getCorrection: (lm, skillLevel, dom) => {
          const shoulderIdx = dom === 'left' ? 11 : 12;
          const elbowIdx = dom === 'left' ? 13 : 14;
          const wristIdx = dom === 'left' ? 15 : 16;
          const nose = lm[0];
          // Wrist should be above nose (lower Y = higher)
          const targetY = nose.y - 0.1;
          if (lm[wristIdx].y <= targetY) return null;
          const current = this._calculateAngle(lm[shoulderIdx], lm[elbowIdx], lm[wristIdx]);
          return {
            pivot: shoulderIdx,
            moved: [elbowIdx, wristIdx],
            targetAngle: current + 15,
            currentAngle: current,
            label: 'Higher Contact'
          };
        },
        phases: ['contact']
      }
    };
  }

  /**
   * Compute corrected landmarks based on detected faults.
   * @param {Array} landmarks - 33 MediaPipe landmarks {x, y, visibility}
   * @param {Array} faults - Detected biomechanical faults [{id, name, priority}]
   * @param {string} strokeType - e.g. 'Forehand', 'Backhand', 'Serve'
   * @param {string} phase - Current frame phase
   * @param {string} skillLevel - beginner/intermediate/advanced/elite
   * @param {string} dominantHand - 'left' or 'right'
   * @returns {Object|null} { landmarks, correctedIndices: Set, annotations: [] } or null
   */
  computeCorrected(landmarks, faults, strokeType, phase, skillLevel, dominantHand) {
    if (!landmarks || !faults || faults.length === 0) return null;
    if (!phase || phase === 'unknown') return null;

    // Deep clone landmarks
    const corrected = landmarks.map(lm => ({ x: lm.x, y: lm.y, visibility: lm.visibility }));
    const correctedIndices = new Set();
    const annotations = [];

    for (const fault of faults) {
      const faultId = fault.id || fault.name;
      const rule = this.correctionRules[faultId];
      if (!rule) continue;

      // Phase check
      if (!rule.phases.includes(phase)) continue;

      let correction;
      try {
        correction = rule.getCorrection.call(this, corrected, skillLevel, dominantHand);
      } catch (e) {
        continue;
      }
      if (!correction) continue;

      // Handle array of corrections (e.g., noKneeBend applies to both legs)
      const corrections = Array.isArray(correction) ? correction : [correction];

      for (const c of corrections) {
        if (c.type === 'translate') {
          // Simple translation
          for (const idx of c.moved) {
            corrected[idx] = { ...corrected[idx], x: corrected[idx].x + c.dx, y: corrected[idx].y + c.dy };
            correctedIndices.add(idx);
          }
          if (c.label) {
            annotations.push({
              index: c.moved[0],
              label: c.label,
              targetAngle: null,
              actualAngle: null
            });
          }
        } else if (c.type === 'rotate_pair') {
          // Rotate two points around their midpoint
          for (const idx of c.indices) {
            const pt = corrected[idx];
            const rotated = this._rotatePoint(pt, { x: c.pivotX, y: c.pivotY },
              idx === c.indices[0] ? c.deltaRadians : -c.deltaRadians);
            corrected[idx] = { ...pt, x: rotated.x, y: rotated.y };
            correctedIndices.add(idx);
          }
          annotations.push({
            index: c.indices[0],
            label: c.label,
            targetAngle: c.targetAngle,
            actualAngle: c.currentAngle
          });
        } else {
          // Standard rotation: rotate moved joints around pivot
          const pivot = corrected[c.pivot];
          const deltaRad = (c.targetAngle - c.currentAngle) * (Math.PI / 180);

          for (const movedIdx of c.moved) {
            const rotated = this._rotatePoint(corrected[movedIdx], pivot, deltaRad);
            corrected[movedIdx] = { ...corrected[movedIdx], x: rotated.x, y: rotated.y };
            correctedIndices.add(movedIdx);
          }
          correctedIndices.add(c.pivot);

          annotations.push({
            index: c.pivot,
            label: c.label,
            targetAngle: Math.round(c.targetAngle),
            actualAngle: Math.round(c.currentAngle)
          });
        }
      }
    }

    if (correctedIndices.size === 0) return null;

    return { landmarks: corrected, correctedIndices, annotations };
  }

  // ── Utility methods ──

  _calculateAngle(a, b, c) {
    if (!a || !b || !c) return 180;
    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
    const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
    if (magBA === 0 || magBC === 0) return 180;
    const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  _rotatePoint(point, pivot, deltaRadians) {
    const cos = Math.cos(deltaRadians);
    const sin = Math.sin(deltaRadians);
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return {
      x: pivot.x + dx * cos - dy * sin,
      y: pivot.y + dx * sin + dy * cos
    };
  }

  _torsoLength(lm) {
    const shoulderMidX = (lm[11].x + lm[12].x) / 2;
    const shoulderMidY = (lm[11].y + lm[12].y) / 2;
    const hipMidX = (lm[23].x + lm[24].x) / 2;
    const hipMidY = (lm[23].y + lm[24].y) / 2;
    const dx = shoulderMidX - hipMidX;
    const dy = shoulderMidY - hipMidY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _getFormTargets(skillLevel) {
    if (typeof improvementTracker !== 'undefined' && improvementTracker.getFormTargets) {
      return improvementTracker.getFormTargets(skillLevel);
    }
    const defaults = {
      beginner:     { rotation: 15, hipSep: 20, elbowAngle: 135, smoothness: 50 },
      intermediate: { rotation: 20, hipSep: 35, elbowAngle: 145, smoothness: 65 },
      advanced:     { rotation: 25, hipSep: 45, elbowAngle: 155, smoothness: 75 },
      elite:        { rotation: 30, hipSep: 55, elbowAngle: 160, smoothness: 85 }
    };
    return defaults[skillLevel] || defaults.intermediate;
  }

  _buildRotationCorrection(lm, targetRotDeg, dom, label) {
    // Measure current shoulder rotation relative to hips
    const hipMidX = (lm[23].x + lm[24].x) / 2;
    const hipMidY = (lm[23].y + lm[24].y) / 2;
    const shoulderDx = lm[12].x - lm[11].x;
    const hipDx = lm[24].x - lm[23].x;
    // Rough rotation estimate in degrees
    const currentRot = shoulderDx !== 0 ? Math.abs(Math.atan2(shoulderDx - hipDx, 1) * (180 / Math.PI)) : 0;
    if (currentRot >= targetRotDeg - 3) return null;

    const deltaRad = (targetRotDeg - currentRot) * (Math.PI / 180) * (dom === 'left' ? -1 : 1);
    const pivot = { x: hipMidX, y: hipMidY };

    return {
      pivot: -1,
      moved: [11, 12],
      targetAngle: targetRotDeg,
      currentAngle: Math.round(currentRot),
      label,
      type: 'rotate_pair',
      indices: [11, 12],
      pivotX: hipMidX,
      pivotY: hipMidY,
      deltaRadians: deltaRad * 0.5
    };
  }
}
