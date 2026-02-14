/**
 * StrokeReplayManager — Records stroke pose data and provides instant replay
 * with phase-colored skeleton, fault highlights, and metric overlays.
 */
class StrokeReplayManager {
  constructor() {
    this.replays = [];       // Array of replay objects
    this.maxReplays = 30;    // Max stored replays
    this.isPlaying = false;
    this.isPaused = false;
    this.currentReplayIndex = -1;
    this.currentFrameIndex = 0;
    this.playbackSpeed = 0.5; // Default half speed
    this.playbackInterval = null;
    this.looping = true;

    // Skeleton connections (same as GhostOverlay)
    this.connections = [
      // Torso
      [11, 12], [11, 23], [12, 24], [23, 24],
      // Right arm
      [12, 14], [14, 16],
      // Left arm
      [11, 13], [13, 15],
      // Right leg
      [24, 26], [26, 28],
      // Left leg
      [23, 25], [25, 27]
    ];

    // Coach's Eye ghost skeleton state
    this.ghostEnabled = false;
    this.ghostBreathPhase = 0;
    this.correctedPoseEngine = null;
    this._pendingAnnotations = null;

    // Body landmark indices (skip face/hands)
    this.bodyIndices = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);
  }

  /**
   * Record a stroke's pose history for replay.
   * @param {Array} poseHistory - Array of pose data frames
   * @param {Object} strokeData - Stroke analysis results
   * @returns {Object} The replay object
   */
  recordStroke(poseHistory, strokeData) {
    if (!poseHistory || poseHistory.length < 10) return null;

    // Extract last 45 frames (or all if fewer)
    const frameCount = Math.min(45, poseHistory.length);
    const startIdx = poseHistory.length - frameCount;

    // Map phase ranges to frame indices
    const phases = strokeData.sequenceAnalysis?.phases || null;

    const frames = [];
    for (let i = startIdx; i < poseHistory.length; i++) {
      const pose = poseHistory[i];
      if (!pose.landmarks) continue;

      // Clone landmarks (just x, y, visibility for the 33 points)
      const landmarks = pose.landmarks.map(lm => ({
        x: lm.x,
        y: lm.y,
        visibility: lm.visibility || 0
      }));

      // Determine phase for this frame
      const frameIdx = i - startIdx;
      let phase = 'unknown';
      if (phases) {
        if (phases.preparation && frameIdx >= phases.preparation.start && frameIdx < phases.preparation.end) phase = 'preparation';
        else if (phases.loading && frameIdx >= phases.loading.start && frameIdx < phases.loading.end) phase = 'loading';
        else if (phases.acceleration && frameIdx >= phases.acceleration.start && frameIdx < phases.acceleration.end) phase = 'acceleration';
        else if (phases.followThrough && frameIdx >= phases.followThrough.start && frameIdx < phases.followThrough.end) phase = 'followThrough';
        // Contact is the boundary between acceleration and followThrough
        if (phases.acceleration && frameIdx === phases.acceleration.end) phase = 'contact';
      }

      frames.push({
        landmarks,
        timestamp: pose.timestamp || 0,
        velocity: pose.velocity?.magnitude || 0,
        phase
      });
    }

    if (frames.length < 5) return null;

    const replay = {
      frames,
      strokeData: {
        type: strokeData.type,
        quality: strokeData.quality?.overall || 0,
        qualityBreakdown: strokeData.quality?.breakdown || null,
        technique: strokeData.technique || null,
        biomechanicalFaults: strokeData.biomechanicalEvaluation?.detectedFaults?.map(f => ({
          id: f.id,
          name: f.name,
          priority: f.priority
        })) || [],
        serveAnalysis: strokeData.serveAnalysis ? {
          serveScore: strokeData.serveAnalysis.serveScore,
          trophyScore: strokeData.serveAnalysis.trophy?.score,
          legDriveScore: strokeData.serveAnalysis.legDrive?.score
        } : null,
        smoothness: strokeData.smoothness || 0,
        estimatedBallSpeed: strokeData.estimatedBallSpeed || null,
        skillLevel: strokeData.proComparison?.skillLevel || 'intermediate'
      },
      timestamp: Date.now()
    };

    this.replays.push(replay);

    // Trim to max
    if (this.replays.length > this.maxReplays) {
      this.replays.shift();
    }

    return replay;
  }

  /**
   * Start playback of a replay on a canvas.
   */
  startPlayback(index, canvas, ctx, options = {}) {
    if (index < 0 || index >= this.replays.length) return;

    this.stopPlayback();

    this.currentReplayIndex = index;
    this.currentFrameIndex = 0;
    this.isPlaying = true;
    this.isPaused = false;
    this.playbackSpeed = options.speed || 0.5;
    this.looping = options.loop !== false;

    const replay = this.replays[index];
    const frameInterval = (1000 / 30) / this.playbackSpeed;

    // Draw first frame immediately
    this.drawReplayFrame(ctx, canvas, replay, 0, options);

    this.playbackInterval = setInterval(() => {
      if (this.isPaused) return;

      this.currentFrameIndex++;
      if (this.currentFrameIndex >= replay.frames.length) {
        if (this.looping) {
          this.currentFrameIndex = 0;
        } else {
          this.stopPlayback();
          if (options.onComplete) options.onComplete();
          return;
        }
      }

      this.drawReplayFrame(ctx, canvas, replay, this.currentFrameIndex, options);
    }, frameInterval);
  }

  stopPlayback() {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
    this.isPlaying = false;
    this.isPaused = false;
  }

  pausePlayback() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  /**
   * Seek to a specific frame (pauses playback).
   */
  seekToFrame(idx) {
    if (this.currentReplayIndex < 0) return;
    const replay = this.replays[this.currentReplayIndex];
    if (!replay) return;

    this.currentFrameIndex = Math.max(0, Math.min(idx, replay.frames.length - 1));
    this.isPaused = true;
  }

  setPlaybackSpeed(speed) {
    if (!this.isPlaying || this.currentReplayIndex < 0) return;

    this.playbackSpeed = speed;
    // Restart interval with new speed
    const replay = this.replays[this.currentReplayIndex];
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
    }

    const frameInterval = (1000 / 30) / this.playbackSpeed;
    this.playbackInterval = setInterval(() => {
      if (this.isPaused) return;

      this.currentFrameIndex++;
      if (this.currentFrameIndex >= replay.frames.length) {
        if (this.looping) {
          this.currentFrameIndex = 0;
        } else {
          this.stopPlayback();
          return;
        }
      }

      // Re-acquire canvas from the overlay
      const canvas = document.getElementById('replayCanvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        this.drawReplayFrame(ctx, canvas, replay, this.currentFrameIndex, {});
      }
    }, frameInterval);
  }

  /**
   * Draw a single replay frame.
   */
  drawReplayFrame(ctx, canvas, replay, frameIndex, options) {
    const frame = replay.frames[frameIndex];
    if (!frame) return;

    const w = canvas.width;
    const h = canvas.height;

    // Phase colors
    const phaseColors = {
      preparation:   'rgba(60, 130, 246, 1)',
      loading:       'rgba(250, 204, 21, 1)',
      acceleration:  'rgba(249, 115, 22, 1)',
      contact:       'rgba(255, 59, 48, 1)',
      followThrough: 'rgba(50, 215, 75, 1)',
      unknown:       'rgba(0, 255, 255, 1)'
    };

    const phaseColorDim = {
      preparation:   'rgba(60, 130, 246, 0.4)',
      loading:       'rgba(250, 204, 21, 0.4)',
      acceleration:  'rgba(249, 115, 22, 0.4)',
      contact:       'rgba(255, 59, 48, 0.4)',
      followThrough: 'rgba(50, 215, 75, 0.4)',
      unknown:       'rgba(0, 255, 255, 0.4)'
    };

    // Dark background
    ctx.fillStyle = 'rgba(10, 10, 10, 0.85)';
    ctx.fillRect(0, 0, w, h);

    // Coach's Eye ghost skeleton (drawn behind player skeleton)
    if (this.ghostEnabled && this.correctedPoseEngine) {
      const corrected = this.correctedPoseEngine.computeCorrected(
        frame.landmarks,
        replay.strokeData.biomechanicalFaults,
        replay.strokeData.type,
        frame.phase,
        options.skillLevel || replay.strokeData.skillLevel || 'intermediate',
        options.dominantHand || 'right'
      );
      if (corrected) {
        this.ghostBreathPhase++;
        this.drawGhostSkeleton(ctx, corrected, frame.landmarks, w, h, this.ghostBreathPhase);
        this._pendingAnnotations = corrected.annotations;
      } else {
        this._pendingAnnotations = null;
      }
    }

    // Draw skeleton connections
    const lm = frame.landmarks;
    const color = phaseColors[frame.phase] || phaseColors.unknown;
    const dimColor = phaseColorDim[frame.phase] || phaseColorDim.unknown;

    ctx.lineWidth = 3;
    ctx.strokeStyle = dimColor;
    for (const [a, b] of this.connections) {
      if (lm[a] && lm[b] && (lm[a].visibility > 0.3) && (lm[b].visibility > 0.3)) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
      }
    }

    // Draw joints
    for (let i = 0; i < lm.length; i++) {
      const pt = lm[i];
      if (!pt || pt.visibility < 0.3) continue;

      const isFault = this.isLandmarkFaulted(i, replay.strokeData, options.faultLandmarkMap);

      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, isFault ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isFault ? 'rgba(255, 59, 48, 0.9)' : color;
      ctx.fill();

      if (isFault) {
        ctx.strokeStyle = 'rgba(255, 59, 48, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Enhanced wrist swing trail — velocity-colored with acceleration-proportional width
    this.drawEnhancedWristTrail(ctx, replay, frameIndex, w, h, options);

    // Coach's Eye angle annotations (after trail, before text)
    if (this.ghostEnabled && this._pendingAnnotations) {
      const showDetailed = this.isPaused || this.playbackSpeed <= 0.25;
      this.drawAngleAnnotations(ctx, this._pendingAnnotations, frame.landmarks, w, h, showDetailed);
    }

    // Text overlays
    ctx.font = 'bold 16px Inter, sans-serif';

    // Top-left: stroke type + quality
    ctx.fillStyle = '#F5F5F5';
    ctx.textAlign = 'left';
    const qualityColor = replay.strokeData.quality >= 80 ? '#32D74B'
      : replay.strokeData.quality >= 60 ? '#A0F0FF' : '#FF3B30';
    ctx.fillText(`${replay.strokeData.type}`, 16, 30);
    ctx.fillStyle = qualityColor;
    ctx.fillText(`${replay.strokeData.quality}/100`, 16, 52);

    // Top-right: phase name
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    const phaseName = frame.phase === 'followThrough' ? 'FOLLOW-THROUGH'
      : frame.phase.toUpperCase();
    ctx.fillText(phaseName, w - 16, 30);

    // Bottom-left: frame counter
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`Frame ${frameIndex + 1}/${replay.frames.length}`, 16, h - 20);

    // Bottom-right: speed
    ctx.textAlign = 'right';
    ctx.fillText(`${this.playbackSpeed}x`, w - 16, h - 20);

    // Progress bar at bottom edge
    const progress = replay.frames.length > 1
      ? frameIndex / (replay.frames.length - 1) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, h - 4, w, 4);
    ctx.fillStyle = color;
    ctx.fillRect(0, h - 4, w * progress, 4);
  }

  /**
   * Check if a landmark index is affected by any detected fault.
   */
  isLandmarkFaulted(landmarkIdx, strokeData, faultLandmarkMap) {
    if (!faultLandmarkMap || !strokeData.biomechanicalFaults) return false;
    for (const fault of strokeData.biomechanicalFaults) {
      const affected = faultLandmarkMap[fault.id];
      if (affected && affected.includes(landmarkIdx)) return true;
    }
    return false;
  }

  getReplay(index) {
    return this.replays[index] || null;
  }

  getAllReplays() {
    return this.replays;
  }

  getReplayCount() {
    return this.replays.length;
  }

  clearReplays() {
    this.stopPlayback();
    this.replays = [];
    this.currentReplayIndex = -1;
  }

  getTopReplays(n) {
    return [...this.replays]
      .sort((a, b) => b.strokeData.quality - a.strokeData.quality)
      .slice(0, n);
  }

  // ========== Coach's Eye: Ghost Skeleton ==========

  /**
   * Draw the "corrected" ghost skeleton in gold.
   * Breathing opacity, soft glow, emphasized corrected joints.
   */
  drawGhostSkeleton(ctx, correctedData, originalLandmarks, w, h, animPhase) {
    const lm = correctedData.landmarks;
    const corrected = correctedData.correctedIndices;

    // Breathing opacity
    const baseAlpha = 0.28 + 0.05 * Math.sin(animPhase * 0.05);

    ctx.save();
    ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
    ctx.shadowBlur = 10;

    // Draw connections
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 215, 0, ${baseAlpha + 0.12})`;
    for (const [a, b] of this.connections) {
      if (!this.bodyIndices.has(a) && !this.bodyIndices.has(b)) continue;
      if (!lm[a] || !lm[b]) continue;
      if ((lm[a].visibility || 0) < 0.3 || (lm[b].visibility || 0) < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    }

    // Draw joints
    for (const idx of this.bodyIndices) {
      const pt = lm[idx];
      if (!pt || (pt.visibility || 0) < 0.3) continue;

      const isCorrected = corrected.has(idx);
      const px = pt.x * w;
      const py = pt.y * h;

      if (isCorrected) {
        // Emphasized corrected joint — larger, brighter, with glow ring
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 215, 0, 0.8)`;
        ctx.fill();

        // Outer glow ring
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 215, 0, ${baseAlpha + 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // Subtle non-corrected joint
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 215, 0, ${baseAlpha + 0.07})`;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Draw angle annotations at corrected joints.
   * Gold = target angle (above), Red = actual angle (below).
   * Full detail only when paused or at 0.25x speed.
   */
  drawAngleAnnotations(ctx, annotations, originalLandmarks, w, h, showDetailed) {
    ctx.save();
    for (const ann of annotations) {
      const lm = originalLandmarks[ann.index];
      if (!lm || (lm.visibility || 0) < 0.3) continue;

      const px = lm.x * w;
      const py = lm.y * h;

      // Always show label
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 3;

      // Label above joint
      ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.fillText(ann.label, px, py - 18);

      // Angle detail only in slow/paused mode
      if (showDetailed && ann.targetAngle != null && ann.actualAngle != null) {
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillStyle = '#FFD700';
        ctx.fillText(`${ann.targetAngle}°`, px, py - 30);
        ctx.fillStyle = '#FF3B30';
        ctx.fillText(`${ann.actualAngle}°`, px, py + 26);
      }
    }
    ctx.restore();
  }

  // ========== Phase 3B: Enhanced Swing Path Visualization ==========

  /**
   * Draw velocity-colored wrist trail with acceleration-proportional width.
   * Blue (slow) → green → yellow → red (fast). Width scales with acceleration.
   */
  drawEnhancedWristTrail(ctx, replay, frameIndex, w, h, options) {
    const trailLength = 15;
    const trailStart = Math.max(0, frameIndex - trailLength);
    const isLefty = options.dominantHand === 'left';
    const wristIdx = isLefty ? 15 : 16;

    if (frameIndex - trailStart < 2) return;

    // Collect wrist positions and compute velocities
    const points = [];
    for (let t = trailStart; t <= frameIndex; t++) {
      const frame = replay.frames[t];
      if (!frame) continue;
      const pt = frame.landmarks[wristIdx];
      if (!pt) continue;
      points.push({ x: pt.x * w, y: pt.y * h, t });
    }

    if (points.length < 3) return;

    // Compute velocity per segment
    const velocities = [];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      velocities.push(Math.sqrt(dx * dx + dy * dy));
    }

    // Compute acceleration per segment
    const accelerations = [0];
    for (let i = 1; i < velocities.length; i++) {
      accelerations.push(Math.abs(velocities[i] - velocities[i - 1]));
    }

    const maxVel = Math.max(...velocities, 1);
    const maxAccel = Math.max(...accelerations, 1);

    // Draw each segment
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < points.length; i++) {
      const velNorm = velocities[i - 1] / maxVel;        // 0..1
      const accelNorm = accelerations[i - 1] / maxAccel;  // 0..1
      const alpha = 0.3 + 0.7 * ((i) / points.length);   // fade in

      // Velocity color: blue(0) → cyan(0.25) → green(0.5) → yellow(0.75) → red(1)
      const color = this.velocityToColor(velNorm, alpha);
      // Width: 2px base + up to 6px from acceleration
      const lineWidth = 2 + accelNorm * 6;

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }

    // Draw dot at current wrist position
    if (points.length > 0) {
      const last = points[points.length - 1];
      const lastVel = velocities.length > 0 ? velocities[velocities.length - 1] / maxVel : 0;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = this.velocityToColor(lastVel, 1.0);
      ctx.fill();
    }

    // Velocity legend (small, bottom-center)
    this.drawVelocityLegend(ctx, w, h);

    // Racket face angle indicator at contact frame
    const contactFrame = replay.frames.findIndex(f => f.phase === 'contact');
    if (contactFrame >= 0 && frameIndex >= contactFrame - 1 && frameIndex <= contactFrame + 1) {
      const cf = replay.frames[contactFrame];
      const wrist = cf.landmarks[isLefty ? 15 : 16];
      const elbow = cf.landmarks[isLefty ? 13 : 14];
      if (wrist && elbow && wrist.visibility > 0.3 && elbow.visibility > 0.3) {
        // Draw a short perpendicular line at wrist to represent racket face
        const dx = wrist.x * w - elbow.x * w;
        const dy = wrist.y * h - elbow.y * h;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          // Perpendicular direction
          const px = -dy / len;
          const py = dx / len;
          const lineLen = 18;
          const wx = wrist.x * w;
          const wy = wrist.y * h;

          // Determine color from Gemini visual data
          let faceColor = 'rgba(255,255,255,0.8)'; // default white
          let faceLabel = '';
          if (typeof tennisAI !== 'undefined' && tennisAI.visualMerger?.lastVisualResult?.racketFace) {
            const state = tennisAI.visualMerger.lastVisualResult.racketFace.state;
            if (state === 'open') { faceColor = '#FF3B30'; faceLabel = 'OPEN'; }
            else if (state === 'closed') { faceColor = '#4FC3F7'; faceLabel = 'CLOSED'; }
            else if (state === 'neutral') { faceColor = '#32D74B'; faceLabel = 'NEUTRAL'; }
          }

          ctx.strokeStyle = faceColor;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(wx - px * lineLen, wy - py * lineLen);
          ctx.lineTo(wx + px * lineLen, wy + py * lineLen);
          ctx.stroke();

          if (faceLabel) {
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.fillStyle = faceColor;
            ctx.textAlign = 'center';
            ctx.fillText(faceLabel, wx, wy - 14);
          }
        }
      }
    }
  }

  /**
   * Map normalized velocity (0..1) to a color string.
   */
  velocityToColor(t, alpha) {
    // Blue → Cyan → Green → Yellow → Red
    let r, g, b;
    if (t < 0.25) {
      const s = t / 0.25;
      r = 0; g = Math.round(180 * s); b = 255;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      r = 0; g = 180 + Math.round(75 * s); b = Math.round(255 * (1 - s));
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      r = Math.round(255 * s); g = 255; b = 0;
    } else {
      const s = (t - 0.75) / 0.25;
      r = 255; g = Math.round(255 * (1 - s)); b = 0;
    }
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /**
   * Draw a small velocity color bar legend.
   */
  drawVelocityLegend(ctx, w, h) {
    const barW = 80, barH = 6;
    const x = (w - barW) / 2;
    const y = h - 28;

    const grad = ctx.createLinearGradient(x, 0, x + barW, 0);
    grad.addColorStop(0, 'rgba(0,0,255,0.8)');
    grad.addColorStop(0.25, 'rgba(0,180,255,0.8)');
    grad.addColorStop(0.5, 'rgba(0,255,0,0.8)');
    grad.addColorStop(0.75, 'rgba(255,255,0,0.8)');
    grad.addColorStop(1.0, 'rgba(255,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);

    ctx.font = '9px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('slow', x, y - 2);
    ctx.textAlign = 'right';
    ctx.fillText('fast', x + barW, y - 2);
  }

  // ========== Phase 5B: Replay Export ==========

  /**
   * Export a replay as a WebM video via MediaRecorder.
   * @param {number} replayIndex - Index in replays array
   * @returns {Promise<Blob|null>} WebM blob or null on failure
   */
  async exportAsVideo(replayIndex) {
    const replay = this.replays[replayIndex];
    if (!replay) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    // Check MediaRecorder support
    if (typeof MediaRecorder === 'undefined') {
      console.warn('StrokeReplayManager: MediaRecorder not supported');
      return null;
    }

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2000000
    });

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };

      recorder.start();

      let frame = 0;
      const fps = 30;
      const playbackSpeed = 0.5;
      const interval = (1000 / fps) / playbackSpeed;

      const drawNext = () => {
        if (frame >= replay.frames.length) {
          recorder.stop();
          return;
        }
        this.drawReplayFrame(ctx, canvas, replay, frame, {});
        frame++;
        setTimeout(drawNext, interval);
      };

      drawNext();
    });
  }

  /**
   * Share an exported replay via Web Share API or download fallback.
   */
  async shareReplay(replayIndex) {
    try {
      const blob = await this.exportAsVideo(replayIndex);
      if (!blob) return;

      const replay = this.replays[replayIndex];
      const fileName = `ace-replay-${replay.strokeData.type.toLowerCase()}-${Date.now()}.webm`;

      if (navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: 'video/webm' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `ACE Replay: ${replay.strokeData.type}`,
            text: `${replay.strokeData.type} — Quality ${replay.strokeData.quality}/100`,
            files: [file]
          });
          return;
        }
      }

      // Download fallback
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('StrokeReplayManager: share replay failed', e);
    }
  }

  // ========== Phase 7B: Side-by-Side Comparison ==========

  /**
   * Play two replays side by side on a single canvas.
   * Left shows replay1, right shows replay2, with metric deltas.
   * @param {number} idx1 - First replay index
   * @param {number} idx2 - Second replay index
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   */
  playSideBySide(idx1, idx2, canvas, options = {}) {
    const r1 = this.replays[idx1];
    const r2 = this.replays[idx2];
    if (!r1 || !r2) return;

    this.stopPlayback();
    this.isPlaying = true;
    this.isPaused = false;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const halfW = Math.floor(w / 2);

    const maxFrames = Math.max(r1.frames.length, r2.frames.length);
    let frameIdx = 0;

    const speed = options.speed || 0.5;
    const frameInterval = (1000 / 30) / speed;

    const drawFrame = () => {
      if (this.isPaused) return;

      ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
      ctx.fillRect(0, 0, w, h);

      // Divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(halfW, 0);
      ctx.lineTo(halfW, h);
      ctx.stroke();

      // Draw left replay
      const fi1 = Math.min(frameIdx, r1.frames.length - 1);
      this.drawHalfFrame(ctx, r1, fi1, 0, 0, halfW, h);

      // Draw right replay
      const fi2 = Math.min(frameIdx, r2.frames.length - 1);
      this.drawHalfFrame(ctx, r2, fi2, halfW, 0, halfW, h);

      // Labels
      ctx.font = 'bold 14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(160,240,255,0.8)';
      ctx.fillText(`${r1.strokeData.type} — ${r1.strokeData.quality}`, halfW / 2, 20);
      ctx.fillText(`${r2.strokeData.type} — ${r2.strokeData.quality}`, halfW + halfW / 2, 20);

      // Quality delta
      const delta = r2.strokeData.quality - r1.strokeData.quality;
      const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
      const deltaColor = delta > 0 ? '#32D74B' : delta < 0 ? '#FF3B30' : 'rgba(255,255,255,0.5)';
      ctx.fillStyle = deltaColor;
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.fillText(`Δ ${deltaStr}`, w / 2, h - 12);

      // Progress
      const progress = maxFrames > 1 ? frameIdx / (maxFrames - 1) : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, h - 4, w, 4);
      ctx.fillStyle = '#A0F0FF';
      ctx.fillRect(0, h - 4, w * progress, 4);

      frameIdx++;
      if (frameIdx >= maxFrames) {
        if (this.looping) {
          frameIdx = 0;
        } else {
          this.stopPlayback();
          return;
        }
      }
    };

    drawFrame();
    this.playbackInterval = setInterval(drawFrame, frameInterval);
  }

  /**
   * Draw a replay frame scaled to a sub-region of the canvas.
   */
  drawHalfFrame(ctx, replay, frameIndex, ox, oy, regionW, regionH) {
    const frame = replay.frames[frameIndex];
    if (!frame) return;

    const lm = frame.landmarks;
    const phaseColors = {
      preparation:   'rgba(60, 130, 246, 0.6)',
      loading:       'rgba(250, 204, 21, 0.6)',
      acceleration:  'rgba(249, 115, 22, 0.6)',
      contact:       'rgba(255, 59, 48, 0.6)',
      followThrough: 'rgba(50, 215, 75, 0.6)',
      unknown:       'rgba(0, 255, 255, 0.6)'
    };

    const color = phaseColors[frame.phase] || phaseColors.unknown;

    // Skeleton
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    for (const [a, b] of this.connections) {
      if (lm[a] && lm[b] && lm[a].visibility > 0.3 && lm[b].visibility > 0.3) {
        ctx.beginPath();
        ctx.moveTo(ox + lm[a].x * regionW, oy + lm[a].y * regionH);
        ctx.lineTo(ox + lm[b].x * regionW, oy + lm[b].y * regionH);
        ctx.stroke();
      }
    }

    // Joints
    for (const pt of lm) {
      if (!pt || pt.visibility < 0.3) continue;
      ctx.beginPath();
      ctx.arc(ox + pt.x * regionW, oy + pt.y * regionH, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}
