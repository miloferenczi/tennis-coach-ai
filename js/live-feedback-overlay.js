/**
 * LiveFeedbackOverlay - Instant visual feedback on stroke detection
 *
 * Shows:
 * 1. Skeleton flash: green (>80) / yellow (60-80) / red (<60) for 400ms
 * 2. Floating score: rises from contact point, 1.5s duration
 * 3. Word label: "NICE!", "EARLY!", "ROTATE!" etc, centered, 1.5s
 */
class LiveFeedbackOverlay {
  constructor() {
    this.activeFlash = null;     // { color, alpha, startTime }
    this.floatingScore = null;   // { value, x, y, startTime }
    this.wordLabel = null;       // { text, color, startTime }
    this.animFrameId = null;

    // Timing constants
    this.flashDuration = 400;
    this.scoreDuration = 1500;
    this.labelDuration = 1500;
  }

  /**
   * Trigger all feedback animations for a detected stroke.
   * @param {number} quality - 0-100 quality score
   * @param {string} label - word label (auto-picked if null)
   * @param {{ x: number, y: number }} contactPoint - normalized 0-1 canvas coordinates
   * @param {Object} strokeData - full stroke data for label picking
   * @param {Object} recommendation - coaching recommendation for label picking
   */
  flashStroke(quality, label, contactPoint, strokeData, recommendation) {
    const now = Date.now();

    // 1. Skeleton flash color
    let flashColor;
    if (quality >= 80) {
      flashColor = { r: 50, g: 215, b: 75 };   // green
    } else if (quality >= 60) {
      flashColor = { r: 255, g: 200, b: 40 };   // yellow
    } else {
      flashColor = { r: 255, g: 59, b: 48 };    // red
    }
    this.activeFlash = { color: flashColor, startTime: now };

    // 2. Floating score
    const scoreX = contactPoint?.x ?? 0.5;
    const scoreY = contactPoint?.y ?? 0.4;
    this.floatingScore = {
      value: Math.round(quality),
      x: scoreX,
      y: scoreY,
      startTime: now
    };

    // 3. Word label
    const wordLabel = label || this.pickLabel(strokeData, recommendation);
    let labelColor;
    if (quality >= 80) {
      labelColor = '#32d74b';     // green
    } else if (quality >= 60) {
      labelColor = '#ffd60a';     // yellow
    } else {
      labelColor = '#ff3b30';     // red
    }
    this.wordLabel = { text: wordLabel, color: labelColor, startTime: now };
  }

  /**
   * Pick a short word label based on stroke data and coaching recommendation.
   */
  pickLabel(strokeData, recommendation) {
    if (!strokeData) return '';

    const quality = strokeData.quality?.overall ?? strokeData.quality ?? 0;

    // Positive labels for good strokes
    if (quality >= 85) {
      const positives = ['NICE!', 'SOLID!', 'GREAT!', 'CLEAN!'];
      return positives[Math.floor(Math.random() * positives.length)];
    }

    // Map top fault to a word label
    if (recommendation?.issue) {
      const faultMap = {
        'latePreparation':             'EARLY!',
        'insufficientRotation':        'ROTATE!',
        'poorWeightTransfer':          'STEP IN!',
        'lowRacquetSpeed':             'FASTER!',
        'collapsingElbowChickenWing':  'EXTEND!',
        'poorFollowThrough':           'FINISH!',
        'poorFootwork':                'FEET!',
        'inconsistentContactPoint':    'CONTACT!',
        'closedStanceLimitingPower':   'OPEN UP!',
        'poorServeTossArm':            'TOSS!',
        'noServeLegDrive':             'DRIVE!',
        'noServeTrophyPosition':       'TROPHY!',
        'lowServeContactPoint':        'REACH!',
        'racketFaceOpen':              'FACE!',
        'contactBehindBody':           'IN FRONT!',
        'wrongGrip':                   'GRIP!'
      };
      const word = faultMap[recommendation.issue.id];
      if (word) return word;
    }

    // Fallback based on quality
    if (quality >= 70) return 'GOOD';
    if (quality >= 50) return 'WORK IT';
    return 'FOCUS';
  }

  /**
   * Draw the overlay onto a canvas context.
   * Call this every frame from the main render loop.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  draw(ctx, canvasWidth, canvasHeight) {
    const now = Date.now();

    // 1. Skeleton flash (border glow)
    if (this.activeFlash) {
      const elapsed = now - this.activeFlash.startTime;
      if (elapsed < this.flashDuration) {
        const progress = elapsed / this.flashDuration;
        const alpha = Math.max(0, 0.4 * (1 - progress));
        const { r, g, b } = this.activeFlash.color;

        ctx.save();
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = 8;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 1.5})`;
        ctx.shadowBlur = 20;
        ctx.strokeRect(4, 4, canvasWidth - 8, canvasHeight - 8);
        ctx.restore();
      } else {
        this.activeFlash = null;
      }
    }

    // 2. Floating score
    if (this.floatingScore) {
      const elapsed = now - this.floatingScore.startTime;
      if (elapsed < this.scoreDuration) {
        const progress = elapsed / this.scoreDuration;
        const alpha = Math.max(0, 1 - progress * 0.8);
        const rise = progress * 60;  // pixels to rise

        const x = this.floatingScore.x * canvasWidth;
        const y = this.floatingScore.y * canvasHeight - rise;

        ctx.save();
        ctx.font = 'bold 36px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Outline
        ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
        ctx.lineWidth = 4;
        ctx.strokeText(this.floatingScore.value, x, y);
        // Fill
        const score = this.floatingScore.value;
        let fillColor;
        if (score >= 80) fillColor = `rgba(50, 215, 75, ${alpha})`;
        else if (score >= 60) fillColor = `rgba(255, 214, 10, ${alpha})`;
        else fillColor = `rgba(255, 59, 48, ${alpha})`;
        ctx.fillStyle = fillColor;
        ctx.fillText(this.floatingScore.value, x, y);
        ctx.restore();
      } else {
        this.floatingScore = null;
      }
    }

    // 3. Word label (centered)
    if (this.wordLabel) {
      const elapsed = now - this.wordLabel.startTime;
      if (elapsed < this.labelDuration) {
        const progress = elapsed / this.labelDuration;
        // Fade in for first 20%, hold, then fade out in last 40%
        let alpha;
        if (progress < 0.2) {
          alpha = progress / 0.2;
        } else if (progress > 0.6) {
          alpha = Math.max(0, 1 - (progress - 0.6) / 0.4);
        } else {
          alpha = 1;
        }
        // Scale: starts at 1.3, settles to 1.0
        const scale = 1.0 + 0.3 * Math.max(0, 1 - progress * 3);

        const cx = canvasWidth / 2;
        const cy = canvasHeight * 0.25;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.font = 'bold 48px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Shadow
        ctx.shadowColor = `rgba(0, 0, 0, ${alpha * 0.6})`;
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 2;
        // Outline
        ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.9})`;
        ctx.lineWidth = 5;
        ctx.strokeText(this.wordLabel.text, 0, 0);
        // Fill
        // Parse hex color to rgba
        const hex = this.wordLabel.color;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillText(this.wordLabel.text, 0, 0);
        ctx.restore();
      } else {
        this.wordLabel = null;
      }
    }
  }

  /**
   * Check if any animation is currently active.
   */
  isActive() {
    return !!(this.activeFlash || this.floatingScore || this.wordLabel);
  }

  /**
   * Reset all animations.
   */
  reset() {
    this.activeFlash = null;
    this.floatingScore = null;
    this.wordLabel = null;
  }
}
