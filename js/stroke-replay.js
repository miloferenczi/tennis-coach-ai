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
        estimatedBallSpeed: strokeData.estimatedBallSpeed || null
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

    // Wrist swing trail (last 10 frames up to current)
    const trailStart = Math.max(0, frameIndex - 10);
    const isLefty = options.dominantHand === 'left';
    const wristIdx = isLefty ? 15 : 16;

    ctx.lineWidth = 2;
    for (let t = trailStart; t < frameIndex; t++) {
      const f1 = replay.frames[t];
      const f2 = replay.frames[t + 1];
      if (!f1 || !f2) continue;

      const p1 = f1.landmarks[wristIdx];
      const p2 = f2.landmarks[wristIdx];
      if (!p1 || !p2) continue;

      const alpha = 0.2 + 0.8 * ((t - trailStart) / (frameIndex - trailStart));
      const trailColor = phaseColors[f2.phase] || phaseColors.unknown;
      ctx.strokeStyle = trailColor.replace('1)', `${alpha})`);
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }

    // Text overlays
    ctx.font = 'bold 16px Inter, sans-serif';

    // Top-left: stroke type + quality
    ctx.fillStyle = '#F5F5F5';
    ctx.textAlign = 'left';
    const qualityColor = replay.strokeData.quality >= 80 ? '#32D74B'
      : replay.strokeData.quality >= 60 ? '#CDFF00' : '#FF3B30';
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
}
