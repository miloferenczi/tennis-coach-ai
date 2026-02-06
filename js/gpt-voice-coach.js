class GPTVoiceCoach {
  constructor() {
    this.apiKey = null;
    this.pc = null;
    this.dataChannel = null;
    this.audioElement = null;
    this.conversationHistory = [];
    this.isConnected = false;
    this.sessionId = null;
    this.sessionStartTime = null;
    this.fatigueDetected = false;
    this.lastQualityScores = [];
  }
  
  async initialize(apiKey) {
    this.apiKey = apiKey;
    
    this.audioElement = document.createElement("audio"); 
    this.audioElement.autoplay = true;

    try {
      const sessionConfig = {
        session: {
          type: "realtime",
          model: "gpt-4o-realtime-preview-2024-12-17",
          audio: {
            output: {
              voice: 'alloy'
            }
          }
        }
      };

      const tokenResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sessionConfig)
      });
      
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        console.error('Token creation failed:', errorData);
        throw new Error(`Token creation failed: ${tokenResponse.statusText}`);
      }
      
      const data = await tokenResponse.json();
      const ephemeralKey = data.value;

      await this.connectWebRTC(ephemeralKey);
      
      this.isConnected = true;
      this.sessionStartTime = Date.now();
      console.log('GPT Voice Coach connected via WebRTC');

      // Use player profile for personalized welcome
      let welcomeMessage = "Hey! I'm your elite tennis coach. Let's work on your technique today.";
      if (typeof playerProfile !== 'undefined') {
        welcomeMessage = playerProfile.generateWelcomeMessage();
        playerProfile.startSession();
      }
      this.speak(welcomeMessage);
      
    } catch (error) {
      console.error('Connection failed:', error);
      this.fallbackToSpeechSynthesis();
    }
  }
  
  getCoachingInstructions() {
    // Get player profile context if available
    let profileContext = '';
    if (typeof playerProfile !== 'undefined') {
      const ctx = playerProfile.getCoachingContext();
      if (ctx.isReturningPlayer) {
        profileContext = `
PLAYER CONTEXT:
- Returning player (${ctx.sessionsPlayed} sessions total)
- Current skill level: ${ctx.skillLevel}
- Days since last session: ${ctx.daysSinceLastSession || 'unknown'}
`;
        if (ctx.primaryWeaknesses.length > 0) {
          profileContext += `- Known weaknesses: ${ctx.primaryWeaknesses.map(w => w.name).join(', ')}\n`;
        }
        if (ctx.improvingAreas.length > 0) {
          profileContext += `- Improving areas: ${ctx.improvingAreas.join(', ')} (celebrate these!)\n`;
        }
        if (ctx.strongestStroke) {
          profileContext += `- Strongest stroke: ${ctx.strongestStroke.type} (avg ${ctx.strongestStroke.avgScore})\n`;
        }
        if (ctx.currentGoal) {
          profileContext += `- Today's goal: ${ctx.currentGoal.description}\n`;
        }
        if (ctx.lastSession) {
          profileContext += `- Last session: ${ctx.lastSession.avgScore} avg, weaknesses: ${(ctx.lastSession.weaknesses || []).join(', ') || 'none'}\n`;
        }
      }
    }

    return `You are an expert tennis coach with 20 years of experience coaching players from beginners to pros.
${profileContext}
Your coaching style:
- Direct, actionable feedback like a real courtside coach
- Encouraging but honest about areas to improve
- Use tennis terminology naturally (topspin, unit turn, contact point, kinetic chain, etc.)
- Keep responses under 15 seconds when speaking
- Reference specific metrics provided (percentiles, skill levels, pro comparisons)
- When faults are detected, address the highest-priority fault first
- Give ONE actionable cue per stroke - don't overwhelm
- Celebrate measurable improvements
- For returning players, reference their history ("last time we worked on..." or "you've been improving your...")
- When a player fixes a known weakness, celebrate it explicitly

ADAPTIVE COACHING:
- If player is fatigued (quality declining), be MORE encouraging and suggest simpler cues
- If player is on a hot streak, push them to maintain intensity
- Reference the session goal when relevant
- Celebrate when they fix previously identified weaknesses

When analyzing a stroke, focus on:
1. What they did well (always start positive)
2. The ONE most important fault to fix (if detected)
3. A simple, memorable cue to address it
4. Motivation based on their skill level and percentile

You receive comprehensive data including:
- Quality scores (0-100) with breakdown by phase
- Biomechanical analysis with detected faults and fixes
- Sequence analysis (preparation, loading, acceleration, contact, follow-through)
- Kinetic chain quality score
- Skill level (beginner/intermediate/advanced/professional)
- Percentile ranking (how they compare to other players)
- Professional comparison ratios
- Player history and cross-session context
- Fatigue indicators

IMPORTANT: When biomechanical faults are detected, they are prioritized by importance:
- Priority 10 = Foundation issues (must fix first)
- Priority 7-9 = Power issues
- Priority 4-6 = Refinement issues

Address the highest-priority detected fault. Use the specific "fix" cue provided.

Use this context to provide personalized, progressive coaching. Reference their journey toward elite standards.`;
  }
  
  async connectWebRTC(ephemeralKey) {
    return new Promise(async (resolve, reject) => {
      try {
        this.pc = new RTCPeerConnection();

        this.pc.ontrack = (e) => {
          this.audioElement.srcObject = e.streams[0];
        };

        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.pc.addTrack(ms.getTracks()[0]);

        this.dataChannel = this.pc.createDataChannel("oai-events");
        
        this.dataChannel.onmessage = (e) => {
          this.handleMessage(JSON.parse(e.data));
        };
        
        this.dataChannel.onopen = () => {
          console.log('WebRTC Data Channel ready');
          this.dataChannel.send(JSON.stringify({
            type: 'session.update',
            session: {
              instructions: this.getCoachingInstructions(),
              turn_detection: { type: 'server_vad' }
            }
          }));
          resolve();
        };
        
        this.dataChannel.onerror = (error) => {
          console.error('Data Channel error:', error);
          reject(error);
        };
        
        this.dataChannel.onclose = () => {
          console.log('Data Channel disconnected');
          this.isConnected = false;
        };

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        });

        if (!sdpResponse.ok) {
          const errorText = await sdpResponse.text();
          console.error('WebRTC SDP POST failed:', errorText);
          throw new Error(`Failed to establish WebRTC call: ${sdpResponse.statusText}`);
        }

        const answer = {
          type: "answer",
          sdp: await sdpResponse.text(),
        };
        await this.pc.setRemoteDescription(answer);
        
      } catch (error) {
        console.error('WebRTC connection failed:', error);
        reject(error);
      }
    });
  }
  
  handleMessage(message) {
    switch (message.type) {
      case 'response.audio.delta':
        break;
        
      case 'response.text.delta':
        break;
        
      case 'response.done':
        this.conversationHistory.push({
          role: 'assistant',
          content: message.response.output
        });
        if (message.response.output_text) {
          console.log('GPT response:', message.response.output_text);
        }
        break;
        
      case 'error':
        console.error('GPT error:', message.error);
        break;
    }
  }
  
  analyzeStroke(strokeData) {
    if (!this.isConnected || this.dataChannel.readyState !== 'open') {
      console.log('GPT not connected, using fallback');
      this.fallbackCoaching(strokeData);
      return;
    }
    
    const prompt = this.formatEnhancedStrokePrompt(strokeData);
    
    this.dataChannel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: prompt
        }]
      }
    }));
    
    this.dataChannel.send(JSON.stringify({
      type: 'response.create'
    }));
  }
  
  formatEnhancedStrokePrompt(data) {
    let prompt = `Stroke #${data.session.strokeCount}: ${data.strokeType}\n\n`;

    // Track quality for fatigue detection
    this.lastQualityScores.push(data.quality.overall);
    if (this.lastQualityScores.length > 15) {
      this.lastQualityScores.shift();
    }

    // Fatigue detection
    const fatigueInfo = this.detectFatigue();
    if (fatigueInfo.fatigued) {
      prompt += `FATIGUE DETECTED: Quality has dropped ${fatigueInfo.dropPercent}% over the last ${fatigueInfo.strokeWindow} strokes.\n`;
      prompt += `Coaching tone: Be more encouraging, suggest simpler cues, consider suggesting a short break.\n\n`;
    }

    // Cross-session context
    if (typeof playerProfile !== 'undefined') {
      const ctx = playerProfile.getCoachingContext();

      // Check if player fixed a known weakness
      if (ctx.primaryWeaknesses.length > 0) {
        const currentWeaknesses = data.biomechanical?.detectedFaults?.map(f => f.name) || [];
        for (const weakness of ctx.primaryWeaknesses) {
          if (weakness.improving || !currentWeaknesses.some(w => w.includes(weakness.name))) {
            prompt += `🎉 IMPROVEMENT: Player's ${weakness.name} has been improving! Celebrate this!\n\n`;
            break;
          }
        }
      }

      // Reference session goal
      if (ctx.currentGoal && ctx.currentGoal.target) {
        prompt += `📎 Session Goal: ${ctx.currentGoal.description}\n\n`;
      }

      // Last session reference (if within a week)
      if (ctx.lastSession && ctx.daysSinceLastSession && ctx.daysSinceLastSession < 7) {
        const ref = playerProfile.generateSessionReference();
        if (ref && ref.weaknesses && ref.weaknesses.length > 0) {
          prompt += `📝 Last session (${ref.timeRef}): Worked on ${ref.weaknesses.join(', ')}\n\n`;
        }
      }
    }

    
    // Check if we have orchestrator feedback
    if (data.orchestratorFeedback) {
      if (data.orchestratorFeedback.type === 'excellence') {
        // Excellence feedback - celebrate!
        prompt += `EXCELLENT EXECUTION\n`;
        prompt += `Trend: ${data.orchestratorFeedback.trend}\n\n`;
        prompt += `Keep it brief - celebrate this stroke and encourage maintaining this quality.\n`;
        return prompt;
      } else if (data.orchestratorFeedback.type === 'coaching') {
        // Structured coaching from decision tree
        const coaching = data.orchestratorFeedback;
        
        prompt += `COACHING FOCUS: ${coaching.issue.name}\n`;
        prompt += `Priority: ${coaching.issue.priority}/10 | Category: ${coaching.issue.category}\n`;
        prompt += `Impact: ${coaching.issue.impactLevel}\n\n`;
        
        // Root cause and symptoms
        prompt += `Root Cause: ${coaching.diagnosis.rootCause.replace(/_/g, ' ')}\n`;
        prompt += `Symptoms: ${coaching.diagnosis.symptoms.join(', ').replace(/_/g, ' ')}\n\n`;
        
        // THE KEY CUE (skill-level appropriate)
        prompt += `KEY CUE (${coaching.playerLevel} level):\n`;
        prompt += `"${coaching.cue}"\n\n`;
        
        // Key metrics showing the issue
        prompt += `Relevant Metrics:\n`;
        for (const [metric, value] of Object.entries(coaching.keyMetrics)) {
          if (value !== null) {
            prompt += `- ${metric}: ${typeof value === 'number' ? value.toFixed(2) : value}\n`;
          }
        }
        prompt += `\n`;
        
        // Expected improvement
        if (coaching.expectedImprovement) {
          prompt += `Expected Improvement:\n`;
          for (const [metric, change] of Object.entries(coaching.expectedImprovement)) {
            if (change.increase) prompt += `- ${metric}: +${change.increase}%\n`;
            if (change.decrease) prompt += `- ${metric}: -${change.decrease}\n`;
            if (change.improve) prompt += `- ${metric}: → ${change.improve}\n`;
          }
          prompt += `\n`;
        }
        
        // Critical situation handling
        if (coaching.criticalSituation) {
          prompt += `CRITICAL: ${coaching.criticalSituation.replace(/_/g, ' ')}\n`;
          if (coaching.consecutiveOccurrences >= 3) {
            prompt += `This issue has occurred ${coaching.consecutiveOccurrences} times in a row - emphasize importance!\n`;
          }
          prompt += `\n`;
        }
        
        prompt += `YOUR TASK: Deliver the coaching cue naturally in under 15 seconds. Reference the specific metrics. Be direct and actionable like a real coach.\n`;
        return prompt;
      }
    }
    
    // Fallback to legacy format if no orchestrator feedback
    // Lead with motivational metrics
    if (data.comparison) {
      prompt += `PLAYER LEVEL: ${data.comparison.skillLevel.toUpperCase()}\n`;
      prompt += `Percentile: ${data.comparison.percentile}th (better than ${data.comparison.percentile}% of players)\n`;
      prompt += `Pro Similarity: ${data.comparison.overallSimilarity}% match to professional form\n\n`;
    }
    
    // Quality assessment
    prompt += `Quality Score: ${data.quality.overall}/100\n`;
    prompt += `Performance Trend: ${data.quality.trend}\n`;
    if (data.quality.estimatedBallSpeed) {
      prompt += `Estimated Ball Speed: ${data.quality.estimatedBallSpeed} mph\n`;
    }
    prompt += `\n`;
    
    // Quality breakdown
    if (data.quality.breakdown) {
      prompt += `Quality Breakdown:\n`;
      prompt += `- Velocity: ${data.quality.breakdown.velocity.toFixed(0)}/100\n`;
      prompt += `- Acceleration: ${data.quality.breakdown.acceleration.toFixed(0)}/100\n`;
      prompt += `- Rotation: ${data.quality.breakdown.rotation.toFixed(0)}/100\n`;
      prompt += `- Smoothness: ${data.quality.breakdown.smoothness.toFixed(0)}/100\n\n`;
    }
    
    // Professional comparison details
    if (data.comparison) {
      prompt += `Comparison to Pro Standards:\n`;
      prompt += `- Racquet Speed: ${data.comparison.velocityRatio}% of pro average\n`;
      prompt += `- Acceleration: ${data.comparison.accelerationRatio}% of pro average\n`;
      prompt += `- Body Rotation: ${data.comparison.rotationRatio}% of pro average\n`;
      
      if (data.comparison.strengths.length > 0) {
        prompt += `\nSTRENGTHS: ${data.comparison.strengths.join(', ')}\n`;
      }
      
      if (data.comparison.improvements.length > 0) {
        prompt += `FOCUS AREAS: ${data.comparison.improvements.join(', ')}\n`;
      }
      prompt += `\n`;
    }
    
    // Technique details
    prompt += `Technique Specifics:\n`;
    prompt += `- Elbow Angle: ${data.technique.elbowAngleAtContact.toFixed(0)}°\n`;
    prompt += `- Hip-Shoulder Separation: ${data.technique.hipShoulderSeparation.toFixed(0)}°\n`;
    prompt += `- Knee Bend: ${data.technique.kneeBend.toFixed(0)}°\n`;
    prompt += `- Stance: ${data.technique.stance}\n`;
    prompt += `- Weight Transfer: ${data.technique.weightTransfer}\n\n`;

    // Biomechanical evaluation (if available)
    if (data.biomechanical) {
      prompt += `BIOMECHANICAL ANALYSIS:\n`;
      prompt += `Overall Biomechanical Score: ${data.biomechanical.overallScore}/100\n`;

      if (data.biomechanical.phaseScores) {
        prompt += `Phase Scores: `;
        const phases = Object.entries(data.biomechanical.phaseScores)
          .map(([phase, score]) => `${phase}: ${score}`)
          .join(', ');
        prompt += `${phases}\n`;
      }

      if (data.biomechanical.detectedFaults && data.biomechanical.detectedFaults.length > 0) {
        prompt += `\nDETECTED FAULTS (by priority):\n`;
        data.biomechanical.detectedFaults.forEach(fault => {
          prompt += `- ${fault.name}: ${fault.fix}\n`;
        });
      }

      if (data.biomechanical.primaryFeedback) {
        prompt += `\nPRIMARY FOCUS: ${data.biomechanical.primaryFeedback.message}\n`;
      }

      if (data.biomechanical.drillRecommendations && data.biomechanical.drillRecommendations.length > 0) {
        prompt += `\nRECOMMENDED DRILLS: ${data.biomechanical.drillRecommendations.slice(0, 2).join(', ')}\n`;
      }
      prompt += `\n`;
    }

    // Sequence analysis (if available)
    if (data.sequenceAnalysis) {
      prompt += `📐 SEQUENCE ANALYSIS:\n`;
      prompt += `Sequence Quality: ${data.sequenceAnalysis.sequenceQuality}/100\n`;
      prompt += `Kinetic Chain: ${data.sequenceAnalysis.kineticChainQuality}/100\n`;
      if (data.sequenceAnalysis.phaseDurations) {
        const durations = data.sequenceAnalysis.phaseDurations;
        prompt += `Phase Timing: prep=${durations.preparation}f, load=${durations.loading}f, accel=${durations.acceleration}f, follow=${durations.followThrough}f\n`;
      }
      prompt += `\n`;
    }

    // Session context
    prompt += `Session Stats:\n`;
    prompt += `- Total Strokes: ${data.session.strokeCount}\n`;
    prompt += `- Average Quality: ${data.session.averageScore.toFixed(0)}/100\n`;
    prompt += `- Consistency: ${data.session.consistency}\n`;

    prompt += `\nProvide personalized coaching in under 15 seconds. If biomechanical faults are detected, prioritize the highest-priority fault. Reference their percentile and skill level to motivate. Focus on closing the gap to the next level.`;

    return prompt;
  }
  
  speak(text) {
    if (this.isConnected && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'input_text',
            text: text
          }]
        }
      }));
      
      this.dataChannel.send(JSON.stringify({
        type: 'response.create'
      }));
    } else {
      this.fallbackSpeak(text);
    }
  }
  
  fallbackToSpeechSynthesis() {
    console.log('Using browser speech synthesis as fallback');
    this.useFallback = true;
  }
  
  fallbackSpeak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    utterance.voice = speechSynthesis.getVoices()
      .find(v => v.name.includes('Samantha') || v.lang === 'en-US');
    speechSynthesis.speak(utterance);
  }
  
  fallbackCoaching(strokeData) {
    const quality = strokeData.quality.overall;
    const comparison = strokeData.comparison;
    
    let feedback = '';
    
    // Use percentile if available
    if (comparison && comparison.percentile) {
      if (quality > 85) {
        feedback = `Excellent! That's ${comparison.percentile}th percentile play. You're at ${comparison.skillLevel} level!`;
      } else if (quality > 70) {
        const topImprovement = comparison.improvements[0] || "technique refinement";
        feedback = `Good stroke at the ${comparison.percentile}th percentile. Focus on: ${topImprovement}`;
      } else {
        feedback = `You're developing well. Work on the fundamentals to reach the next level.`;
      }
    } else {
      // Legacy fallback
      if (quality > 85) {
        feedback = "Excellent stroke! That's the technique we want.";
      } else if (quality > 70) {
        feedback = "Good effort. Keep refining that form.";
      } else {
        feedback = "Focus on fundamentals. Smooth acceleration through contact.";
      }
    }
    
    this.fallbackSpeak(feedback);
  }
  
  /**
   * Detect fatigue based on quality score decline
   */
  detectFatigue() {
    if (this.lastQualityScores.length < 10) {
      return { fatigued: false };
    }

    // Compare first half to second half of recent scores
    const midpoint = Math.floor(this.lastQualityScores.length / 2);
    const firstHalf = this.lastQualityScores.slice(0, midpoint);
    const secondHalf = this.lastQualityScores.slice(midpoint);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const dropPercent = ((firstAvg - secondAvg) / firstAvg) * 100;

    // Fatigue threshold: 15% drop
    if (dropPercent > 15) {
      this.fatigueDetected = true;

      // Record fatigue point for player profile
      if (typeof playerProfile !== 'undefined' && this.sessionStartTime) {
        const minutesIntoSession = (Date.now() - this.sessionStartTime) / (1000 * 60);
        playerProfile.recordFatiguePoint(minutesIntoSession);
      }

      return {
        fatigued: true,
        dropPercent: Math.round(dropPercent),
        strokeWindow: this.lastQualityScores.length,
        firstAvg: Math.round(firstAvg),
        secondAvg: Math.round(secondAvg)
      };
    }

    return { fatigued: false };
  }

  /**
   * Reset session state
   */
  resetSession() {
    this.lastQualityScores = [];
    this.fatigueDetected = false;
    this.sessionStartTime = Date.now();
  }

  disconnect() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
      this.dataChannel = null;
    }
    this.isConnected = false;
  }
}

const gptVoiceCoach = new GPTVoiceCoach();