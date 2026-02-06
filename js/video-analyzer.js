/**
 * VideoAnalyzer - Handles video upload and frame-by-frame analysis
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
    this.currentFrameIndex = 0;
    this.fps = 30;
    this.duration = 0;

    // Analysis settings
    this.analysisInterval = 2; // Analyze every Nth frame for speed
  }

  /**
   * Initialize with MediaPipe pose
   */
  async initialize() {
    this.pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    this.pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: false, // Disable for video analysis
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    return new Promise((resolve) => {
      this.pose.onResults((results) => {
        this.onPoseResults(results);
      });
      // Initialize pose
      this.pose.initialize().then(resolve);
    });
  }

  /**
   * Load a video file for analysis
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
        this.fps = 30; // Assume 30fps

        // Create analysis canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx = this.canvas.getContext('2d');

        resolve({
          duration: this.duration,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
          fps: this.fps
        });
      };

      this.video.onerror = () => {
        reject(new Error('Failed to load video'));
      };
    });
  }

  /**
   * Analyze the entire video
   */
  async analyzeVideo(onProgress) {
    if (!this.video || !this.pose) {
      throw new Error('Video or pose not initialized');
    }

    this.isAnalyzing = true;
    this.detectedStrokes = [];
    this.frameData = [];
    this.analysisProgress = 0;

    const totalFrames = Math.floor(this.duration * this.fps);
    const framesToAnalyze = Math.floor(totalFrames / this.analysisInterval);

    // Create temporary analyzer for stroke detection
    const tempAnalyzer = new EnhancedTennisAnalyzer();

    for (let i = 0; i < framesToAnalyze && this.isAnalyzing; i++) {
      const frameIndex = i * this.analysisInterval;
      const time = frameIndex / this.fps;

      // Seek to frame
      await this.seekToTime(time);

      // Draw frame to canvas
      this.ctx.drawImage(this.video, 0, 0);

      // Analyze frame
      try {
        await this.pose.send({ image: this.canvas });
      } catch (e) {
        console.warn('Frame analysis failed:', e);
      }

      // Update progress
      this.analysisProgress = ((i + 1) / framesToAnalyze) * 100;
      if (onProgress) {
        onProgress(this.analysisProgress);
      }
    }

    // Process collected frame data for stroke detection
    this.detectStrokesFromFrameData(tempAnalyzer);

    this.isAnalyzing = false;
    return {
      strokes: this.detectedStrokes,
      frameCount: this.frameData.length,
      duration: this.duration
    };
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
   * Handle pose results from MediaPipe
   */
  onPoseResults(results) {
    if (results.poseLandmarks) {
      this.frameData.push({
        time: this.video.currentTime,
        landmarks: results.poseLandmarks,
        frameIndex: this.frameData.length
      });
    }
  }

  /**
   * Detect strokes from accumulated frame data
   */
  detectStrokesFromFrameData(analyzer) {
    // Calculate velocities between frames
    for (let i = 1; i < this.frameData.length; i++) {
      const prev = this.frameData[i - 1];
      const curr = this.frameData[i];
      const dt = curr.time - prev.time;

      if (dt <= 0) continue;

      // Calculate wrist velocity
      const prevWrist = prev.landmarks[16];
      const currWrist = curr.landmarks[16];

      const velocity = {
        x: (currWrist.x - prevWrist.x) / dt,
        y: (currWrist.y - prevWrist.y) / dt,
        magnitude: Math.sqrt(
          Math.pow((currWrist.x - prevWrist.x) / dt, 2) +
          Math.pow((currWrist.y - prevWrist.y) / dt, 2)
        )
      };

      curr.velocity = velocity;
    }

    // Find velocity peaks (potential strokes)
    const peakThreshold = 0.03;
    const minTimeBetweenStrokes = 1.0; // seconds
    let lastStrokeTime = -minTimeBetweenStrokes;

    for (let i = 5; i < this.frameData.length - 5; i++) {
      const frame = this.frameData[i];
      if (!frame.velocity) continue;

      const isLocalMax = this.isLocalMaximum(i, 5);
      const isAboveThreshold = frame.velocity.magnitude > peakThreshold;
      const hasEnoughTimePassed = frame.time - lastStrokeTime >= minTimeBetweenStrokes;

      if (isLocalMax && isAboveThreshold && hasEnoughTimePassed) {
        // Classify the stroke
        const strokeType = this.classifyStrokeFromFrame(frame);
        const quality = this.estimateQualityFromFrame(frame, i);

        this.detectedStrokes.push({
          id: `stroke_${this.detectedStrokes.length}`,
          time: frame.time,
          frameIndex: i,
          type: strokeType,
          quality: quality,
          velocity: frame.velocity.magnitude,
          landmarks: frame.landmarks
        });

        lastStrokeTime = frame.time;
      }
    }
  }

  /**
   * Check if frame at index is a local velocity maximum
   */
  isLocalMaximum(index, window) {
    const frame = this.frameData[index];
    if (!frame.velocity) return false;

    for (let i = index - window; i <= index + window; i++) {
      if (i === index || i < 0 || i >= this.frameData.length) continue;
      const other = this.frameData[i];
      if (other.velocity && other.velocity.magnitude > frame.velocity.magnitude) {
        return false;
      }
    }
    return true;
  }

  /**
   * Classify stroke type from frame data
   */
  classifyStrokeFromFrame(frame) {
    const landmarks = frame.landmarks;
    const rightWrist = landmarks[16];
    const leftWrist = landmarks[15];
    const rightShoulder = landmarks[12];
    const leftShoulder = landmarks[11];
    const nose = landmarks[0];

    // Check for serve (high contact point)
    if (rightWrist.y < nose.y - 0.1) {
      return 'serve';
    }

    // Determine forehand vs backhand based on arm position
    const shoulderMidX = (rightShoulder.x + leftShoulder.x) / 2;

    // Check swing direction based on wrist relative to body center
    if (rightWrist.x > shoulderMidX + 0.1) {
      return 'forehand';
    } else if (rightWrist.x < shoulderMidX - 0.1) {
      return 'backhand';
    }

    // Check for volley (close to body, minimal backswing)
    if (Math.abs(rightWrist.y - rightShoulder.y) < 0.15) {
      return 'volley';
    }

    return 'forehand';
  }

  /**
   * Estimate stroke quality from frame data
   */
  estimateQualityFromFrame(frame, frameIndex) {
    let score = 50;

    // Velocity bonus
    if (frame.velocity && frame.velocity.magnitude > 0.05) {
      score += 20;
    } else if (frame.velocity && frame.velocity.magnitude > 0.03) {
      score += 10;
    }

    // Elbow angle check
    const landmarks = frame.landmarks;
    const elbowAngle = this.calculateAngle(
      landmarks[16], landmarks[14], landmarks[12]
    );

    if (elbowAngle > 140 && elbowAngle < 170) {
      score += 15;
    } else if (elbowAngle > 120) {
      score += 8;
    }

    // Hip-shoulder separation
    const hipSepAngle = this.calculateHipShoulderSeparation(landmarks);
    if (hipSepAngle > 25) {
      score += 15;
    } else if (hipSepAngle > 15) {
      score += 8;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Calculate angle between three points
   */
  calculateAngle(p1, p2, p3) {
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) -
                    Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
  }

  /**
   * Calculate hip-shoulder separation
   */
  calculateHipShoulderSeparation(landmarks) {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const shoulderAngle = Math.atan2(
      rightShoulder.y - leftShoulder.y,
      rightShoulder.x - leftShoulder.x
    ) * 180 / Math.PI;

    const hipAngle = Math.atan2(
      rightHip.y - leftHip.y,
      rightHip.x - leftHip.x
    ) * 180 / Math.PI;

    return Math.abs(shoulderAngle - hipAngle);
  }

  /**
   * Get frame at specific time
   */
  getFrameAtTime(time) {
    let closest = this.frameData[0];
    let minDiff = Math.abs(time - closest?.time || Infinity);

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
  }
}

// Global instance
const videoAnalyzer = new VideoAnalyzer();
