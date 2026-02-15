/**
 * VideoAnalyzer - Full biomechanical analysis of uploaded videos
 * Uses EnhancedTennisAnalyzer + LandmarkFilter for the same pipeline as live sessions.
 */
class VideoAnalyzer {
  constructor() {
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.pose = null;
    this.isAnalyzing = false;
    this.analysisProgress = 0;
    this.detectedStrokes = [];
    this.frameData = [];
    this.fps = 30;
    this.duration = 0;
    this.analyzer = null;
    this.landmarkFilter = null;

    this._consecutiveErrors = 0;
    this._maxConsecutiveErrors = 10;
    this._pendingPoseResolve = null;
    this._lastPoseResult = null;
  }

  /**
   * Initialize MediaPipe Pose and the analysis pipeline
   */
  async initialize() {
    this.pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    this.pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: false,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.pose.onResults((results) => {
      this._lastPoseResult = results;
      if (this._pendingPoseResolve) {
        this._pendingPoseResolve(results);
        this._pendingPoseResolve = null;
      }
    });

    await this.pose.initialize();

    // Create analysis pipeline instances
    this.analyzer = new EnhancedTennisAnalyzer();
    if (typeof LandmarkFilter !== 'undefined') {
      this.landmarkFilter = new LandmarkFilter();
    }
  }

  /**
   * Load a video file and detect its real FPS
   */
  loadVideo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);

      this.video = document.createElement('video');
      this.video.src = url;
      this.video.muted = true;
      this.video.playsInline = true;

      this.video.onloadedmetadata = () => {
        this.duration = this.video.duration;

        // Detect actual FPS via captureStream if available
        try {
          if (this.video.captureStream) {
            const stream = this.video.captureStream();
            const track = stream.getVideoTracks()[0];
            if (track) {
              const settings = track.getSettings();
              if (settings.frameRate && settings.frameRate > 0) {
                this.fps = settings.frameRate;
              }
              track.stop();
            }
            stream.getTracks().forEach(t => t.stop());
          }
        } catch (e) {
          // Fallback: keep 30fps default
        }

        // Create analysis canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx = this.canvas.getContext('2d');

        resolve({
          duration: this.duration,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
          fps: Math.round(this.fps)
        });
      };

      this.video.onerror = () => {
        reject(new Error('Failed to load video'));
      };
    });
  }

  /**
   * Analyze the entire video using the full EnhancedTennisAnalyzer pipeline.
   * Strokes are collected via the analyzer's onStrokeCallback — same as live.
   */
  async analyzeVideo(onProgress, onFrame) {
    if (!this.video || !this.pose || !this.analyzer) {
      throw new Error('Video or analyzer not initialized');
    }

    this.isAnalyzing = true;
    this.detectedStrokes = [];
    this.frameData = [];
    this.analysisProgress = 0;
    this._consecutiveErrors = 0;

    // Hook into stroke detection
    this.analyzer.onStrokeCallback = (strokeData) => {
      this.detectedStrokes.push({
        ...strokeData,
        id: `stroke_${this.detectedStrokes.length}`,
        time: this.video.currentTime
      });
    };

    // Analyze every frame (fps-aware stepping)
    const frameInterval = 1 / this.fps;
    const totalFrames = Math.floor(this.duration * this.fps);

    for (let i = 0; i < totalFrames && this.isAnalyzing; i++) {
      const time = i * frameInterval;

      // Seek to frame with timeout
      try {
        await this.seekToTime(time);
      } catch (e) {
        this._consecutiveErrors++;
        if (this._consecutiveErrors >= this._maxConsecutiveErrors) {
          console.warn('VideoAnalyzer: too many seek errors, stopping analysis');
          break;
        }
        continue;
      }

      // Draw frame to canvas
      this.ctx.drawImage(this.video, 0, 0);

      // Send to MediaPipe and get landmarks
      try {
        const results = await this._sendFrame(this.canvas);
        this._consecutiveErrors = 0;

        if (results && results.poseLandmarks) {
          let landmarks = results.poseLandmarks;

          // Apply landmark filtering (body-relative normalization)
          const timestamp = time * 1000; // ms
          if (this.landmarkFilter) {
            landmarks = this.landmarkFilter.filterLandmarks(landmarks, timestamp);
          }
          this.analyzer.analyzePose(landmarks, timestamp);

          // Fire onFrame callback for live skeleton rendering
          if (onFrame) {
            onFrame(landmarks, time, this.detectedStrokes.length);
          }

          this.frameData.push({
            time,
            landmarks,
            frameIndex: i
          });
        }
      } catch (e) {
        this._consecutiveErrors++;
        if (this._consecutiveErrors >= this._maxConsecutiveErrors) {
          console.warn('VideoAnalyzer: too many frame errors, stopping analysis');
          break;
        }
      }

      // Update progress
      this.analysisProgress = ((i + 1) / totalFrames) * 100;
      if (onProgress) {
        onProgress(this.analysisProgress);
      }

      // Yield to UI thread every 10 frames
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.isAnalyzing = false;

    return {
      strokes: this.detectedStrokes,
      frameCount: this.frameData.length,
      duration: this.duration,
      fps: Math.round(this.fps)
    };
  }

  /**
   * Send a single frame to MediaPipe and return the results via promise
   */
  _sendFrame(canvas) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingPoseResolve = null;
        reject(new Error('Pose detection timeout'));
      }, 5000);

      this._pendingPoseResolve = (results) => {
        clearTimeout(timeout);
        resolve(results);
      };

      this.pose.send({ image: canvas }).catch((e) => {
        clearTimeout(timeout);
        this._pendingPoseResolve = null;
        reject(e);
      });
    });
  }

  /**
   * Seek video to specific time with 5s timeout
   */
  seekToTime(time) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.video.onseeked = null;
        reject(new Error('Seek timeout'));
      }, 5000);

      this.video.onseeked = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.video.currentTime = time;
    });
  }

  /**
   * Get frame at specific time
   */
  getFrameAtTime(time) {
    let closest = this.frameData[0];
    let minDiff = closest ? Math.abs(time - closest.time) : Infinity;

    for (const frame of this.frameData) {
      const diff = Math.abs(time - frame.time);
      if (diff < minDiff) {
        minDiff = diff;
        closest = frame;
      }
    }

    return closest;
  }

  /**
   * Get stroke at specific time (if any)
   */
  getStrokeAtTime(time, tolerance = 0.5) {
    for (const stroke of this.detectedStrokes) {
      if (Math.abs(stroke.time - time) <= tolerance) {
        return stroke;
      }
    }
    return null;
  }

  /**
   * Cancel ongoing analysis
   */
  cancelAnalysis() {
    this.isAnalyzing = false;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.cancelAnalysis();
    if (this.video) {
      URL.revokeObjectURL(this.video.src);
      this.video = null;
    }
    this.canvas = null;
    this.frameData = [];
    this.detectedStrokes = [];
    this.analyzer = null;
    this.landmarkFilter = null;
  }
}

// Global instance
const videoAnalyzer = new VideoAnalyzer();
