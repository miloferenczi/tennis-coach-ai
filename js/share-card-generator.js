/**
 * ShareCardGenerator - Creates shareable session summary images
 *
 * Generates a 1080x1920 canvas-based image with:
 * - Session stats (avg score, total strokes, duration)
 * - Quality sparkline
 * - Hero insight
 * - ACE branding
 *
 * Uses Web Share API on mobile, download fallback on desktop.
 */
class ShareCardGenerator {
  constructor() {
    this.width = 1080;
    this.height = 1920;
  }

  /**
   * Generate a session card as a PNG Blob.
   * @param {Object} summary - session summary object
   * @param {Array} insights - from InsightMiner
   * @returns {Promise<Blob>}
   */
  async generate(summary, insights) {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, '#0A0A0A');
    bg.addColorStop(0.5, '#111111');
    bg.addColorStop(1, '#0A0A0A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    // Accent line at top
    const accentGrad = ctx.createLinearGradient(0, 0, this.width, 0);
    accentGrad.addColorStop(0, '#A0F0FF');
    accentGrad.addColorStop(1, '#6B8AFF');
    ctx.fillStyle = accentGrad;
    ctx.fillRect(0, 0, this.width, 6);

    let y = 100;

    // ACE logo/title
    ctx.fillStyle = '#A0F0FF';
    ctx.font = 'bold 72px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ACE', this.width / 2, y);
    y += 40;

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '28px -apple-system, system-ui, sans-serif';
    ctx.fillText('AI Tennis Coach', this.width / 2, y);
    y += 80;

    // Session date
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '24px -apple-system, system-ui, sans-serif';
    ctx.fillText(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), this.width / 2, y);
    y += 80;

    // Big score
    ctx.fillStyle = '#A0F0FF';
    ctx.font = 'bold 160px -apple-system, system-ui, sans-serif';
    ctx.fillText(`${summary.averageScore}`, this.width / 2, y + 100);
    y += 120;

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '32px -apple-system, system-ui, sans-serif';
    ctx.fillText('AVERAGE QUALITY', this.width / 2, y + 30);
    y += 100;

    // Stats row
    const stats = [
      { value: `${summary.totalStrokes}`, label: 'Strokes' },
      { value: `${summary.bestScore}`, label: 'Best' },
      { value: summary.consistency, label: 'Consistency' }
    ];

    const statWidth = this.width / stats.length;
    y += 40;
    for (let i = 0; i < stats.length; i++) {
      const cx = statWidth * i + statWidth / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 52px -apple-system, system-ui, sans-serif';
      ctx.fillText(stats[i].value, cx, y);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '22px -apple-system, system-ui, sans-serif';
      ctx.fillText(stats[i].label, cx, y + 36);
    }
    y += 100;

    // Sparkline
    if (summary.totalStrokes >= 5) {
      const currentSession = typeof sessionStorage !== 'undefined' ? sessionStorage.getCurrentSession() : null;
      const strokes = currentSession?.strokes;
      if (strokes && strokes.length >= 5) {
        const scores = strokes.map(s => s.quality);
        const sparkW = 800;
        const sparkH = 120;
        const sparkX = (this.width - sparkW) / 2;
        const sparkY = y;

        const maxS = Math.max(...scores, 100);
        const minS = Math.min(...scores, 0);
        const range = maxS - minS || 1;

        ctx.beginPath();
        for (let i = 0; i < scores.length; i++) {
          const px = sparkX + (i / (scores.length - 1)) * sparkW;
          const py = sparkY + sparkH - ((scores[i] - minS) / range) * sparkH;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = '#A0F0FF';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        y += sparkH + 40;
      }
    }

    // Hero insight
    if (insights && insights.length > 0) {
      y += 20;
      const insight = insights[0];

      // Background card
      ctx.fillStyle = 'rgba(107,138,255,0.1)';
      const cardX = 60;
      const cardW = this.width - 120;
      const cardH = 200;
      this.roundRect(ctx, cardX, y, cardW, cardH, 16);
      ctx.fill();

      ctx.fillStyle = '#6B8AFF';
      ctx.font = '18px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('SESSION INSIGHT', cardX + 24, y + 36);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 28px -apple-system, system-ui, sans-serif';
      this.wrapText(ctx, insight.headline, cardX + 24, y + 72, cardW - 48, 34);

      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '22px -apple-system, system-ui, sans-serif';
      this.wrapText(ctx, insight.actionable, cardX + 24, y + 140, cardW - 48, 28);

      y += cardH + 40;
    }

    // Trend
    y += 20;
    ctx.textAlign = 'center';
    const trendIcon = summary.improvement > 0 ? '↑' : summary.improvement < 0 ? '↓' : '→';
    const trendColor = summary.improvement > 0 ? '#32D74B' : summary.improvement < 0 ? '#FF3B30' : 'rgba(255,255,255,0.5)';
    ctx.fillStyle = trendColor;
    ctx.font = 'bold 36px -apple-system, system-ui, sans-serif';
    ctx.fillText(`${trendIcon} ${summary.improvement > 0 ? '+' : ''}${summary.improvement} points improvement`, this.width / 2, y);

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '20px -apple-system, system-ui, sans-serif';
    ctx.fillText('Analyzed with ACE AI Tennis Coach', this.width / 2, this.height - 60);

    // Convert to blob
    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png', 1.0);
    });
  }

  /**
   * Share the generated card via Web Share API or download.
   * @param {Object} summary
   * @param {Array} insights
   */
  async share(summary, insights) {
    try {
      const blob = await this.generate(summary, insights);

      if (navigator.share && navigator.canShare) {
        const file = new File([blob], 'ace-session.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'ACE Tennis Session',
            text: `Session: ${summary.averageScore} avg quality, ${summary.totalStrokes} strokes`,
            files: [file]
          });
          return;
        }
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ace-session-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (e) {
      console.error('ShareCardGenerator: share failed', e);
    }
  }

  // --- Helpers ---

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line + (line ? ' ' : '') + word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }
}
