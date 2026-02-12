/**
 * SpeechGate - Controls WHEN the coach should speak to avoid talking over rallies
 *
 * Rules:
 * - During rallying/serving: queue coaching, don't interrupt
 * - Between points: speak immediately, but keep it brief (1 sentence)
 * - Idle >15s: full coaching
 * - Can interrupt current GPT audio on new stroke detection
 * - Flushes queue when transitioning to between_points/idle
 */
class SpeechGate {
  constructor() {
    this.queue = [];                  // queued coaching contexts
    this.maxQueue = 3;                // max queued items (drop oldest)
    this.gameState = 'unknown';
    this.lastStrokeTime = 0;
    this.idleThreshold = 15000;       // 15 seconds of no strokes = idle
    this.onFlush = null;              // callback(queuedItems) when queue flushes
    this.onBatchFlush = null;          // callback() when batch should be delivered
  }

  /**
   * Update game state from scene analyzer.
   * Flushes queue when transitioning to a speakable state.
   */
  updateGameState(newState) {
    const oldState = this.gameState;
    this.gameState = newState;

    // Flush batch coaching then per-stroke queue when entering a speakable state
    if ((newState === 'between_points' || newState === 'idle') &&
        (oldState === 'rallying' || oldState === 'serving')) {
      this.flushBatch();
      this.flushQueue();
    }
  }

  /**
   * Determine whether the coach should speak right now.
   * @param {Object} coachingContext - the stroke coaching data
   * @returns {'speak_now' | 'queue' | 'suppress'}
   */
  shouldSpeak(coachingContext) {
    const now = Date.now();
    const timeSinceStroke = now - this.lastStrokeTime;

    // During active rallying or serving → queue (don't interrupt play)
    if (this.gameState === 'rallying' || this.gameState === 'serving') {
      return 'queue';
    }

    // Between points → speak, but GPT should be brief
    if (this.gameState === 'between_points') {
      return 'speak_now';
    }

    // Idle or unknown — speak freely
    return 'speak_now';
  }

  /**
   * Record a stroke event (for idle detection).
   * Also interrupts any in-flight GPT audio.
   */
  onStroke() {
    const now = Date.now();
    const gap = now - this.lastStrokeTime;
    this.lastStrokeTime = now;

    // Interrupt GPT audio when a new stroke arrives during speech
    if (typeof gptVoiceCoach !== 'undefined' && gptVoiceCoach.interruptSpeech) {
      gptVoiceCoach.interruptSpeech();
    }

    // If no SceneAnalyzer (gameState stays 'unknown'), use idle gap to trigger batch flush.
    // A gap > idleThreshold between strokes implies a natural break occurred.
    if (this.gameState === 'unknown' && gap > this.idleThreshold) {
      this.flushBatch();
    }
  }

  /**
   * Check if we're in a "brief" context (between points during active play).
   * GPT should keep responses to 1 sentence when this returns true.
   */
  shouldBeBrief() {
    return this.gameState === 'between_points';
  }

  /**
   * Add a coaching context to the queue.
   * @param {Object} coachingContext
   */
  enqueue(coachingContext) {
    this.queue.push({
      context: coachingContext,
      timestamp: Date.now()
    });

    // Drop oldest if over max
    if (this.queue.length > this.maxQueue) {
      this.queue.shift();
    }
  }

  /**
   * Flush batch coaching — notify accumulator to deliver ready batches.
   * Called before flushQueue on state transitions.
   */
  flushBatch() {
    if (this.onBatchFlush) {
      try {
        this.onBatchFlush();
      } catch (e) {
        console.error('SpeechGate: batch flush callback error', e);
      }
    }
  }

  /**
   * Flush the queue — send the most recent queued coaching to GPT.
   * Only sends the LAST item (most relevant), discards older ones.
   */
  flushQueue() {
    if (this.queue.length === 0) return;

    // Take only the most recent coaching context
    const mostRecent = this.queue[this.queue.length - 1];
    this.queue = [];

    if (this.onFlush && mostRecent) {
      try {
        this.onFlush(mostRecent.context);
      } catch (e) {
        console.error('SpeechGate: flush callback error', e);
      }
    }
  }

  /**
   * Get the brevity instruction to append to GPT prompts when between points.
   */
  getBrevityInstruction() {
    if (this.shouldBeBrief()) {
      return '\nBREVITY: Between points — keep your response to 1 sentence max (under 5 seconds). Most important cue only.\n';
    }
    return '';
  }

  /**
   * Reset state.
   */
  reset() {
    this.queue = [];
    this.gameState = 'unknown';
    this.lastStrokeTime = 0;
  }
}
