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
    this.sessionTranscript = [];
    this.awaitingNotebook = false;
    this.notebookResolve = null;
    // Coach personality (set via initialize options)
    this.voice = 'alloy';
    this.coachName = 'Coach Alex';
    this.coachPersonality = '';
    // Free tier observation limit
    this.coachingObservationCount = 0;
    this.observationLimit = null; // null = unlimited
  }

  /**
   * Get coach personality configurations.
   * @returns {Object} map of coach key → { name, voice, personality, tagline, previewText }
   */
  static getCoachConfigs() {
    return {
      alex: {
        name: 'Coach Alex',
        voice: 'alloy',
        personality: 'You are encouraging and patient. You build confidence through positive reinforcement while gently guiding improvements. You celebrate small wins and keep the energy supportive.',
        tagline: 'Encouraging & patient',
        description: 'Great for building confidence',
        previewText: "Hey, nice to meet you! I'm Coach Alex. Let's work on your game together — I can already tell you've got great potential."
      },
      jordan: {
        name: 'Coach Jordan',
        voice: 'echo',
        personality: 'You are technical and precise. You focus on biomechanical details and give specific, measurable coaching cues. You are analytical but not cold — you show genuine investment in improvement.',
        tagline: 'Technical & precise',
        description: 'Focused on mechanics',
        previewText: "I'm Coach Jordan. I focus on the details that matter — angles, timing, kinetic chain. Let's break down your technique and build it back stronger."
      },
      sam: {
        name: 'Coach Sam',
        voice: 'shimmer',
        personality: 'You are high-energy and motivating. You push players harder while keeping it fun. You use competitive framing and challenge the player to beat their personal bests.',
        tagline: 'High-energy & motivating',
        description: 'Pushes you to your best',
        previewText: "What's up! I'm Coach Sam. Ready to level up? I'm going to push you — but trust me, you're going to love the results. Let's go!"
      }
    };
  }
  
  async initialize(apiKey, options = {}) {
    this.apiKey = apiKey;
    if (options.voice) this.voice = options.voice;
    if (options.coachName) this.coachName = options.coachName;
    if (options.coachPersonality) this.coachPersonality = options.coachPersonality;
    this.coachingObservationCount = 0;

    this.audioElement = document.createElement("audio");
    this.audioElement.autoplay = true;
    this.audioElement.playsInline = true;
    document.body.appendChild(this.audioElement);

    try {
      const coachInstructions = this.getCoachingInstructions();
      let ephemeralKey;

      // Try Supabase Edge Function first, fall back to direct API key
      if (typeof supabaseClient !== 'undefined' && supabaseClient.isAuthenticated()) {
        const tokenData = await supabaseClient.getRealtimeToken(coachInstructions, this.voice);
        if (!tokenData?.ephemeralKey) {
          throw new Error('Failed to get token via Edge Function');
        }
        ephemeralKey = tokenData.ephemeralKey;
      } else if (this.apiKey) {
        // Legacy: direct API key flow
        const sessionConfig = {
          session: {
            type: "realtime",
            model: "gpt-4o-realtime-preview",
            instructions: coachInstructions,
            modalities: ["text", "audio"],
            voice: this.voice,
            turn_detection: { type: "server_vad" }
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
        ephemeralKey = data.value;
      } else {
        throw new Error('No API key and not authenticated');
      }

      await this.connectWebRTC(ephemeralKey);

      this.isConnected = true;
      this.sessionStartTime = Date.now();
      console.log('GPT Voice Coach connected via WebRTC');

      // Start player profile session if available
      if (typeof playerProfile !== 'undefined') {
        playerProfile.startSession();
      }

      // Greeting is now sent from inside dataChannel.onopen handler
      // to avoid race condition where channel isn't ready yet

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

    // Get coach notebook context if available
    let notebookContext = '';
    if (typeof coachNotebook !== 'undefined') {
      notebookContext = coachNotebook.formatForSystemPrompt();
    }

    // Get improvement tracker context if available
    let trackerContext = '';
    let formTargetsBlock = '';
    if (typeof improvementTracker !== 'undefined') {
      trackerContext = improvementTracker.formatForSystemPrompt();
      // Get skill level for form targets
      let skillLevel = 'intermediate';
      if (typeof playerProfile !== 'undefined') {
        const ctx = playerProfile.getCoachingContext();
        if (ctx.skillLevel) skillLevel = ctx.skillLevel;
      }
      const targets = improvementTracker.getFormTargets(skillLevel);
      formTargetsBlock = `
FORM TARGETS FOR THIS PLAYER (${skillLevel} level):
- Body rotation: aim for >${targets.rotation}deg
- Hip-shoulder separation: aim for >${targets.hipSep}deg
- Elbow angle at contact: aim for >${targets.elbowAngle}deg
- Swing smoothness: aim for >${targets.smoothness}/100
`;
    }

    // Get curriculum context if available
    let curriculumContext = '';
    if (typeof tennisAI !== 'undefined' && tennisAI?.curriculumEngine?.isActive()) {
      curriculumContext = tennisAI.curriculumEngine.formatForSystemPrompt();
    }

    // Get rally context if available
    let rallyContext = '';
    if (typeof tennisAI !== 'undefined' && tennisAI?.rallyTracker) {
      rallyContext = tennisAI.rallyTracker.formatForCoachingPrompt();
    }

    return `You are ACE, an expert AI tennis coach with deep biomechanical knowledge. You are coaching a player in real time on a tennis court via their phone camera.
${profileContext}${notebookContext}
SCORING SYSTEM:
- Quality Score = 60% biomechanical form + 40% power (velocity + acceleration)
- Biomechanical form is phase-by-phase evaluation: preparation, loading, acceleration, follow-through
- Velocities are in body-relative units (torso-lengths/sec) -- camera-independent
- Power alone doesn't make a good stroke. Proper form generates power naturally.
${formTargetsBlock}${trackerContext}${curriculumContext}${rallyContext}
YOUR IDENTITY:
- You are ${this.coachName}, their personal tennis coach, not a generic AI assistant
- ${this.coachPersonality || 'You speak naturally like a real courtside coach - confident, direct, warm'}
- You remember what you've worked on together (use the player context and your notebook above)
- You have a coaching notebook with your own notes from past sessions — reference your observations naturally
- If the player tells you what they want to focus on, prioritize that for the session

COACHING STYLE:
- Use sandwich coaching: acknowledge a strength, give the correction, encourage
- Give ONE actionable cue per stroke - never overwhelm
- Keep responses under 15 seconds
- Use tennis terminology naturally (topspin, unit turn, contact point, kinetic chain)
- Celebrate measurable improvements explicitly
- For returning players, reference history ("last time we worked on..." or "your backhand is getting stronger")

ADAPTIVE BEHAVIOR:
- If player is fatigued (quality declining), be MORE encouraging and suggest simpler cues
- If player is on a hot streak, push them to maintain intensity
- If the player asks you a question or tells you what to focus on, respond conversationally and adjust your coaching
- Reference the session goal when relevant

STROKE ANALYSIS:
When you receive stroke data, respond with:
1. What they did well (start positive, reference a specific strength)
2. The ONE most important correction (highest-priority fault)
3. A simple, memorable cue they can use on the next stroke

DATA YOU RECEIVE:
- Quality scores (0-100) = 60% form + 40% power, with form details per stroke
- Biomechanical faults with priority (10 = foundation, 7-9 = power, 4-6 = refinement)
- Specific angles: hip-shoulder separation, elbow angle, body rotation
- Improvement plan progress: current vs target metrics per stroke type
- Skill level, percentile ranking, professional comparison
- Player history, fatigue indicators, shot outcomes

COACHING WITH METRICS:
- Reference specific angles and metrics when coaching ("your hip-shoulder separation was 22 degrees -- try to get that closer to 40")
- Track progress toward the improvement plan goals
- Celebrate measurable improvements with specific numbers ("your rotation improved from 14 to 18 degrees -- that's real progress")
- When giving form corrections, describe the body movement, not just the metric ("lead with your hip before your shoulders unwind")

IMPORTANT: Always stay in character as their tennis coach. Never break character or discuss being an AI.`
    + this.getDrillModeInstructions();
  }

  getDrillModeInstructions() {
    if (typeof drillMode === 'undefined' || !drillMode.isActive) return '';
    return `

DRILL MODE ACTIVE:
- The player is doing a focused drill. ALL coaching should be about the drill metric.
- Keep responses UNDER 8 seconds during drills — short, punchy, metric-focused.
- Celebrate reps that hit the target with energy.
- If they're close, give one micro-cue to get them over the line.
- Track trends across reps ("that's 3 in a row above target" or "you're trending up").
- Don't discuss other faults or broad technique — stay laser-focused on the drill metric.
- When the drill completes, give a brief 2-sentence summary of what you saw.`;
  }

  sendCoachGreeting() {
    if (!this.isConnected || this.dataChannel.readyState !== 'open') return;

    // Build context for greeting
    let greetingPrompt = 'Session starting now. Greet the player as their tennis coach (2-3 sentences). Be warm but professional. Ask what they want to work on today.';

    if (typeof playerProfile !== 'undefined') {
      const ctx = playerProfile.getCoachingContext();
      if (ctx.isReturningPlayer) {
        greetingPrompt = `Returning player session starting. They've done ${ctx.sessionsPlayed} sessions.`;
        if (ctx.daysSinceLastSession) {
          greetingPrompt += ` Last session was ${ctx.daysSinceLastSession} day(s) ago.`;
        }
        if (ctx.primaryWeaknesses?.length > 0) {
          greetingPrompt += ` Previously worked on: ${ctx.primaryWeaknesses.map(w => w.name).join(', ')}.`;
        }
        if (ctx.improvingAreas?.length > 0) {
          greetingPrompt += ` Improving: ${ctx.improvingAreas.join(', ')}.`;
        }
        greetingPrompt += '\n\nGreet them warmly, reference what you worked on last time, and ask what they want to focus on today. Keep it to 2-3 sentences.';
      }
    }

    // Inject coach's own notes from last session
    if (typeof coachNotebook !== 'undefined') {
      const ctx = coachNotebook.getPromptContext();
      if (ctx.mostRecent) {
        greetingPrompt += `\nYour notes from last session: "${ctx.mostRecent.coachNotes}"`;
        greetingPrompt += `\nReference something specific from your notes in the greeting.`;
      }
    }

    // Inject improvement plan context
    if (typeof improvementTracker !== 'undefined') {
      const plan = improvementTracker.getCoachingPlan();
      if (plan?.focusAreas?.length > 0) {
        greetingPrompt += `\nYour improvement plan focus: ${plan.focusAreas.map(f => f.area).join(', ')}.`;
        if (plan.sessionGoal) {
          greetingPrompt += `\nSession goal from last time: "${plan.sessionGoal}"`;
        }
        const progress = improvementTracker.getTopProgress();
        if (progress) {
          greetingPrompt += `\nProgress update: ${progress}`;
        }
        greetingPrompt += `\nMention the plan and progress naturally. Ask if they want to continue the same focus or try something different.`;
      }
    }

    this.dataChannel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: greetingPrompt }]
      }
    }));
    this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
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
          // Send greeting from inside onopen to guarantee channel is ready
          setTimeout(() => this.sendCoachGreeting(), 500);
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
          // Route to notebook resolver or capture in session transcript
          if (this.awaitingNotebook && this.notebookResolve) {
            this.awaitingNotebook = false;
            this.notebookResolve(message.response.output_text);
            this.notebookResolve = null;
          } else {
            this.sessionTranscript.push({
              text: message.response.output_text,
              timestamp: Date.now()
            });
          }
        }
        break;
        
      case 'error':
        console.error('GPT error:', message.error);
        break;
    }
  }
  
  analyzeStroke(strokeData) {
    // Free tier coaching observation limit
    if (this.observationLimit !== null && this.coachingObservationCount >= this.observationLimit) {
      return;
    }

    if (!this.isConnected || this.dataChannel.readyState !== 'open') {
      console.log('GPT not connected, using fallback');
      this.fallbackCoaching(strokeData);
      return;
    }

    // Handle proactive coaching triggers (pattern alerts, personal bests, etc.)
    if (strokeData.type === 'proactive_trigger') {
      const prompt = strokeData.message + '\n\nDeliver this naturally as the coach (1-2 sentences). Stay in character.';
      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
      return;
    }

    // Handle Gemini visual analysis follow-up (async result ~1-2s after stroke)
    if (strokeData.type === 'visual_analysis_followup') {
      const prompt = strokeData.prompt;
      if (!prompt) return;

      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
      return;
    }

    // Handle Gemini rally analysis (async result after rally ends)
    if (strokeData.type === 'rally_analysis') {
      const a = strokeData.analysis;
      let prompt = `RALLY ANALYSIS (Rally #${strokeData.rallyNumber}, ${strokeData.strokeCount} strokes, avg quality ${strokeData.avgQuality}):\n`;
      if (a.overallAssessment) prompt += `Assessment: ${a.overallAssessment}\n`;
      if (a.positioning) prompt += `Positioning: ${a.positioning}\n`;
      if (a.shotSelection) prompt += `Shot selection: ${a.shotSelection}\n`;
      if (a.keyMoment) prompt += `Key moment: ${a.keyMoment}\n`;
      if (a.suggestion) prompt += `Suggestion: ${a.suggestion}\n`;
      prompt += `\nBriefly share ONE tactical observation about this rally (1-2 sentences). Focus on what they can do next point.`;

      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
      return;
    }

    // Handle shot outcome follow-up (async result from ball tracking)
    if (strokeData.type === 'shot_outcome_followup') {
      const outcome = strokeData.shotOutcome;
      let prompt = `SHOT OUTCOME UPDATE for the last ${strokeData.strokeType}:\n`;
      if (outcome.in_court === true) {
        prompt += `The ball landed IN the court.`;
        if (outcome.landed_position) {
          prompt += ` Position: ${outcome.landed_position.x_meters?.toFixed(1)}m across, ${outcome.landed_position.y_meters?.toFixed(1)}m deep.`;
        }
      } else if (outcome.in_court === false) {
        prompt += `The ball went OUT.`;
        if (!outcome.net_clearance) prompt += ' It may have hit the net.';
      }
      prompt += `\nConfidence: ${(outcome.confidence * 100).toFixed(0)}%\n`;
      prompt += `\n${strokeData.message}\n`;
      prompt += `\nBriefly acknowledge the shot outcome (1-2 sentences). If the ball went out despite good form, suggest a specific adjustment.`;

      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
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

    this.coachingObservationCount++;
  }
  
  formatEnhancedStrokePrompt(data) {
    let prompt = `Stroke #${data.session.strokeCount}: ${data.strokeType}\n\n`;

    // Drill mode context — overrides normal coaching flow
    if (typeof drillMode !== 'undefined' && drillMode.isActive && drillMode.currentDrill) {
      const drill = drillMode.currentDrill;
      const lastScore = drill.scores.length > 0 ? drill.scores[drill.scores.length - 1] : null;
      prompt += `DRILL MODE: "${drill.name}"\n`;
      prompt += `Focus: ${drill.metricLabel} (target: ${drill.target}${drill.unit ? ' ' + drill.unit : ''})\n`;
      prompt += `Progress: ${drill.currentRep}/${drill.totalReps} reps`;
      if (lastScore) {
        prompt += `, this rep: ${lastScore.value < 10 ? lastScore.value.toFixed(1) : Math.round(lastScore.value)}${drill.unit ? ' ' + drill.unit : ''}`;
      }
      const avg = drill.scores.length > 0 ? drill.scores.reduce((a, s) => a + s.value, 0) / drill.scores.length : 0;
      if (avg > 0) {
        prompt += `, avg: ${avg < 10 ? avg.toFixed(1) : Math.round(avg)}`;
      }
      prompt += `\nCoach ONLY on this metric. Under 8 seconds.\n\n`;
    }

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
        prompt += `Trend: ${data.orchestratorFeedback.trend}\n`;
        const exStrengths = data.orchestratorFeedback.strengths || [];
        if (exStrengths.length > 0) {
          prompt += `Strengths: ${exStrengths.join(', ')}\n`;
        }
        // Add plan progress so GPT can celebrate toward a goal
        prompt += this.buildFormDetailsBlock(data);
        prompt += `\nKeep it brief - celebrate this stroke and mention a specific strength with numbers. Be genuine, not generic.\n`;
        if (data.brevityInstruction) {
          prompt += data.brevityInstruction;
        }
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
        
        // Include strengths for sandwich coaching (positive -> correction -> encouragement)
        const strengths = data.orchestratorFeedback.strengths || [];
        if (strengths.length > 0) {
          prompt += `PLAYER STRENGTHS: ${strengths.join(', ')}\n\n`;
        }

        // Form details with plan progress
        prompt += this.buildFormDetailsBlock(data);

        prompt += `YOUR TASK: Use sandwich coaching - briefly acknowledge a strength, deliver the correction cue, then encourage. Reference specific angles/metrics. Under 15 seconds. Be direct and actionable like a real coach.\n`;
        if (data.brevityInstruction) {
          prompt += data.brevityInstruction;
        }
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
    
    // Quality with new format
    prompt += this.buildFormDetailsBlock(data);

    // Player level context
    if (data.comparison) {
      prompt += `PLAYER LEVEL: ${data.comparison.skillLevel.toUpperCase()} | ${data.comparison.percentile}th percentile\n`;
      if (data.comparison.strengths.length > 0) {
        prompt += `Strengths: ${data.comparison.strengths.join(', ')}\n`;
      }
      if (data.comparison.improvements.length > 0) {
        prompt += `Focus areas: ${data.comparison.improvements.join(', ')}\n`;
      }
      prompt += `\n`;
    }

    // Biomechanical faults (if available)
    if (data.biomechanical) {
      if (data.biomechanical.detectedFaults && data.biomechanical.detectedFaults.length > 0) {
        prompt += `DETECTED FAULTS (by priority):\n`;
        data.biomechanical.detectedFaults.forEach(fault => {
          prompt += `- ${fault.name}: ${fault.fix}\n`;
        });
        prompt += `\n`;
      }
      if (data.biomechanical.primaryFeedback) {
        prompt += `PRIMARY FOCUS: ${data.biomechanical.primaryFeedback.message}\n\n`;
      }
    }

    // Session context
    prompt += `Session: ${data.session.strokeCount} strokes, ${data.session.averageScore.toFixed(0)} avg, ${data.session.consistency} consistency\n`;

    prompt += `\nProvide personalized coaching in under 15 seconds. Reference specific angles and metrics. If biomechanical faults are detected, prioritize the highest-priority fault.`;

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
   * Synthesize a notebook entry by asking GPT to write coaching notes.
   * Returns a Promise resolving to the coach's free-text notes string.
   * Falls back to a stats-only entry if GPT is disconnected or times out.
   */
  synthesizeNotebookEntry(sessionSummary) {
    // If GPT not connected, use fallback immediately
    if (!this.isConnected || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      return Promise.resolve(this.buildFallbackNotebookEntry(sessionSummary));
    }

    // Build transcript summary (first 5 + last 10 if >20)
    let transcriptSummary = '';
    if (this.sessionTranscript.length > 0) {
      let snippets = this.sessionTranscript;
      if (snippets.length > 20) {
        snippets = [...snippets.slice(0, 5), ...snippets.slice(-10)];
      }
      transcriptSummary = snippets.map(s => s.text).join('\n---\n');
    }

    // Get previous notebook entry for continuity
    let previousNotes = '';
    if (typeof coachNotebook !== 'undefined') {
      const ctx = coachNotebook.getPromptContext();
      if (ctx.mostRecent) {
        previousNotes = ctx.mostRecent.coachNotes;
      }
    }

    // Build per-type breakdown string
    let breakdownStr = '';
    if (sessionSummary.strokeTypeBreakdowns) {
      for (const [type, bd] of Object.entries(sessionSummary.strokeTypeBreakdowns)) {
        breakdownStr += `  ${type}: ${bd.count} strokes, quality=${bd.avgQuality}`;
        if (bd.avgFormScore) breakdownStr += `, form=${bd.avgFormScore}`;
        if (bd.avgHipSep) breakdownStr += `, hipSep=${bd.avgHipSep}deg`;
        if (bd.avgRotation) breakdownStr += `, rotation=${bd.avgRotation}deg`;
        breakdownStr += `\n`;
      }
    }

    const prompt = `SESSION COMPLETE - Write your coaching notebook entry.

Session stats:
- Total strokes: ${sessionSummary.totalStrokes || 0}
- Average score: ${sessionSummary.averageScore || 0}/100
- Best score: ${sessionSummary.bestScore || 0}
- Weaknesses identified: ${(sessionSummary.weaknesses || []).join(', ') || 'none'}
- Improvement trend: ${sessionSummary.improvement > 0 ? '+' + sessionSummary.improvement : sessionSummary.improvement || 0} points
${breakdownStr ? `\nPer-stroke-type breakdown:\n${breakdownStr}` : ''}
${transcriptSummary ? `Your coaching responses this session:\n${transcriptSummary}\n` : ''}
${previousNotes ? `Your notes from last session: "${previousNotes}"\n` : ''}
${typeof tennisAI !== 'undefined' && tennisAI.sessionVideoManager ? tennisAI.sessionVideoManager.formatForNotebook() : ''}
Write 3-5 flowing sentences as yourself (the coach) in first person. Under 500 characters. Include: what you worked on, what improved (reference specific metrics like hip-shoulder separation or rotation angles), what to focus on next session, and any personal observations about this player. Do NOT use any prefix or label — just write the notes directly. Be specific, not generic.`;

    return new Promise((resolve) => {
      this.awaitingNotebook = true;

      // 10-second timeout
      const timeout = setTimeout(() => {
        if (this.awaitingNotebook) {
          this.awaitingNotebook = false;
          this.notebookResolve = null;
          resolve(this.buildFallbackNotebookEntry(sessionSummary));
        }
      }, 10000);

      this.notebookResolve = (text) => {
        clearTimeout(timeout);
        resolve(text);
      };

      // Send synthesis request via data channel
      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
    });
  }

  /**
   * Build a basic stats-only notebook entry when GPT is unavailable.
   */
  buildFallbackNotebookEntry(sessionSummary) {
    const strokes = sessionSummary.totalStrokes || 0;
    const avg = sessionSummary.averageScore || 0;
    const weaknesses = (sessionSummary.weaknesses || []).join(', ') || 'none identified';
    const trend = sessionSummary.improvement > 0 ? 'improving' :
                  sessionSummary.improvement < 0 ? 'declining' : 'steady';
    return `Session: ${strokes} strokes, ${avg} avg score, ${trend} trend. Areas to work on: ${weaknesses}.`;
  }

  /**
   * Build a form details block for per-stroke prompts.
   * Used by both orchestrator and legacy paths.
   */
  buildFormDetailsBlock(data) {
    let block = '';
    const bd = data.quality?.breakdown;
    const tech = data.technique;

    block += `FORM DETAILS:\n`;
    block += `- Quality: ${data.quality?.overall || '?'}/100`;
    if (bd?.usedBiomechanics) {
      block += ` (Form: ${Math.round(bd.biomechanical)}, Power: ${Math.round(bd.power)})`;
    }
    block += `\n`;

    if (tech) {
      if (tech.hipShoulderSeparation != null) {
        block += `- Hip-shoulder separation: ${tech.hipShoulderSeparation.toFixed(0)}deg`;
        // Add target from tracker if available
        if (typeof improvementTracker !== 'undefined') {
          let skillLevel = 'intermediate';
          if (typeof playerProfile !== 'undefined') {
            const ctx = playerProfile.getCoachingContext();
            if (ctx.skillLevel) skillLevel = ctx.skillLevel;
          }
          const targets = improvementTracker.getFormTargets(skillLevel);
          block += ` (target: >${targets.hipSep}deg)`;
        }
        block += `\n`;
      }
      if (tech.shoulderRotation != null) {
        block += `- Body rotation: ${Math.abs(tech.shoulderRotation).toFixed(0)}deg\n`;
      }
      if (tech.elbowAngleAtContact != null) {
        block += `- Elbow angle at contact: ${tech.elbowAngleAtContact.toFixed(0)}deg\n`;
      }
    }

    if (data.smoothness != null) {
      block += `- Swing smoothness: ${Math.round(data.smoothness)}/100\n`;
    } else if (bd?.smoothness != null) {
      block += `- Swing smoothness: ${Math.round(bd.smoothness)}/100\n`;
    }

    if (data.velocity?.magnitude != null) {
      block += `- Racquet speed: ${data.velocity.magnitude.toFixed(1)}`;
      if (data.velocity.normalizedToTorso) block += ` torso-lengths/sec`;
      block += `\n`;
    }

    // Footwork details (from FootworkAnalyzer)
    const fw = data.footwork;
    if (fw) {
      if (fw.stance) {
        block += `- Stance: ${fw.stance.type} (${fw.stance.angle}deg)\n`;
      }
      if (fw.baseWidth) {
        block += `- Base width: ${fw.baseWidth.assessment} (${fw.baseWidth.ratio}x shoulder-width)\n`;
      }
      if (fw.weightTransfer) {
        block += `- Weight transfer: ${fw.weightTransfer.overall}\n`;
      }
      if (fw.stepPattern) {
        block += `- Footwork: ${fw.stepPattern.pattern}\n`;
      }
      if (fw.recovery) {
        block += `- Recovery: ${fw.recovery.recovered ? 'returned to ready' : 'did not recover'}\n`;
      }
      block += `- Footwork score: ${fw.score}/100\n`;
    }

    // Serve analysis details (only for serves)
    const sa = data.serveAnalysis;
    if (sa) {
      block += `SERVE ANALYSIS:\n`;
      if (sa.trophy) {
        block += `- Trophy position: ${sa.trophy.detected ? 'detected' : 'not detected'}`;
        if (sa.trophy.elbowAngle != null) block += `, elbow=${Math.round(sa.trophy.elbowAngle)}deg (ideal ~90)`;
        block += `, score=${sa.trophy.score}/100\n`;
      }
      if (sa.legDrive) {
        block += `- Leg drive: score=${sa.legDrive.score}/100`;
        if (sa.legDrive.kneeBendAtTrophy != null) block += `, knee bend at trophy=${Math.round(sa.legDrive.kneeBendAtTrophy)}deg`;
        block += `\n`;
      }
      if (sa.shoulderTilt) {
        block += `- Shoulder tilt at trophy: ${sa.shoulderTilt.atTrophy != null ? Math.round(sa.shoulderTilt.atTrophy) + 'deg' : '?'} (ideal 20-45)\n`;
      }
      if (sa.contactHeight) {
        block += `- Contact height: ${sa.contactHeight.assessment || '?'}`;
        if (sa.contactHeight.score != null) block += `, score=${sa.contactHeight.score}/100`;
        block += `\n`;
      }
      if (sa.tossArm) {
        block += `- Toss arm: ${sa.tossArm.aboveShoulder ? 'above shoulder' : 'below shoulder'}`;
        if (sa.tossArm.armStraight) block += ', arm straight';
        block += `, score=${sa.tossArm.score}/100\n`;
      }
      block += `- Serve score: ${sa.serveScore}/100\n`;
    }

    // Plan progress line
    if (typeof improvementTracker !== 'undefined' && data.strokeType) {
      const currentMetrics = {
        hipShoulderSeparation: tech?.hipShoulderSeparation,
        rotation: tech?.shoulderRotation ? Math.abs(tech.shoulderRotation) : null,
        elbowAngle: tech?.elbowAngleAtContact,
        smoothness: data.smoothness ?? bd?.smoothness
      };
      const planLine = improvementTracker.formatForStrokePrompt(data.strokeType, currentMetrics);
      if (planLine) {
        block += `\n${planLine}\n`;
      }
    }

    // Rally context for this stroke
    if (typeof tennisAI !== 'undefined' && tennisAI?.rallyTracker) {
      const rallyLine = tennisAI.rallyTracker.formatForStrokePrompt(data);
      if (rallyLine) {
        block += rallyLine;
      }
    }

    // Court position context (from Gemini scene analysis)
    if (typeof tennisAI !== 'undefined' && tennisAI.courtPositionAnalyzer) {
      const cpBlock = tennisAI.courtPositionAnalyzer.formatForPrompt();
      if (cpBlock) block += cpBlock;
    }

    // Previous stroke's visual context from Gemini (if available)
    if (data.previousVisualContext) {
      block += data.previousVisualContext;
    }

    block += `\n`;
    return block;
  }

  /**
   * Synthesize a coaching plan update at session end.
   * Sends a structured prompt to GPT, parses the JSON response.
   * Returns the parsed plan object or null on failure.
   */
  synthesizeCoachingPlan(sessionSummary, tracker) {
    if (!this.isConnected || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      return Promise.resolve(null);
    }
    if (!tracker) return Promise.resolve(null);

    // Build context for plan synthesis
    const currentPlan = tracker.getCoachingPlan();
    const currentFocusAreas = currentPlan?.focusAreas || [];

    // Build cross-session trend data
    let trendData = '';
    for (const type of Object.keys(tracker.data.strokeMetrics)) {
      const progress = tracker.getProgressForStroke(type);
      if (progress && progress.sessions.length >= 1) {
        const latest = progress.sessions[progress.sessions.length - 1];
        trendData += `${type}: quality=${latest.avgQuality}, formScore=${latest.avgFormScore || '?'}, `;
        trendData += `hipSep=${latest.avgHipSep || '?'}, rotation=${latest.avgRotation || '?'}, `;
        trendData += `elbowAngle=${latest.avgElbowAngle || '?'}, smoothness=${latest.avgSmoothness || '?'}, `;
        trendData += `trend=${progress.trend}, velocity=${progress.velocityPerSession}/session\n`;
      }
    }

    const breakdowns = sessionSummary.strokeTypeBreakdowns
      ? JSON.stringify(sessionSummary.strokeTypeBreakdowns)
      : 'not available';

    const prompt = `Based on this session's data and your coaching observations, update the improvement plan.

Current plan: ${JSON.stringify(currentFocusAreas)}
Session stroke breakdowns: ${breakdowns}
Cross-session trends:
${trendData || 'First session -- no prior data'}

Output a JSON object with this exact structure (nothing else):
{"focusAreas": [{"area": "...", "why": "...", "drill": "...", "metric": "...", "strokeType": "...", "target": 0}], "sessionGoal": "..."}

Rules:
- Maximum 3 focus areas
- Each must reference a specific body movement and a measurable target
- "metric" must be one of: hipShoulderSeparation, rotation, elbowAngle, smoothness
- "strokeType" must be one of: Forehand, Backhand, Serve, Volley
- Drills must be specific and practical (can be done at home or on court)
- Session goal should be one clear sentence for next session
- Keep what's working from the current plan, update what changed
- Output ONLY the JSON object, no other text`;

    return new Promise((resolve) => {
      this.awaitingNotebook = true;

      // 8-second timeout — preserve existing plan on failure
      const timeout = setTimeout(() => {
        if (this.awaitingNotebook) {
          this.awaitingNotebook = false;
          this.notebookResolve = null;
          console.warn('Plan synthesis timed out, preserving existing plan');
          resolve(null);
        }
      }, 8000);

      this.notebookResolve = (text) => {
        clearTimeout(timeout);
        try {
          // Extract JSON from response (handle markdown code blocks)
          let jsonStr = text.trim();
          if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          }
          const plan = JSON.parse(jsonStr);
          if (plan.focusAreas && Array.isArray(plan.focusAreas)) {
            resolve(plan);
          } else {
            console.warn('Plan synthesis returned invalid structure:', plan);
            resolve(null);
          }
        } catch (e) {
          console.error('Plan synthesis JSON parse failed:', e, 'Raw:', text);
          resolve(null);
        }
      };

      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
    });
  }

  /**
   * Reset session state
   */
  /**
   * Interrupt current GPT speech by cancelling the active response.
   * Called by speech gate when a new stroke is detected during coaching.
   */
  interruptSpeech() {
    if (!this.isConnected || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

    try {
      // Cancel any in-flight response
      this.dataChannel.send(JSON.stringify({ type: 'response.cancel' }));
    } catch (e) {
      // Ignore errors — best effort interruption
    }
  }

  resetSession() {
    this.lastQualityScores = [];
    this.fatigueDetected = false;
    this.sessionStartTime = Date.now();
    this.sessionTranscript = [];
    this.awaitingNotebook = false;
    this.notebookResolve = null;
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