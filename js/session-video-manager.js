/**
 * SessionVideoManager - Bookmarks stroke timestamps for session review
 *
 * Tracks best/worst/first/last strokes per type. Uses existing
 * landmark-based replays for review — stores metadata only.
 */
class SessionVideoManager {
  constructor() {
    this.bookmarks = [];      // All stroke bookmarks
    this.byType = {};         // { Forehand: { best, worst, first, last } }
    this.sessionBest = null;
    this.sessionWorst = null;
  }

  /**
   * Record a stroke bookmark.
   * @param {Object} strokeData - Stroke analysis results
   * @param {number} replayIndex - Index in StrokeReplayManager.replays
   */
  addBookmark(strokeData, replayIndex) {
    const quality = strokeData.quality?.overall ?? strokeData.quality ?? 0;
    const type = strokeData.type || 'Unknown';

    const bookmark = {
      type,
      quality,
      replayIndex,
      timestamp: Date.now(),
      strokeNumber: this.bookmarks.length + 1,
      faults: (strokeData.biomechanicalEvaluation?.detectedFaults || [])
        .map(f => f.id).slice(0, 3),
      serveScore: strokeData.serveAnalysis?.serveScore || null
    };

    this.bookmarks.push(bookmark);

    // Update per-type tracking
    if (!this.byType[type]) {
      this.byType[type] = { best: null, worst: null, first: null, last: null };
    }

    const t = this.byType[type];
    if (!t.first) t.first = bookmark;
    t.last = bookmark;
    if (!t.best || quality > t.best.quality) t.best = bookmark;
    if (!t.worst || quality < t.worst.quality) t.worst = bookmark;

    // Session-level best/worst
    if (!this.sessionBest || quality > this.sessionBest.quality) {
      this.sessionBest = bookmark;
    }
    if (!this.sessionWorst || quality < this.sessionWorst.quality) {
      this.sessionWorst = bookmark;
    }
  }

  /**
   * Attach Gemini visual analysis text to a bookmark.
   * Called when async visual analysis completes after stroke detection.
   */
  addVisualAnalysis(replayIndex, analysisText) {
    const bm = this.bookmarks.find(b => b.replayIndex === replayIndex);
    if (bm) bm.visualAnalysisText = analysisText;
  }

  /**
   * Get notable bookmarks for session summary display.
   * Returns up to 6 notable strokes (best, worst, best per type).
   */
  getNotableStrokes() {
    const notable = [];

    if (this.sessionBest) {
      notable.push({ ...this.sessionBest, label: 'Session Best' });
    }
    if (this.sessionWorst && this.bookmarks.length >= 5) {
      notable.push({ ...this.sessionWorst, label: 'Needs Work' });
    }

    // Best per type (skip if same as session best)
    for (const [type, data] of Object.entries(this.byType)) {
      if (data.best && data.best !== this.sessionBest) {
        notable.push({ ...data.best, label: `Best ${type}` });
      }
    }

    return notable.slice(0, 6);
  }

  /**
   * Get improvement within session: first vs last quality per type.
   */
  getWithinSessionProgress() {
    const progress = {};
    for (const [type, data] of Object.entries(this.byType)) {
      if (data.first && data.last && data.first !== data.last) {
        progress[type] = {
          firstQuality: data.first.quality,
          lastQuality: data.last.quality,
          delta: data.last.quality - data.first.quality,
          totalStrokes: this.bookmarks.filter(b => b.type === type).length
        };
      }
    }
    return progress;
  }

  /**
   * Format for session summary display.
   */
  formatForSummary() {
    if (this.bookmarks.length === 0) return '';

    let block = '';
    const progress = this.getWithinSessionProgress();

    for (const [type, data] of Object.entries(progress)) {
      const arrow = data.delta > 0 ? '↑' : data.delta < 0 ? '↓' : '→';
      block += `${type}: ${data.firstQuality} → ${data.lastQuality} (${arrow}${Math.abs(data.delta)}) over ${data.totalStrokes} strokes\n`;
    }

    return block;
  }

  /**
   * Format for GPT session notebook.
   */
  formatForNotebook() {
    if (this.bookmarks.length === 0) return '';

    let block = '\nSESSION STROKE BOOKMARKS:\n';
    if (this.sessionBest) {
      block += `- Best stroke: ${this.sessionBest.type} #${this.sessionBest.strokeNumber} (quality ${this.sessionBest.quality})\n`;
    }
    if (this.sessionWorst) {
      block += `- Weakest stroke: ${this.sessionWorst.type} #${this.sessionWorst.strokeNumber} (quality ${this.sessionWorst.quality})\n`;
    }

    const progress = this.getWithinSessionProgress();
    for (const [type, data] of Object.entries(progress)) {
      if (data.delta !== 0) {
        block += `- ${type} trend: ${data.firstQuality} → ${data.lastQuality} (${data.delta > 0 ? '+' : ''}${data.delta})\n`;
      }
    }

    return block;
  }

  /**
   * Reset all bookmarks.
   */
  reset() {
    this.bookmarks = [];
    this.byType = {};
    this.sessionBest = null;
    this.sessionWorst = null;
  }
}
