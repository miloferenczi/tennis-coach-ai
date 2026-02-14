/**
 * InsightMiner - Discovers patterns and insights from stroke data
 *
 * Pattern types:
 * 1. Common denominators in top strokes (shared traits)
 * 2. Deterioration patterns (sliding window quality regression)
 * 3. Stroke matchups (quality after specific conditions)
 * 4. Cross-session breakthroughs (statistically significant improvements)
 * 5. Hidden strengths (metrics above expected for skill level)
 *
 * Each insight: { type, significance, headline, detail, evidence, actionable }
 */
class InsightMiner {
  constructor() {
    this.minStrokesForInsights = 8;
  }

  /**
   * Mine patterns from session strokes and optional cross-session data.
   * @param {Array} strokes - current session stroke records (from sessionStorage)
   * @param {Object} crossSessionData - from improvementTracker (optional)
   * @returns {Array} top 3 insights ranked by significance
   */
  minePatterns(strokes, crossSessionData) {
    if (!strokes || strokes.length < this.minStrokesForInsights) return [];

    const insights = [];

    // 1. Common denominators in top 20% strokes
    const topInsight = this.findCommonDenominators(strokes);
    if (topInsight) insights.push(topInsight);

    // 2. Deterioration patterns
    const deterInsight = this.findDeteriorationPatterns(strokes);
    if (deterInsight) insights.push(deterInsight);

    // 3. Stroke matchups (serve vs rally quality, etc.)
    const matchupInsight = this.findStrokeMatchups(strokes);
    if (matchupInsight) insights.push(matchupInsight);

    // 4. Cross-session breakthroughs
    if (crossSessionData) {
      const breakthrough = this.findBreakthroughs(crossSessionData);
      if (breakthrough) insights.push(breakthrough);
    }

    // 5. Hidden strengths
    const hiddenStrength = this.findHiddenStrengths(strokes, crossSessionData);
    if (hiddenStrength) insights.push(hiddenStrength);

    // 6. Rally position patterns
    const rallyPattern = this.findRallyPositionPatterns(strokes);
    if (rallyPattern) insights.push(rallyPattern);

    // Sort by significance and return top 3
    insights.sort((a, b) => b.significance - a.significance);
    return insights.slice(0, 3);
  }

  /**
   * 1. Find common traits in top 20% of strokes.
   */
  findCommonDenominators(strokes) {
    const sorted = [...strokes].sort((a, b) => b.quality - a.quality);
    const topCount = Math.max(3, Math.floor(strokes.length * 0.2));
    const topStrokes = sorted.slice(0, topCount);
    const bottomStrokes = sorted.slice(-topCount);

    // Compare averages between top and bottom
    const traits = {};
    const metrics = [
      { key: 'technique.hipShoulderSeparation', label: 'hip-shoulder separation' },
      { key: 'technique.elbowAngleAtContact', label: 'elbow extension' },
      { key: 'physics.rotation', label: 'body rotation', abs: true },
      { key: 'physics.smoothness', label: 'swing smoothness' }
    ];

    for (const metric of metrics) {
      const topAvg = this.avgMetric(topStrokes, metric.key, metric.abs);
      const botAvg = this.avgMetric(bottomStrokes, metric.key, metric.abs);

      if (topAvg !== null && botAvg !== null && topAvg > 0) {
        const diff = ((topAvg - botAvg) / Math.max(topAvg, 1)) * 100;
        if (diff > 15) {
          traits[metric.label] = { topAvg, botAvg, diff: Math.round(diff) };
        }
      }
    }

    const traitKeys = Object.keys(traits);
    if (traitKeys.length === 0) return null;

    const topTrait = traitKeys.sort((a, b) => traits[b].diff - traits[a].diff)[0];
    const t = traits[topTrait];

    return {
      type: 'common_denominator',
      significance: Math.min(100, t.diff * 1.5),
      headline: `Your best strokes have ${t.diff}% more ${topTrait}`,
      detail: `Top strokes average ${Math.round(t.topAvg)} vs ${Math.round(t.botAvg)} for weaker ones.`,
      evidence: { metric: topTrait, topAvg: t.topAvg, bottomAvg: t.botAvg },
      actionable: `Focus on ${topTrait} — it's the biggest differentiator in your game.`
    };
  }

  /**
   * 2. Detect quality deterioration patterns over the session.
   */
  findDeteriorationPatterns(strokes) {
    if (strokes.length < 12) return null;

    // Sliding window: compare quality in 5-stroke windows
    const windowSize = 5;
    const windows = [];
    for (let i = 0; i <= strokes.length - windowSize; i++) {
      const windowStrokes = strokes.slice(i, i + windowSize);
      const avgQ = windowStrokes.reduce((s, st) => s + st.quality, 0) / windowSize;
      windows.push({ start: i, avgQ });
    }

    // Find the biggest drop
    let maxDrop = 0;
    let dropStart = 0;
    let dropEnd = 0;
    for (let i = 1; i < windows.length; i++) {
      const drop = windows[i - 1].avgQ - windows[i].avgQ;
      if (drop > maxDrop) {
        maxDrop = drop;
        dropStart = windows[i - 1].start;
        dropEnd = windows[i].start + windowSize;
      }
    }

    if (maxDrop < 8) return null;

    // What metric dropped the most during that window?
    const beforeStrokes = strokes.slice(Math.max(0, dropStart - windowSize), dropStart);
    const duringStrokes = strokes.slice(dropStart, dropEnd);

    const metricChanges = [
      { key: 'physics.smoothness', label: 'smoothness' },
      { key: 'technique.hipShoulderSeparation', label: 'rotation' },
      { key: 'physics.velocity', label: 'racket speed' }
    ];

    let biggestMetricDrop = null;
    let biggestMetricDropValue = 0;

    for (const m of metricChanges) {
      const beforeAvg = this.avgMetric(beforeStrokes, m.key) || 0;
      const duringAvg = this.avgMetric(duringStrokes, m.key) || 0;
      const drop = beforeAvg - duringAvg;
      if (drop > biggestMetricDropValue && beforeAvg > 0) {
        biggestMetricDropValue = drop;
        biggestMetricDrop = m.label;
      }
    }

    return {
      type: 'deterioration',
      significance: Math.min(90, maxDrop * 3),
      headline: `Quality dropped ${Math.round(maxDrop)} points around stroke ${dropStart + windowSize}`,
      detail: biggestMetricDrop
        ? `${biggestMetricDrop} declined the most during that stretch.`
        : `Multiple metrics declined together.`,
      evidence: { maxDrop: Math.round(maxDrop), strokeRange: [dropStart, dropEnd] },
      actionable: biggestMetricDrop
        ? `When quality dips, check your ${biggestMetricDrop} first — it's your early warning sign.`
        : `Take a brief reset when you feel quality slipping.`
    };
  }

  /**
   * 3. Compare quality between stroke types or rally contexts.
   */
  findStrokeMatchups(strokes) {
    // Group by stroke type
    const byType = {};
    for (const s of strokes) {
      const type = s.type || 'unknown';
      if (!byType[type]) byType[type] = [];
      byType[type].push(s);
    }

    const types = Object.keys(byType).filter(t => byType[t].length >= 3);
    if (types.length < 2) return null;

    // Find biggest quality gap between stroke types
    let maxGap = 0;
    let bestType = null;
    let worstType = null;

    for (let i = 0; i < types.length; i++) {
      for (let j = i + 1; j < types.length; j++) {
        const avgA = byType[types[i]].reduce((s, st) => s + st.quality, 0) / byType[types[i]].length;
        const avgB = byType[types[j]].reduce((s, st) => s + st.quality, 0) / byType[types[j]].length;
        const gap = Math.abs(avgA - avgB);
        if (gap > maxGap) {
          maxGap = gap;
          bestType = avgA > avgB ? types[i] : types[j];
          worstType = avgA > avgB ? types[j] : types[i];
        }
      }
    }

    if (maxGap < 8) return null;

    const bestAvg = Math.round(byType[bestType].reduce((s, st) => s + st.quality, 0) / byType[bestType].length);
    const worstAvg = Math.round(byType[worstType].reduce((s, st) => s + st.quality, 0) / byType[worstType].length);

    return {
      type: 'stroke_matchup',
      significance: Math.min(85, maxGap * 2),
      headline: `Your ${bestType} (${bestAvg}) outperforms your ${worstType} (${worstAvg}) by ${Math.round(maxGap)} points`,
      detail: `${byType[bestType].length} ${bestType}s vs ${byType[worstType].length} ${worstType}s this session.`,
      evidence: { bestType, worstType, gap: Math.round(maxGap), bestAvg, worstAvg },
      actionable: `Spend extra time on your ${worstType} — bringing it up to your ${bestType} level would transform your game.`
    };
  }

  /**
   * 4. Find cross-session breakthroughs.
   */
  findBreakthroughs(crossSessionData) {
    if (!crossSessionData || !crossSessionData.data) return null;

    const metrics = crossSessionData.data.strokeMetrics;
    if (!metrics) return null;

    let bestBreakthrough = null;
    let bestSignificance = 0;

    for (const [strokeType, sessions] of Object.entries(metrics)) {
      if (!sessions || sessions.length < 2) continue;

      const recent = sessions[sessions.length - 1];
      const prev = sessions[sessions.length - 2];

      // Check quality improvement
      if (recent.avgQuality && prev.avgQuality) {
        const improvement = recent.avgQuality - prev.avgQuality;
        if (improvement > 5 && improvement > bestSignificance) {
          bestSignificance = improvement;
          bestBreakthrough = {
            type: 'breakthrough',
            significance: Math.min(95, improvement * 3),
            headline: `${strokeType} quality jumped ${Math.round(improvement)} points since last session`,
            detail: `From ${Math.round(prev.avgQuality)} to ${Math.round(recent.avgQuality)}.`,
            evidence: { strokeType, prev: prev.avgQuality, recent: recent.avgQuality },
            actionable: `Your ${strokeType} is on an upward trend — keep doing what you're doing!`
          };
        }
      }
    }

    return bestBreakthrough;
  }

  /**
   * 5. Find metrics that are surprisingly good for the player's level.
   */
  findHiddenStrengths(strokes, crossSessionData) {
    if (strokes.length < 5) return null;

    // Simple: find any metric that's consistently high
    const smoothnessVals = strokes.map(s => s.physics?.smoothness).filter(v => v != null);
    const rotationVals = strokes.map(s => Math.abs(s.physics?.rotation || 0)).filter(v => v > 0);
    const hipSepVals = strokes.map(s => s.technique?.hipShoulderSeparation).filter(v => v != null);

    const strengths = [];

    if (smoothnessVals.length >= 3) {
      const avg = smoothnessVals.reduce((a, b) => a + b, 0) / smoothnessVals.length;
      if (avg > 75) strengths.push({ metric: 'Swing smoothness', value: Math.round(avg), threshold: 75 });
    }
    if (rotationVals.length >= 3) {
      const avg = rotationVals.reduce((a, b) => a + b, 0) / rotationVals.length;
      if (avg > 30) strengths.push({ metric: 'Body rotation', value: Math.round(avg), threshold: 30 });
    }
    if (hipSepVals.length >= 3) {
      const avg = hipSepVals.reduce((a, b) => a + b, 0) / hipSepVals.length;
      if (avg > 30) strengths.push({ metric: 'Hip-shoulder separation', value: Math.round(avg), threshold: 30 });
    }

    if (strengths.length === 0) return null;

    const best = strengths.sort((a, b) => (b.value / b.threshold) - (a.value / a.threshold))[0];

    return {
      type: 'hidden_strength',
      significance: Math.min(70, ((best.value / best.threshold) - 1) * 100),
      headline: `${best.metric} is a standout at ${best.value}`,
      detail: `Consistently above the ${best.threshold} threshold — this is a real strength.`,
      evidence: { metric: best.metric, value: best.value },
      actionable: `Your ${best.metric.toLowerCase()} is solid. Build your other mechanics around this strength.`
    };
  }

  /**
   * Get the top insight formatted for GPT to speak at session end.
   */
  formatTopInsightForGPT(insights) {
    if (!insights || insights.length === 0) return '';

    const top = insights[0];
    return `SESSION INSIGHT: ${top.headline}. ${top.detail} ${top.actionable}`;
  }

  /**
   * Format insights for the session summary modal.
   */
  formatForSessionSummary(insights) {
    if (!insights || insights.length === 0) return null;

    return insights.map(i => ({
      type: i.type,
      headline: i.headline,
      detail: i.detail,
      actionable: i.actionable,
      significance: i.significance
    }));
  }

  /**
   * 6. Find quality correlation with rally stroke position.
   * e.g. "After the 3rd rally stroke, forehand quality drops 15pts"
   * @param {Array} strokes - session strokes with rallyContext
   * @returns {Object|null} insight
   */
  findRallyPositionPatterns(strokes) {
    if (!strokes || strokes.length < 10) return null;

    // Group strokes by their position within a rally
    const byPosition = {};
    for (const s of strokes) {
      const pos = s.rallyContext?.strokeInRally || s.rally_context?.strokeInRally;
      if (pos == null || pos < 1) continue;
      const bucket = pos <= 2 ? 'early (1-2)' : pos <= 4 ? 'mid (3-4)' : 'late (5+)';
      if (!byPosition[bucket]) byPosition[bucket] = [];
      byPosition[bucket].push(s);
    }

    const buckets = Object.keys(byPosition);
    if (buckets.length < 2) return null;

    // Compare average quality across rally positions
    const avgByBucket = {};
    for (const [bucket, bStrokes] of Object.entries(byPosition)) {
      if (bStrokes.length < 3) continue;
      avgByBucket[bucket] = +(bStrokes.reduce((a, s) => a + (s.quality || 0), 0) / bStrokes.length).toFixed(1);
    }

    const positions = Object.keys(avgByBucket);
    if (positions.length < 2) return null;

    // Find biggest drop from early to late
    const earlyAvg = avgByBucket['early (1-2)'];
    const lateAvg = avgByBucket['late (5+)'];
    const midAvg = avgByBucket['mid (3-4)'];

    let drop = 0;
    let dropFrom = '';
    let dropTo = '';

    if (earlyAvg != null && lateAvg != null && (earlyAvg - lateAvg) > drop) {
      drop = earlyAvg - lateAvg;
      dropFrom = 'early';
      dropTo = 'late';
    }
    if (earlyAvg != null && midAvg != null && (earlyAvg - midAvg) > drop) {
      drop = earlyAvg - midAvg;
      dropFrom = 'early';
      dropTo = 'mid';
    }

    if (drop < 8) return null;

    return {
      type: 'rally_position',
      significance: Math.min(85, drop * 2.5),
      headline: `Quality drops ${Math.round(drop)} points from ${dropFrom} to ${dropTo} rally strokes`,
      detail: `Early rally avg: ${earlyAvg}, ${dropTo} rally avg: ${dropTo === 'late' ? lateAvg : midAvg}. You may be lunging instead of recovering.`,
      evidence: { avgByBucket, drop: Math.round(drop) },
      actionable: `Focus on recovery between rally strokes — split step and reset your base before the next ball.`
    };
  }

  // --- Helpers ---

  /**
   * Average a nested metric from an array of stroke objects.
   * Supports dot-notation keys like 'technique.hipShoulderSeparation'.
   */
  avgMetric(strokes, key, useAbs) {
    const values = strokes.map(s => {
      const parts = key.split('.');
      let val = s;
      for (const p of parts) {
        if (val == null) return null;
        val = val[p];
      }
      if (val == null) return null;
      return useAbs ? Math.abs(val) : val;
    }).filter(v => v !== null);

    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
