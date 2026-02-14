/**
 * MicroConfirmations — Non-intrusive player feedback collection
 *
 * After batch coaching, shows a floating thumbs-up/thumbs-down bubble.
 * Occasionally (~5%) asks "Was that a forehand?" for classification ground truth.
 * Saves to Supabase micro_confirmations table.
 */
class MicroConfirmations {
  constructor() {
    this._container = null;
    this._autoDismissTimer = null;
    this._strokeClassificationChance = 0.05; // 5% per stroke
    this._sessionId = null;
    this._pendingCoachingIssue = null;
    this._pendingCoachingCue = null;
    this._totalShown = 0;
    this._maxPerSession = 8; // Don't annoy the player
    this._strokeConfirmationsShown = 0;
    this._maxStrokeConfirmations = 3; // Max per session
  }

  /**
   * Set the current session ID for Supabase records.
   */
  setSessionId(sessionId) {
    this._sessionId = sessionId;
  }

  /**
   * Reset state for a new session.
   */
  resetSession() {
    this._totalShown = 0;
    this._strokeConfirmationsShown = 0;
    this._pendingCoachingIssue = null;
    this._pendingCoachingCue = null;
    this.dismiss();
  }

  /**
   * Called after batch coaching is delivered.
   * Queues a coaching quality confirmation to show after GPT speaks.
   * @param {Array} summaries - batch summaries with topIssue
   */
  onCoachingDelivered(summaries) {
    if (this._totalShown >= this._maxPerSession) return;

    // Find the top issue from summaries
    for (const s of summaries) {
      if (s.topIssue) {
        this._pendingCoachingIssue = s.topIssue.id || s.topIssue.name || null;
        this._pendingCoachingCue = s.topIssue.cue || null;
        // Show after a delay to let GPT finish speaking
        setTimeout(() => this._showCoachingFeedback(), 4000);
        return;
      }
    }
  }

  /**
   * Called on each stroke detection.
   * ~5% chance to show a stroke classification confirmation.
   * @param {Object} strokeData - detected stroke data
   */
  onStrokeDetected(strokeData) {
    if (!strokeData?.type) return;
    if (this._totalShown >= this._maxPerSession) return;
    if (this._strokeConfirmationsShown >= this._maxStrokeConfirmations) return;
    if (this._container) return; // Already showing something

    // Roll dice
    if (Math.random() > this._strokeClassificationChance) return;

    this._strokeConfirmationsShown++;
    this._showStrokeConfirmation(strokeData.type);
  }

  /**
   * Show thumbs-up/thumbs-down after coaching.
   */
  _showCoachingFeedback() {
    if (!this._pendingCoachingIssue) return;
    if (this._container) return; // Already showing

    const issueId = this._pendingCoachingIssue;
    this._pendingCoachingIssue = null;

    this._totalShown++;

    const container = this._createBubble();
    container.innerHTML = `
      <div class="mc-label">Helpful?</div>
      <div class="mc-buttons">
        <button class="mc-btn mc-up" aria-label="Thumbs up">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
        <button class="mc-btn mc-down" aria-label="Thumbs down">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
          </svg>
        </button>
      </div>
    `;

    const upBtn = container.querySelector('.mc-up');
    const downBtn = container.querySelector('.mc-down');

    upBtn.addEventListener('click', () => {
      this._submit({
        confirmationType: 'coaching_quality',
        coachingIssueId: issueId,
        playerRating: 5
      });
      this._flashAndDismiss(container, true);
    });

    downBtn.addEventListener('click', () => {
      this._submit({
        confirmationType: 'coaching_quality',
        coachingIssueId: issueId,
        playerRating: 1
      });
      this._flashAndDismiss(container, false);
    });

    document.body.appendChild(container);
    this._container = container;

    // Auto-dismiss after 8 seconds
    this._autoDismissTimer = setTimeout(() => this.dismiss(), 8000);
  }

  /**
   * Show stroke classification confirmation.
   * @param {string} detectedType - the auto-detected stroke type
   */
  _showStrokeConfirmation(detectedType) {
    this._totalShown++;

    const container = this._createBubble();
    const displayType = detectedType.charAt(0).toUpperCase() + detectedType.slice(1);

    // Build alternative options
    const alternatives = ['Forehand', 'Backhand', 'Serve', 'Volley']
      .filter(t => t.toLowerCase() !== detectedType.toLowerCase());

    container.innerHTML = `
      <div class="mc-label">${displayType}?</div>
      <div class="mc-buttons">
        <button class="mc-btn mc-confirm" aria-label="Confirm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
        ${alternatives.slice(0, 2).map(alt => `
          <button class="mc-btn mc-alt" data-type="${alt.toLowerCase()}" aria-label="${alt}">${alt.slice(0, 2)}</button>
        `).join('')}
      </div>
    `;

    const confirmBtn = container.querySelector('.mc-confirm');
    confirmBtn.addEventListener('click', () => {
      this._submit({
        confirmationType: 'stroke_classification',
        detectedStrokeType: detectedType,
        confirmedStrokeType: null // null = correct
      });
      this._flashAndDismiss(container, true);
    });

    container.querySelectorAll('.mc-alt').forEach(btn => {
      btn.addEventListener('click', () => {
        this._submit({
          confirmationType: 'stroke_classification',
          detectedStrokeType: detectedType,
          confirmedStrokeType: btn.dataset.type
        });
        this._flashAndDismiss(container, false);
      });
    });

    document.body.appendChild(container);
    this._container = container;

    // Auto-dismiss after 6 seconds (shorter for classification)
    this._autoDismissTimer = setTimeout(() => this.dismiss(), 6000);
  }

  /**
   * Create the floating bubble container element.
   */
  _createBubble() {
    const el = document.createElement('div');
    el.className = 'micro-confirmation-bubble';
    return el;
  }

  /**
   * Flash green/red and dismiss.
   */
  _flashAndDismiss(container, positive) {
    container.style.borderColor = positive ? 'rgba(0,255,120,0.8)' : 'rgba(255,80,80,0.8)';
    container.style.background = positive ? 'rgba(0,255,120,0.15)' : 'rgba(255,80,80,0.15)';
    setTimeout(() => this.dismiss(), 600);
  }

  /**
   * Dismiss the current bubble.
   */
  dismiss() {
    if (this._autoDismissTimer) {
      clearTimeout(this._autoDismissTimer);
      this._autoDismissTimer = null;
    }
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
  }

  /**
   * Submit a confirmation to Supabase.
   * @param {Object} confirmation
   */
  _submit(confirmation) {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated()) {
      const sessionId = this._sessionId || supabaseClient._currentSessionId || null;
      supabaseClient.saveMicroConfirmation({
        sessionId,
        ...confirmation
      }).catch(e => console.error('MicroConfirmations: save error', e));
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MicroConfirmations;
} else {
  window.MicroConfirmations = MicroConfirmations;
}
