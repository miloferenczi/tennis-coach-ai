/**
 * Coach's Notebook — Persistent LLM Memory Across Sessions
 * Stores GPT's free-text observations and session summaries in localStorage.
 * Fed back into future system prompts so the coach "remembers" the player.
 */
class CoachNotebook {
  constructor() {
    this.storageKey = 'ace_coach_notebook';
    this.maxEntries = 20;
    this._entries = null; // In-memory cache
  }

  _useSupabase() {
    return typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated();
  }

  /**
   * Initialize from Supabase (or localStorage fallback).
   * Call after auth is confirmed.
   */
  async init() {
    if (this._useSupabase()) {
      this._entries = await supabaseClient.getCoachNotebookEntries();
    } else {
      this._entries = this._loadFromLocalStorage();
    }
  }

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('CoachNotebook: failed to load entries', e);
      return [];
    }
  }

  getEntries() {
    if (this._entries !== null) return this._entries;
    // Sync fallback for callers that run before init
    return this._loadFromLocalStorage();
  }

  async saveEntry(entry) {
    if (this._useSupabase()) {
      await supabaseClient.addCoachNotebookEntry(entry);
      // Refresh cache
      this._entries = await supabaseClient.getCoachNotebookEntries();
    } else {
      try {
        const entries = this.getEntries();
        entries.push(entry);
        while (entries.length > this.maxEntries) {
          entries.shift();
        }
        localStorage.setItem(this.storageKey, JSON.stringify(entries));
        this._entries = entries;
      } catch (e) {
        console.error('CoachNotebook: failed to save entry', e);
      }
    }
  }

  /**
   * Returns context object for building greeting prompts
   */
  getPromptContext() {
    const entries = this.getEntries();
    if (entries.length === 0) return { totalSessions: 0, mostRecent: null };
    return {
      totalSessions: entries.length,
      mostRecent: entries[entries.length - 1],
      previous: entries.length > 1 ? entries[entries.length - 2] : null
    };
  }

  /**
   * Format notebook entries for injection into GPT system prompt.
   * Targets ~800-1000 chars: full text of most recent entry,
   * one-line summaries of entries 2 and 3, total session count.
   */
  formatForSystemPrompt() {
    const entries = this.getEntries();
    if (entries.length === 0) return '';

    let block = '\nCOACH\'S NOTEBOOK (your own notes from previous sessions):\n';
    block += `Total coached sessions: ${entries.length}\n`;

    // Most recent entry — full text
    const latest = entries[entries.length - 1];
    const daysAgo = Math.round((Date.now() - latest.date) / (1000 * 60 * 60 * 24));
    block += `\nMost recent session (${daysAgo === 0 ? 'today' : daysAgo + 'd ago'}):\n`;
    block += `"${latest.coachNotes}"\n`;

    // Second most recent — one-line summary
    if (entries.length >= 2) {
      const prev = entries[entries.length - 2];
      const prevDays = Math.round((Date.now() - prev.date) / (1000 * 60 * 60 * 24));
      const weakStr = prev.summary?.weaknesses?.join(', ') || 'none noted';
      block += `\nSession before that (${prevDays}d ago): avg ${prev.summary?.avgScore || '?'}, weaknesses: ${weakStr}\n`;
    }

    // Third most recent — one-line summary
    if (entries.length >= 3) {
      const older = entries[entries.length - 3];
      const olderDays = Math.round((Date.now() - older.date) / (1000 * 60 * 60 * 24));
      const weakStr = older.summary?.weaknesses?.join(', ') || 'none noted';
      block += `Earlier session (${olderDays}d ago): avg ${older.summary?.avgScore || '?'}, weaknesses: ${weakStr}\n`;
    }

    // Inject improvement tracker trends if available
    if (typeof improvementTracker !== 'undefined') {
      const trackerBlock = improvementTracker.formatForSystemPrompt();
      if (trackerBlock) block += trackerBlock;
    }

    block += '\nUse these notes to build continuity. Reference your own past observations and metric trends naturally.\n';
    return block;
  }

  clear() {
    localStorage.removeItem(this.storageKey);
  }
}

const coachNotebook = new CoachNotebook();
