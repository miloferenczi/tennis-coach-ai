/**
 * GhostOverlay - Shows a semi-transparent overlay of the user's best stroke
 * This helps users visualize and replicate good form.
 */
class GhostOverlay {
  constructor() {
    this.enabled = false;
    this.ghostStroke = null; // The reference stroke to show
    this.currentFrameIndex = 0;
    this.isPlaying = false;
    this.playbackSpeed = 1.0;
    this.opacity = 0.4;
    this.color = 'rgba(205, 255, 0, 0.5)'; // Volt green, semi-transparent

    // Best stroke tracking
    this.bestStrokeThisSession = null;
    this.bestScoreThisSession = 0;

    // Stroke recording
    this.isRecording = false;
    this.recordingBuffer = [];

    // Similarity calculation
    this.lastSimilarityScore = null;

    // Locked strokes (saved as references)
    this.LOCKED_STROKES_KEY = 'techniqueai_locked_ghosts';
    this.lockedStrokes = this.loadLockedStrokes();
  }

  /**
   * Enable/disable ghost overlay
   */
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /**
   * Set enabled state
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Check if ghost overlay is enabled
   */
  isEnabled() {
    return this.enabled && this.ghostStroke !== null;
  }

  /**
   * Record a frame (rolling buffer approach)
   * We continuously record and extract the stroke when detected
   */
  recordFrame(landmarks, timestamp) {
    this.recordingBuffer.push({
      landmarks: this.cloneLandmarks(landmarks),
      timestamp: timestamp || Date.now()
    });

    // Keep last 60 frames (2 seconds at 30fps) - enough for any stroke
    if (this.recordingBuffer.length > 60) {
      this.recordingBuffer.shift();
    }
  }

  /**
   * End recording and evaluate if this is the best stroke
   * Called when a stroke is detected - extracts the stroke from the buffer
   */
  endRecording(strokeType, qualityScore) {
    if (this.recordingBuffer.length < 10) {
      // Not enough frames to be a valid stroke
      return null;
    }

    // Extract the stroke from the buffer (last 45 frames captures the full motion)
    const strokeFrames = this.recordingBuffer.slice(-45);

    const stroke = {
      type: strokeType,
      quality: qualityScore,
      frames: strokeFrames,
      recordedAt: Date.now(),
      duration: strokeFrames.length > 0
        ? strokeFrames[strokeFrames.length - 1].timestamp - strokeFrames[0].timestamp
        : 0
    };

    // Check if this is the best stroke this session
    if (qualityScore > this.bestScoreThisSession) {
      this.bestScoreThisSession = qualityScore;
      this.bestStrokeThisSession = stroke;

      // Auto-set as ghost if none selected or if this is better
      if (!this.ghostStroke || qualityScore > this.ghostStroke.quality) {
        this.ghostStroke = stroke;
      }
    }

    return stroke;
  }

  /**
   * Set a specific stroke as the ghost reference
   */
  setGhostStroke(stroke) {
    this.ghostStroke = stroke;
    this.currentFrameIndex = 0;
  }

  /**
   * Use the best stroke from this session as ghost
   */
  useBestStroke() {
    if (this.bestStrokeThisSession) {
      this.ghostStroke = this.bestStrokeThisSession;
      this.currentFrameIndex = 0;
      return true;
    }
    return false;
  }

  /**
   * Lock a stroke as a saved reference
   */
  lockStroke(stroke, name = null) {
    const lockedStroke = {
      ...stroke,
      name: name || `${stroke.type} - ${Math.round(stroke.quality)}`,
      lockedAt: Date.now(),
      id: `ghost_${Date.now()}`
    };

    this.lockedStrokes.push(lockedStroke);
    this.saveLockedStrokes();
    return lockedStroke;
  }

  /**
   * Remove a locked stroke
   */
  unlockStroke(strokeId) {
    this.lockedStrokes = this.lockedStrokes.filter(s => s.id !== strokeId);
    this.saveLockedStrokes();
  }

  /**
   * Get all locked strokes
   */
  getLockedStrokes() {
    return [...this.lockedStrokes];
  }

  /**
   * Load a locked stroke as the ghost
   */
  loadLockedStroke(strokeId) {
    const stroke = this.lockedStrokes.find(s => s.id === strokeId);
    if (stroke) {
      this.ghostStroke = stroke;
      this.currentFrameIndex = 0;
      return true;
    }
    return false;
  }

  /**
   * Save locked strokes to localStorage
   */
  saveLockedStrokes() {
    try {
      // Limit stored data - only keep essential frame data
      const toSave = this.lockedStrokes.map(stroke => ({
        ...stroke,
        frames: stroke.frames.slice(0, 30) // Max 30 frames per ghost
      }));
      localStorage.setItem(this.LOCKED_STROKES_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save locked strokes:', e);
    }
  }

  /**
   * Load locked strokes from localStorage
   */
  loadLockedStrokes() {
    try {
      const data = localStorage.getItem(this.LOCKED_STROKES_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load locked strokes:', e);
      return [];
    }
  }

  /**
   * Draw the ghost overlay on canvas
   */
  draw(ctx, currentLandmarks = null) {
    if (!this.enabled || !this.ghostStroke || !this.ghostStroke.frames) return;

    const frames = this.ghostStroke.frames;
    if (frames.length === 0) return;

    // Get current ghost frame
    const ghostFrame = frames[this.currentFrameIndex];
    if (!ghostFrame || !ghostFrame.landmarks) return;

    // Save context state
    ctx.save();

    // Set ghost style
    ctx.globalAlpha = this.opacity;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = 3;

    // Add glow effect
    ctx.shadowColor = 'rgba(205, 255, 0, 0.6)';
    ctx.shadowBlur = 15;

    // Draw ghost skeleton
    this.drawSkeleton(ctx, ghostFrame.landmarks);

    // Calculate similarity if we have current landmarks
    if (currentLandmarks) {
      this.lastSimilarityScore = this.calculateSimilarity(currentLandmarks, ghostFrame.landmarks);
    }

    ctx.restore();

    // Advance frame (loop playback)
    if (this.isPlaying) {
      this.currentFrameIndex = (this.currentFrameIndex + 1) % frames.length;
    }
  }

  /**
   * Draw skeleton from landmarks
   */
  drawSkeleton(ctx, landmarks) {
    if (!landmarks || landmarks.length < 33) return;

    // Define connections (MediaPipe pose connections)
    const connections = [
      // Torso
      [11, 12], [11, 23], [12, 24], [23, 24],
      // Right arm
      [12, 14], [14, 16],
      // Left arm
      [11, 13], [13, 15],
      // Right leg
      [24, 26], [26, 28],
      // Left leg
      [23, 25], [25, 27],
      // Shoulders to hips
      [11, 23], [12, 24]
    ];

    // Draw connections
    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
        ctx.beginPath();
        ctx.moveTo(p1.x * ctx.canvas.width, p1.y * ctx.canvas.height);
        ctx.lineTo(p2.x * ctx.canvas.width, p2.y * ctx.canvas.height);
        ctx.stroke();
      }
    });

    // Draw key points
    const keyPoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    keyPoints.forEach(i => {
      const p = landmarks[i];
      if (p && p.visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  /**
   * Calculate similarity between current pose and ghost pose
   * Returns 0-100 score
   */
  calculateSimilarity(currentLandmarks, ghostLandmarks) {
    if (!currentLandmarks || !ghostLandmarks) return 0;

    // Key points to compare (upper body focus for strokes)
    const keyPoints = [11, 12, 13, 14, 15, 16]; // shoulders, elbows, wrists

    let totalDistance = 0;
    let validPoints = 0;

    keyPoints.forEach(i => {
      const current = currentLandmarks[i];
      const ghost = ghostLandmarks[i];

      if (current && ghost && current.visibility > 0.5 && ghost.visibility > 0.5) {
        const dx = current.x - ghost.x;
        const dy = current.y - ghost.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        totalDistance += distance;
        validPoints++;
      }
    });

    if (validPoints === 0) return 0;

    const avgDistance = totalDistance / validPoints;

    // Convert distance to similarity score
    // Distance of 0 = 100%, distance of 0.3 (30% of frame) = 0%
    const similarity = Math.max(0, Math.min(100, (1 - avgDistance / 0.3) * 100));

    return Math.round(similarity);
  }

  /**
   * Get the last calculated similarity score
   */
  getSimilarityScore() {
    return this.lastSimilarityScore;
  }

  /**
   * Start ghost playback
   */
  play() {
    this.isPlaying = true;
    this.currentFrameIndex = 0;
  }

  /**
   * Stop ghost playback
   */
  stop() {
    this.isPlaying = false;
  }

  /**
   * Pause ghost playback
   */
  pause() {
    this.isPlaying = false;
  }

  /**
   * Seek to specific frame
   */
  seekToFrame(frameIndex) {
    if (this.ghostStroke && this.ghostStroke.frames) {
      this.currentFrameIndex = Math.max(0, Math.min(frameIndex, this.ghostStroke.frames.length - 1));
    }
  }

  /**
   * Seek to percentage of stroke
   */
  seekToPercent(percent) {
    if (this.ghostStroke && this.ghostStroke.frames) {
      const frameIndex = Math.floor((percent / 100) * (this.ghostStroke.frames.length - 1));
      this.seekToFrame(frameIndex);
    }
  }

  /**
   * Set ghost opacity
   */
  setOpacity(opacity) {
    this.opacity = Math.max(0.1, Math.min(0.8, opacity));
  }

  /**
   * Clone landmarks array (deep copy)
   */
  cloneLandmarks(landmarks) {
    if (!landmarks) return null;
    return landmarks.map(l => ({
      x: l.x,
      y: l.y,
      z: l.z,
      visibility: l.visibility
    }));
  }

  /**
   * Get ghost info for display
   */
  getGhostInfo() {
    if (!this.ghostStroke) return null;

    return {
      type: this.ghostStroke.type,
      quality: this.ghostStroke.quality,
      name: this.ghostStroke.name || `${this.ghostStroke.type} (${Math.round(this.ghostStroke.quality)})`,
      frameCount: this.ghostStroke.frames?.length || 0,
      duration: this.ghostStroke.duration,
      isLocked: this.ghostStroke.id?.startsWith('ghost_')
    };
  }

  /**
   * Reset session (clear best stroke tracking)
   */
  resetSession() {
    this.bestStrokeThisSession = null;
    this.bestScoreThisSession = 0;
    this.recordingBuffer = [];
    this.isRecording = false;
    // Keep ghostStroke if user had one selected
  }

  /**
   * Clear ghost
   */
  clearGhost() {
    this.ghostStroke = null;
    this.currentFrameIndex = 0;
    this.lastSimilarityScore = null;
  }
}

// Global instance
const ghostOverlay = new GhostOverlay();
