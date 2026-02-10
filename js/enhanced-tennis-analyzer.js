class EnhancedTennisAnalyzer {
  constructor() {
    // Initialize sophisticated modules
    this.physicsAnalyzer = new PhysicsAnalyzer();
    this.strokeClassifier = new StrokeClassifier();
    this.proReferences = new ProfessionalReferences();
    this.coachingOrchestrator = new CoachingOrchestrator();

    // Motion sequence analyzer for phase-by-phase analysis
    this.motionSequenceAnalyzer = new MotionSequenceAnalyzer();

    // Phase detector for stroke validation
    this.phaseDetector = new PhaseDetector();

    // Biomechanical checkpoint system for quality evaluation
    this.biomechanicalCheckpoints = new BiomechanicalCheckpoints();

    // Footwork analyzer for stance, base width, weight transfer
    this.footworkAnalyzer = new FootworkAnalyzer();

    // Serve analyzer for serve-specific biomechanics
    this.serveAnalyzer = new ServeAnalyzer();

    // Kalman velocity estimator for smooth velocity/acceleration
    this.kalmanEstimator = new KalmanVelocityEstimator({
      processNoise: 0.001,
      measurementNoise: 0.01
    });
    
    // Session tracking
    this.poseHistory = [];
    this.sessionStats = {
      totalStrokes: 0,
      scores: [],
      strokeTypes: {},
      skillLevels: {}, // Track skill level per stroke type
      contactPointHistory: [] // Track for variance calculation
    };

    // Stroke detection state
    this.lastStrokeTime = 0;
    this.strokeCooldown = 1500; // ms between stroke detections

    // Last detected stroke (for calibration tool access)
    this.lastStrokeData = null;

    // Handedness detection
    this.dominantHand = null; // 'right' or 'left', null = assume right
    this.handednessVotes = { left: 0, right: 0 };
    this.handednessLocked = false;

    // Active faults and phase for UI overlay
    this.activeFaults = [];
    this.lastDetectedPhase = null;
    this.onStrokeCallback = null;  // External callback for stroke events (trail freeze, drill mode)

    // Body-relative normalization
    this.landmarkFilter = null;  // Set externally via setLandmarkFilter()
    this.torsoLength = null;     // Cached once calibrated
  }

  /**
   * Get the last detected stroke data (for calibration tool)
   */
  getLastStrokeData() {
    return this.lastStrokeData;
  }

  /**
   * Set reference to LandmarkFilter for torso-length normalization
   */
  setLandmarkFilter(filter) {
    this.landmarkFilter = filter;
  }

    resetSession() {
    this.sessionStats = {
      totalStrokes: 0,
      scores: [],
      strokeTypes: {},
      skillLevels: {},
      contactPointHistory: []
    };
    this.physicsAnalyzer.reset();
    this.coachingOrchestrator.reset();
    this.kalmanEstimator.reset();
    this.poseHistory = [];
    this.activeFaults = [];
    this.lastDetectedPhase = null;
    this.torsoLength = null; // Re-calibrate on next session
    if (this.strokeClassifier) {
      this.strokeClassifier.setNormalized(false);
    }
    if (this.phaseDetector) {
      this.phaseDetector.thresholdScale = 1.0;
    }
    console.log('Session reset complete');
  }
  
  analyzePose(landmarks, timestamp) {
    // Feed data to physics analyzer
    const hasEnoughData = this.physicsAnalyzer.addPoseData(landmarks, timestamp);
    
    if (!hasEnoughData) {
      return null; // Need more frames
    }
    
    // Get sophisticated physics analysis
    const wristVelocity = this.physicsAnalyzer.calculateWristVelocity();
    const acceleration = this.physicsAnalyzer.calculateAcceleration();
    const rotation = this.physicsAnalyzer.calculateBodyRotation();
    const verticalMotion = this.physicsAnalyzer.calculateVerticalMotion();
    const swingPath = this.physicsAnalyzer.extractSwingPath();
    
    // Build rich pose data structure
    const poseData = {
      timestamp,
      landmarks: landmarks,
      
      // Sophisticated physics metrics
      velocity: wristVelocity,
      acceleration: acceleration,
      rotation: rotation,
      verticalMotion: verticalMotion,
      swingPath: swingPath,
      
      // Joint positions for compatibility
      joints: this.extractJointPositions(landmarks),

      // Legacy angles for UI display
      angles: this.calculateBasicAngles(landmarks)
    };

    // Feed joints to Kalman estimator for smooth velocity/acceleration
    const kalmanEstimates = this.kalmanEstimator.update(poseData.joints, timestamp);
    poseData.kalmanEstimates = kalmanEstimates;

    // Override velocity and acceleration with Kalman-derived values for dominant wrist
    const dominantWristKey = this.dominantHand === 'left' ? 'leftWrist' : 'rightWrist';
    const wristEstimate = kalmanEstimates[dominantWristKey];
    if (wristEstimate && wristEstimate.speed > 0) {
      poseData.velocity = {
        magnitude: wristEstimate.speed,
        vx: wristEstimate.vx,
        vy: wristEstimate.vy
      };
      poseData.acceleration = {
        magnitude: wristEstimate.accelMag,
        ax: wristEstimate.ax,
        ay: wristEstimate.ay
      };
    }

    // Body-relative normalization: divide velocity/acceleration by torso length
    if (!this.torsoLength && this.landmarkFilter?.isCalibrated()) {
      this.torsoLength = this.landmarkFilter.getTorsoLength();
      if (this.torsoLength && this.torsoLength > 0.01) {
        console.log('EnhancedTennisAnalyzer: Torso calibration applied, length:', this.torsoLength.toFixed(4));
        // Propagate to subsystems
        if (this.phaseDetector) {
          this.phaseDetector.setBodyRelativeScale(this.torsoLength);
        }
        if (this.strokeClassifier) {
          this.strokeClassifier.setNormalized(true);
        }
        if (this.footworkAnalyzer) {
          this.footworkAnalyzer.setTorsoLength(this.torsoLength);
        }
        if (this.serveAnalyzer) {
          this.serveAnalyzer.setTorsoLength(this.torsoLength);
        }
      } else {
        this.torsoLength = null; // Invalid, stay in raw mode
      }
    }

    if (this.torsoLength && this.torsoLength > 0.01) {
      // Store originals before normalization
      poseData.rawVelocity = { ...poseData.velocity };
      poseData.rawAcceleration = { ...poseData.acceleration };

      // Normalize magnitudes and components by torso length
      const tl = this.torsoLength;
      poseData.velocity = {
        magnitude: poseData.velocity.magnitude / tl,
        vx: (poseData.velocity.vx || 0) / tl,
        vy: (poseData.velocity.vy || 0) / tl
      };
      poseData.acceleration = {
        magnitude: poseData.acceleration.magnitude / tl,
        ax: (poseData.acceleration.ax || 0) / tl,
        ay: (poseData.acceleration.ay || 0) / tl
      };
      poseData.normalizedToTorso = true;
    }

    this.poseHistory.push(poseData);

    // Detect handedness by comparing wrist speeds over time
    if (!this.handednessLocked && this.poseHistory.length > 1) {
      const prev = this.poseHistory[this.poseHistory.length - 2];
      const rDx = landmarks[16].x - prev.landmarks[16].x;
      const rDy = landmarks[16].y - prev.landmarks[16].y;
      const lDx = landmarks[15].x - prev.landmarks[15].x;
      const lDy = landmarks[15].y - prev.landmarks[15].y;
      const rSpeed = Math.sqrt(rDx * rDx + rDy * rDy);
      const lSpeed = Math.sqrt(lDx * lDx + lDy * lDy);
      if (rSpeed > 0.01 || lSpeed > 0.01) {
        if (rSpeed > lSpeed) this.handednessVotes.right++;
        else this.handednessVotes.left++;
      }
      const totalVotes = this.handednessVotes.left + this.handednessVotes.right;
      if (totalVotes >= 30) {
        this.dominantHand = this.handednessVotes.right >= this.handednessVotes.left ? 'right' : 'left';
        this.handednessLocked = true;
        if (this.footworkAnalyzer) {
          this.footworkAnalyzer.setDominantHand(this.dominantHand);
        }
        if (this.serveAnalyzer) {
          this.serveAnalyzer.setDominantHand(this.dominantHand);
        }
        console.log('Handedness detected:', this.dominantHand);
      }
    }

    // Keep last 60 frames (2 seconds at 30fps)
    if (this.poseHistory.length > 60) {
      this.poseHistory.shift();
    }
    
    // Detect stroke completion
    const stroke = this.detectStrokePattern(wristVelocity, acceleration);
    if (stroke) {
      this.onStrokeDetected(stroke, poseData);
    }
    
    return poseData;
  }
  
  extractJointPositions(landmarks) {
    const isLeft = this.dominantHand === 'left';
    return {
      // Dominant side (adapts to detected handedness)
      dominantWrist: landmarks[isLeft ? 15 : 16],
      dominantElbow: landmarks[isLeft ? 13 : 14],
      dominantShoulder: landmarks[isLeft ? 11 : 12],
      // Legacy names (preserved for backward compatibility)
      rightWrist: landmarks[16],
      rightElbow: landmarks[14],
      rightShoulder: landmarks[12],
      leftShoulder: landmarks[11],
      leftElbow: landmarks[13],
      leftWrist: landmarks[15],
      rightHip: landmarks[24],
      leftHip: landmarks[23],
      rightKnee: landmarks[26],
      leftKnee: landmarks[25],
      rightAnkle: landmarks[28],
      leftAnkle: landmarks[27],
      rightHeel: landmarks[29],
      leftHeel: landmarks[30],
      rightFootIndex: landmarks[31],
      leftFootIndex: landmarks[32],
      nose: landmarks[0]
    };
  }
  
  calculateBasicAngles(landmarks) {
    // Keep for UI compatibility
    return {
      elbowAngle: this.calculateAngle(landmarks[16], landmarks[14], landmarks[12]),
      shoulderRotation: this.calculateRotation(landmarks[11], landmarks[12]),
      hipShoulderSeparation: this.calculateSeparation(
        landmarks[11], landmarks[12], 
        landmarks[23], landmarks[24]
      ),
      kneeBend: this.calculateAngle(landmarks[26], landmarks[24], landmarks[28])
    };
  }
  
  calculateAngle(p1, p2, p3) {
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - 
                    Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
  }
  
  calculateRotation(leftShoulder, rightShoulder) {
    return Math.atan2(
      rightShoulder.y - leftShoulder.y,
      rightShoulder.x - leftShoulder.x
    ) * 180 / Math.PI;
  }
  
  calculateSeparation(leftShoulder, rightShoulder, leftHip, rightHip) {
    const shoulderAngle = this.calculateRotation(leftShoulder, rightShoulder);
    const hipAngle = this.calculateRotation(leftHip, rightHip);
    return Math.abs(shoulderAngle - hipAngle);
  }
  
  detectStrokePattern(velocity, acceleration) {
    const now = Date.now();

    // Cooldown period to prevent double-detection
    if (now - this.lastStrokeTime < this.strokeCooldown) {
      return null;
    }

    // Check if we have enough history
    if (this.poseHistory.length < 20) {
      return null;
    }

    // Detect peak in velocity (indicates potential contact point)
    const windowSize = Math.min(30, this.poseHistory.length);
    const recentVelocities = this.poseHistory.slice(-windowSize).map(p => p.velocity.magnitude);
    const maxVelocity = Math.max(...recentVelocities);
    const peakIndex = recentVelocities.indexOf(maxVelocity);

    // Adaptive velocity threshold: scale for body-relative normalization
    const detectionThreshold = this.torsoLength ? (0.015 / this.torsoLength) : 0.015;
    if (maxVelocity < detectionThreshold || peakIndex <= 5 || peakIndex >= windowSize - 5) {
      return null;
    }

    // PHASE-BASED VALIDATION: Verify this is a real stroke pattern
    const strokeValidation = this.validateStrokeWithPhases();
    if (!strokeValidation.isValid) {
      // Log rejection reason for debugging
      if (maxVelocity > 0.03) {
        console.log('Stroke rejected:', strokeValidation.reason, '| Velocity:', maxVelocity.toFixed(3));
      }
      return null;
    }

    this.lastStrokeTime = now;
    return this.buildStrokeData(windowSize - peakIndex); // Index from end of history
  }

  /**
   * Validate stroke using phase detection
   * A valid stroke should show: preparation → loading → acceleration → contact → follow-through
   */
  validateStrokeWithPhases() {
    if (!this.phaseDetector || this.poseHistory.length < 20) {
      // Fallback to basic validation if phase detector unavailable
      return { isValid: true, reason: 'phase_detector_unavailable' };
    }

    try {
      const phases = this.phaseDetector.detectPhases(this.poseHistory);

      // No phases detected
      if (!phases) {
        return { isValid: false, reason: 'no_phases_detected' };
      }

      // Validate phase sequence
      if (!this.phaseDetector.validatePhases(phases)) {
        return { isValid: false, reason: 'invalid_phase_sequence' };
      }

      // Check minimum phase durations for a real stroke
      const minDurations = {
        acceleration: 2,   // At least 2 frames of acceleration
        followThrough: 3   // At least 3 frames of follow-through
      };

      if (phases.durations.acceleration < minDurations.acceleration) {
        return { isValid: false, reason: 'acceleration_too_short' };
      }

      if (phases.durations.followThrough < minDurations.followThrough) {
        return { isValid: false, reason: 'followthrough_too_short' };
      }

      // Check for minimum rotation during loading (indicates actual tennis stroke)
      // Skip for serves — they have different rotation patterns (more vertical motion)
      const recentVertical = this.poseHistory.slice(-15);
      const maxVerticalMotion = recentVertical.length > 0
        ? Math.max(...recentVertical.map(p => Math.abs(p.verticalMotion || 0)))
        : 0;
      const likelyServe = maxVerticalMotion > 0.20;

      if (!likelyServe) {
        const loadingData = this.poseHistory.slice(phases.loading.start, phases.loading.end);
        if (loadingData.length >= 2) {
          const startRotation = Math.abs(loadingData[0]?.rotation || 0);
          const endRotation = Math.abs(loadingData[loadingData.length - 1]?.rotation || 0);
          const rotationGain = endRotation - startRotation;

          if (rotationGain < 1.5) {
            return { isValid: false, reason: 'insufficient_loading_rotation' };
          }
        }
      }

      return {
        isValid: true,
        reason: 'valid_stroke_pattern',
        phases: phases
      };

    } catch (error) {
      console.warn('Phase validation error:', error.message);
      // On error, fall back to accepting the stroke
      return { isValid: true, reason: 'phase_validation_error' };
    }
  }
  
  buildStrokeData(contactIndexFromEnd) {
    const contactIndex = this.poseHistory.length - contactIndexFromEnd;
    const contactFrame = this.poseHistory[contactIndex];
    
    // Flip rotation sign for left-handed players (forehand/backhand are mirrored)
    const classificationRotation = this.dominantHand === 'left'
      ? -contactFrame.rotation : contactFrame.rotation;

    // USE SOPHISTICATED CLASSIFIER (not naive left/right heuristic!)
    const strokeType = this.strokeClassifier.classifyStroke(
      contactFrame.velocity,
      contactFrame.acceleration,
      classificationRotation,
      contactFrame.verticalMotion
    );
    
    // Assess quality using sophisticated classifier
    const qualityAssessment = this.strokeClassifier.assessStrokeQuality(
      strokeType,
      contactFrame.velocity,
      contactFrame.acceleration,
      contactFrame.rotation,
      contactFrame.swingPath
    );
    
    // Get swing path with smoothness score
    const swingPath = this.physicsAnalyzer.extractSwingPath(15);
    const smoothness = this.physicsAnalyzer.calculatePathSmoothness(swingPath);

    // Estimate ball speed
    const estimatedBallSpeed = this.strokeClassifier.estimateBallSpeed(contactFrame.velocity);
    
    // Calculate contact point variance
    const contactPointVariance = this.calculateContactPointVariance(contactFrame);
    
    // Compare with professional standards
    const isNormalized = contactFrame.normalizedToTorso || false;
    const proComparison = this.proReferences.compareWithProfessional({
      velocity: contactFrame.velocity.magnitude,
      acceleration: contactFrame.acceleration.magnitude,
      rotation: contactFrame.rotation,
      smoothness: smoothness
    }, strokeType, isNormalized);
    
    const strokeData = {
      type: strokeType,
      timestamp: contactFrame.timestamp,

      // Physics data
      velocity: contactFrame.velocity,
      acceleration: contactFrame.acceleration,
      rotation: contactFrame.rotation,
      verticalMotion: contactFrame.verticalMotion,

      // Quality assessment
      quality: qualityAssessment,
      smoothness: smoothness,
      estimatedBallSpeed: estimatedBallSpeed,

      // Professional comparison
      proComparison: proComparison,

      // Swing analysis
      swingPath: swingPath,

      // Contact point data (uses dominant hand)
      contactPoint: {
        height: (contactFrame.joints.dominantWrist || contactFrame.joints.rightWrist).y,
        distance: (contactFrame.joints.dominantWrist || contactFrame.joints.rightWrist).x,
        angles: contactFrame.angles
      },
      contactPointVariance: contactPointVariance,

      // Technique details (for UI display) — populated after footwork analysis below
      technique: {
        elbowAngleAtContact: contactFrame.angles.elbowAngle,
        shoulderRotation: contactFrame.angles.shoulderRotation,
        hipShoulderSeparation: contactFrame.angles.hipShoulderSeparation,
        kneeBend: contactFrame.angles.kneeBend,
        stance: 'neutral',       // overwritten below
        weightTransfer: 'static' // overwritten below
      },

      // Phase-by-phase analysis (from motion sequence analyzer)
      sequenceAnalysis: this.analyzeMotionSequence(strokeType),

      // Footwork analysis (populated below)
      footwork: null,

      // Serve analysis (populated below for serves only)
      serveAnalysis: null,

      // Biomechanical checkpoint evaluation (populated below)
      biomechanicalEvaluation: null
    };

    // Run footwork analysis using the new FootworkAnalyzer
    if (this.footworkAnalyzer) {
      const phaseData = strokeData.sequenceAnalysis?.phases || null;
      strokeData.footwork = this.footworkAnalyzer.analyzeFootwork(
        this.poseHistory, phaseData, strokeType
      );
      if (strokeData.footwork) {
        // Populate technique.stance and technique.weightTransfer for backward compat
        strokeData.technique.stance = strokeData.footwork.stance?.type || 'neutral';
        strokeData.technique.weightTransfer = strokeData.footwork.weightTransfer?.legacyLabel || 'static';
      }
    }

    // Run serve analysis for serves
    if (strokeType === 'Serve' && this.serveAnalyzer) {
      const phaseData = strokeData.sequenceAnalysis?.phases || null;
      strokeData.serveAnalysis = this.serveAnalyzer.analyzeServe(
        this.poseHistory, phaseData, strokeType
      );
      if (strokeData.serveAnalysis) {
        console.log('Serve Analysis:', {
          trophyDetected: strokeData.serveAnalysis.trophy?.detected,
          trophyScore: strokeData.serveAnalysis.trophy?.score,
          legDriveScore: strokeData.serveAnalysis.legDrive?.score,
          contactHeightScore: strokeData.serveAnalysis.contactHeight?.score,
          serveScore: strokeData.serveAnalysis.serveScore
        });
      }
    }

    // Run biomechanical evaluation if we have sequence analysis
    if (strokeData.sequenceAnalysis && this.biomechanicalCheckpoints) {
      strokeData.biomechanicalEvaluation = this.biomechanicalCheckpoints.evaluateStroke(
        strokeData,
        strokeData.sequenceAnalysis
      );

      if (strokeData.biomechanicalEvaluation) {
        // Recompute quality with biomechanics blended in
        strokeData.quality = this.strokeClassifier.assessStrokeQualityWithBiomechanics(
          strokeData.type,
          contactFrame.velocity,
          contactFrame.acceleration,
          contactFrame.rotation,
          contactFrame.swingPath,
          strokeData.biomechanicalEvaluation
        );

        console.log('Biomechanical Evaluation:', {
          overall: strokeData.biomechanicalEvaluation.overall,
          faults: strokeData.biomechanicalEvaluation.detectedFaults.map(f => f.name),
          primaryFeedback: strokeData.biomechanicalEvaluation.primaryFeedback?.message
        });

        // Expose detected faults for UI overlay highlighting
        this.activeFaults = strokeData.biomechanicalEvaluation.detectedFaults.map(f => ({
          ...f,
          timestamp: Date.now()
        }));
      } else {
        this.activeFaults = [];
      }

      // Expose phase data for UI
      if (strokeData.sequenceAnalysis?.phases) {
        this.lastDetectedPhase = strokeData.sequenceAnalysis.phases;
      }
    }

    return strokeData;
  }

  /**
   * Analyze the motion sequence for phase-by-phase insights
   */
  analyzeMotionSequence(strokeType) {
    if (!this.motionSequenceAnalyzer || this.poseHistory.length < 20) {
      return null;
    }

    try {
      const analysis = this.motionSequenceAnalyzer.analyzeSequence(
        this.poseHistory,
        strokeType
      );

      if (analysis) {
        // Log for diagnostic purposes
        console.log('Motion Sequence Analysis:', {
          strokeType,
          phases: analysis.phases?.durations,
          sequenceQuality: analysis.sequenceQuality?.overall,
          kineticChain: analysis.kineticChain?.chainQuality
        });
      }

      return analysis;
    } catch (error) {
      console.warn('Motion sequence analysis failed:', error.message);
      return null;
    }
  }
  
  /**
   * Calculate contact point variance for consistency tracking
   */
  calculateContactPointVariance(currentFrame) {
    const wrist = currentFrame.joints.dominantWrist || currentFrame.joints.rightWrist;
    const currentContact = {
      x: wrist.x,
      y: wrist.y,
      z: wrist.z || 0
    };
    
    // Store in history
    this.sessionStats.contactPointHistory.push(currentContact);
    
    // Keep last 20 strokes
    if (this.sessionStats.contactPointHistory.length > 20) {
      this.sessionStats.contactPointHistory.shift();
    }
    
    // Need at least 3 strokes to calculate variance
    if (this.sessionStats.contactPointHistory.length < 3) {
      return 0.05; // Default low variance
    }
    
    // Calculate 3D variance
    const contacts = this.sessionStats.contactPointHistory;
    const avgX = contacts.reduce((sum, c) => sum + c.x, 0) / contacts.length;
    const avgY = contacts.reduce((sum, c) => sum + c.y, 0) / contacts.length;
    const avgZ = contacts.reduce((sum, c) => sum + c.z, 0) / contacts.length;
    
    const variance = contacts.reduce((sum, c) => {
      const dx = c.x - avgX;
      const dy = c.y - avgY;
      const dz = c.z - avgZ;
      return sum + Math.sqrt(dx*dx + dy*dy + dz*dz);
    }, 0) / contacts.length;
    
    return variance;
  }
  
  onStrokeDetected(strokeData, currentPose) {
    // Store for calibration tool access
    this.lastStrokeData = strokeData;

    // Trigger ball tracking to capture post-stroke frames for shot outcome
    if (typeof ballTrackingClient !== 'undefined' && ballTrackingClient.isConnected) {
      ballTrackingClient.onStrokeDetected(strokeData);
    } else if (typeof window.tennisAI !== 'undefined' && window.tennisAI.ballTracker) {
      window.tennisAI.ballTracker.onStrokeDetected(strokeData);
    }

    // End ghost recording and check if this is the best stroke
    if (typeof ghostOverlay !== 'undefined' && ghostOverlay.isRecording) {
      const recordedStroke = ghostOverlay.endRecording(strokeData.type, strokeData.quality.overall);
      if (recordedStroke && ghostOverlay.bestStrokeThisSession === recordedStroke) {
        console.log(`New best stroke recorded: ${strokeData.type} (${strokeData.quality.overall})`);
      }
    }

    // Update session statistics
    this.sessionStats.totalStrokes++;
    this.sessionStats.scores.push(strokeData.quality.overall);

    // DIAGNOSTIC LOGGING - capture all raw metrics for calibration
    if (typeof diagnosticLogger !== 'undefined') {
      diagnosticLogger.logStroke(
        strokeData,
        strokeData.sequenceAnalysis,
        strokeData.biomechanicalEvaluation
      );
    }

    // Persist stroke to localStorage
    if (typeof sessionStorage !== 'undefined' && sessionStorage.addStroke) {
      sessionStorage.addStroke(strokeData);
    }
    
    // Track stroke type distribution
    const type = strokeData.type;
    this.sessionStats.strokeTypes[type] = 
      (this.sessionStats.strokeTypes[type] || 0) + 1;
    
    // Track skill level per stroke type
    if (strokeData.proComparison) {
      this.sessionStats.skillLevels[type] = strokeData.proComparison.skillLevel;
    }
    
    // Build player metrics for coaching orchestrator
    const playerMetrics = this.buildPlayerMetrics(strokeData);
    
    // USE COACHING ORCHESTRATOR to get intelligent feedback
    const coachingRecommendation = this.coachingOrchestrator.analyzeStroke(
      strokeData, 
      playerMetrics
    );
    
    // Build enhanced coaching context
    const coachingContext = this.buildCoachingContext(strokeData, coachingRecommendation);
    
    // Send to GPT Coach with rich context (gated by speech controller)
    if (coachingRecommendation) {
      const speechGate = (typeof tennisAI !== 'undefined') ? tennisAI.speechGate : null;
      if (speechGate) {
        speechGate.onStroke();
        const decision = speechGate.shouldSpeak(coachingContext);
        if (decision === 'speak_now') {
          // Append brevity instruction if between points
          if (speechGate.shouldBeBrief()) {
            coachingContext.brevityInstruction = speechGate.getBrevityInstruction();
          }
          gptVoiceCoach.analyzeStroke(coachingContext);
        } else if (decision === 'queue') {
          speechGate.enqueue(coachingContext);
        }
        // 'suppress' → do nothing
      } else {
        gptVoiceCoach.analyzeStroke(coachingContext);
      }
    }
    
    // Update UI
    this.updateUI(coachingContext);

    // Check proactive triggers (pattern alerts, personal bests, etc.)
    if (typeof tennisAI !== 'undefined' && tennisAI.proactiveTriggers) {
      const trigger = tennisAI.proactiveTriggers.check(strokeData, this.sessionStats);
      if (trigger && typeof gptVoiceCoach !== 'undefined' && gptVoiceCoach.isConnected) {
        // Send proactive message to GPT after a brief delay to not overlap with main coaching
        setTimeout(() => {
          gptVoiceCoach.analyzeStroke({
            type: 'proactive_trigger',
            triggerType: trigger.type,
            message: trigger.message
          });
        }, 3000);
      }
    }

    // Trigger live feedback overlay (skeleton flash + floating score + word label)
    if (typeof tennisAI !== 'undefined' && tennisAI.liveFeedbackOverlay) {
      const contactPt = strokeData.contactPoint
        ? { x: strokeData.contactPoint.distance, y: strokeData.contactPoint.height }
        : null;
      tennisAI.liveFeedbackOverlay.flashStroke(
        strokeData.quality.overall,
        null,  // auto-pick label
        contactPt,
        strokeData,
        coachingRecommendation
      );
    }

    // Trigger screen border flash based on quality (legacy)
    if (typeof flashStrokeQuality === 'function') {
      flashStrokeQuality(strokeData.quality.overall);
    }

    // Record stroke for challenge mode
    if (typeof recordChallengeStroke === 'function') {
      recordChallengeStroke(strokeData);
    }

    // Record stroke for drill mode
    if (typeof recordDrillStroke === 'function') {
      recordDrillStroke(strokeData);
    }

    // Record replay BEFORE clearing pose history
    let replayIdx = -1;
    if (typeof window.strokeReplayManager !== 'undefined') {
      window.strokeReplayManager.recordStroke([...this.poseHistory], strokeData);
      replayIdx = window.strokeReplayManager.getReplayCount() - 1;
    }

    // Bookmark stroke in session video manager
    if (typeof tennisAI !== 'undefined' && tennisAI.sessionVideoManager) {
      tennisAI.sessionVideoManager.addBookmark(strokeData, replayIdx);
    }

    // Notify external listeners before clearing history (trail freeze, etc.)
    if (this.onStrokeCallback) {
      this.onStrokeCallback(strokeData, [...this.poseHistory]);
    }

    // Fire async Gemini visual analysis (result arrives ~1-2s later as follow-up)
    this.fireVisualAnalysis(strokeData);

    // Clear pose history after stroke
    this.poseHistory = [];
  }

  /**
   * Async Gemini visual analysis — runs after instant MediaPipe coaching.
   * On completion, sends a follow-up to GPT with visual insights.
   */
  fireVisualAnalysis(strokeData) {
    if (typeof tennisAI === 'undefined') return;
    const sa = tennisAI.sceneAnalyzer;
    const vm = tennisAI.visualMerger;
    if (!sa || !sa.enabled || !vm) return;

    const faults = strokeData.biomechanicalEvaluation?.detectedFaults || [];
    sa.analyzeStroke(strokeData.type, faults).then(visualResult => {
      if (!visualResult) return;

      const merged = vm.merge(strokeData, visualResult);
      if (!merged) return;

      const followUp = vm.buildVisualFollowUpPrompt(merged, strokeData.type);
      if (!followUp) return;

      // Send as follow-up to GPT (same pattern as shot_outcome_followup)
      if (typeof gptVoiceCoach !== 'undefined' && gptVoiceCoach.isConnected) {
        gptVoiceCoach.analyzeStroke({
          type: 'visual_analysis_followup',
          strokeType: strokeData.type,
          visualResult: merged,
          prompt: followUp
        });
      }
    }).catch(err => {
      console.warn('Visual analysis follow-up failed:', err);
    });
  }

  /**
   * Build player metrics object for coaching orchestrator
   * Includes phase-level data from motion sequence analysis and biomechanical evaluation
   */
  buildPlayerMetrics(strokeData) {
    const metrics = {
      velocity: strokeData.velocity,
      acceleration: strokeData.acceleration,
      rotation: strokeData.rotation,
      verticalMotion: strokeData.verticalMotion,
      smoothness: strokeData.smoothness,
      technique: strokeData.technique,
      contactPointVariance: strokeData.contactPointVariance,
      quality: strokeData.quality.overall,
      consistency: this.getConsistency(),
      preparationTime: this.estimatePreparationTime(),
      forwardMomentum: this.estimateForwardMomentum(),
      backFootWeight: this.estimateBackFootWeight(),
      armExtension: this.estimateArmExtension(strokeData),
      followThroughComplete: this.checkFollowThroughComplete(strokeData),
      normalizedToTorso: !!this.torsoLength
    };

    // Enrich with phase-level data from motion sequence analysis
    const seq = strokeData.sequenceAnalysis;
    if (seq) {
      // Override estimates with actual measured values from phase analysis
      if (seq.phaseAnalysis) {
        const pa = seq.phaseAnalysis;
        if (pa.preparation) {
          metrics.preparationTime = pa.preparation.duration >= 8 ? 0.5 : 0.9;
          metrics.splitStepDetected = pa.preparation.splitStepDetected;
        }
        if (pa.acceleration) {
          metrics.forwardMomentum = pa.acceleration.forwardMomentum || metrics.forwardMomentum;
          metrics.accelerationSmoothness = pa.acceleration.accelerationSmoothness;
          metrics.maxHipShoulderSeparation = pa.acceleration.maxHipShoulderSeparation;
        }
        if (pa.loading) {
          metrics.backFootWeight = pa.loading.weightOnBackFoot || metrics.backFootWeight;
          metrics.loadingRotationGain = pa.loading.rotationGain;
        }
        if (pa.followThrough) {
          metrics.followThroughComplete = pa.followThrough.quality > 60;
          metrics.followThroughDuration = pa.followThrough.duration;
        }
      }

      // Phase durations
      if (seq.phases?.durations) {
        metrics.phaseDurations = seq.phases.durations;
      }

      // Kinetic chain quality
      if (seq.kineticChain) {
        metrics.kineticChainQuality = seq.kineticChain.chainQuality;
        metrics.kineticChainViolations = seq.kineticChain.violations;
      }

      // Overall sequence quality
      if (seq.sequenceQuality) {
        metrics.sequenceQualityOverall = seq.sequenceQuality.overall;
      }
    }

    // Enrich with biomechanical fault data
    const bio = strokeData.biomechanicalEvaluation;
    if (bio) {
      metrics.biomechanicalScore = bio.overall;
      metrics.detectedFaults = bio.detectedFaults.map(f => ({
        name: f.name,
        priority: f.priority,
        fix: f.fix
      }));
      metrics.primaryBiomechanicalFeedback = bio.primaryFeedback;
    }

    // Enrich with serve data
    const sa = strokeData.serveAnalysis;
    if (sa) {
      metrics.serveScore = sa.serveScore;
      metrics.serveTrophyScore = sa.trophy?.score || 0;
      metrics.serveLegDriveScore = sa.legDrive?.score || 0;
      metrics.serveContactHeightScore = sa.contactHeight?.score || 0;
      metrics.serveShoulderTiltScore = sa.shoulderTilt?.score || 0;
      metrics.serveTossArmScore = sa.tossArm?.score || 0;
      metrics.serveTrophyElbowAngle = sa.trophy?.elbowAngle;
      metrics.serveShoulderTiltAngle = sa.shoulderTilt?.atTrophy;
      metrics.serveLegDriveKneeBend = sa.legDrive?.kneeBendAtTrophy;
    }

    // Enrich with court position metrics (from Gemini scene analysis)
    if (typeof tennisAI !== 'undefined' && tennisAI.courtPositionAnalyzer) {
      const cpMetrics = tennisAI.courtPositionAnalyzer.getMetrics();
      metrics.courtZone = cpMetrics.courtZone;
      metrics.lingeringNoMansLand = cpMetrics.lingeringNoMansLand;
      metrics.positionScore = cpMetrics.positionScore;
      metrics.courtRecoveryQuality = cpMetrics.recoveryQuality;
      // Invert: coaching tree triggers on noSplitStepAtNet=true (no split step)
      metrics.noSplitStepAtNet = cpMetrics.courtZone === 'net' && !cpMetrics.splitStepAtNet;
    }

    // Enrich with cached Gemini visual metrics from previous stroke
    if (typeof tennisAI !== 'undefined' && tennisAI.visualMerger) {
      const visualMetrics = tennisAI.visualMerger.getOrchestratorMetrics(
        tennisAI.visualMerger.lastVisualResult
      );
      Object.assign(metrics, visualMetrics);
    }

    // Enrich with footwork data
    const fw = strokeData.footwork;
    if (fw) {
      metrics.stanceType = fw.stance?.type;
      metrics.stanceAngle = fw.stance?.angle;
      metrics.baseWidthRatio = fw.baseWidth?.ratio;
      metrics.footworkScore = fw.score;
      metrics.stepPattern = fw.stepPattern?.pattern;
      metrics.hasStepIn = fw.stepPattern?.hasStepIn || false;
      metrics.weightTransferDirection = fw.weightTransfer?.overall;
      metrics.recoveryDetected = fw.recovery?.recovered || false;
    }

    return metrics;
  }
  
  /**
   * Estimate preparation time (simplified for now)
   */
  estimatePreparationTime() {
    // Use pose history length as proxy - shorter history = later preparation
    const historyLength = this.poseHistory.length;
    if (historyLength < 20) return 0.9; // Late
    if (historyLength < 30) return 0.7; // Moderate
    return 0.5; // Early (good)
  }
  
  /**
   * Estimate forward momentum from pose progression
   */
  estimateForwardMomentum() {
    if (this.poseHistory.length < 10) return 0.5;
    
    const start = this.poseHistory[0].joints;
    const end = this.poseHistory[this.poseHistory.length - 1].joints;
    
    // Check if center of mass moved forward
    const hipMovement = end.rightHip.x - start.rightHip.x;
    
    if (hipMovement > 0.05) return 0.8; // Good forward movement
    if (hipMovement > 0.02) return 0.6; // Moderate
    return 0.3; // Static or backward
  }
  
  /**
   * Estimate back foot weight at contact
   */
  estimateBackFootWeight() {
    if (this.poseHistory.length < 5) return 0.5;
    
    const contactFrame = this.poseHistory[this.poseHistory.length - 1];
    
    // Check ankle heights (higher back ankle = weight on back foot)
    const backAnkleHeight = contactFrame.joints.rightAnkle.y;
    const frontAnkleHeight = contactFrame.joints.leftAnkle.y;
    
    if (backAnkleHeight < frontAnkleHeight - 0.05) {
      return 0.7; // Weight on back foot (bad)
    } else if (backAnkleHeight < frontAnkleHeight) {
      return 0.4; // Balanced
    }
    return 0.2; // Weight forward (good)
  }
  
  /**
   * Estimate arm extension
   */
  estimateArmExtension(strokeData) {
    const elbowAngle = strokeData.technique.elbowAngleAtContact;
    
    // More extension = higher angle
    if (elbowAngle > 150) return 0.9;
    if (elbowAngle > 140) return 0.75;
    if (elbowAngle > 130) return 0.6;
    return 0.4; // Collapsed elbow
  }
  
  /**
   * Check if follow-through was complete
   */
  checkFollowThroughComplete(strokeData) {
    // Use smoothness and swing path as proxies
    return strokeData.smoothness > 60 && strokeData.swingPath.length >= 12;
  }
  
  buildCoachingContext(strokeData, coachingRecommendation) {
    const proComp = strokeData.proComparison;
    
    // Base context from stroke data
    const baseContext = {
      strokeType: strokeData.type,
      
      // Quality breakdown
      quality: {
        overall: strokeData.quality.overall,
        breakdown: strokeData.quality.breakdown,
        feedback: strokeData.quality.feedback,
        trend: this.getTrend(),
        estimatedBallSpeed: strokeData.estimatedBallSpeed
      },
      
      // Professional comparison
      comparison: proComp ? {
        skillLevel: proComp.skillLevel,
        percentile: proComp.percentile,
        overallSimilarity: Math.round(proComp.overallSimilarity * 100),
        velocityRatio: Math.round(proComp.velocityRatio * 100),
        accelerationRatio: Math.round(proComp.accelerationRatio * 100),
        rotationRatio: Math.round(proComp.rotationRatio * 100),
        strengths: proComp.strengths,
        improvements: proComp.improvements
      } : null,
      
      // Technique specifics (for UI display)
      technique: strokeData.technique,
      
      // Physics metrics
      physics: {
        velocity: strokeData.velocity.magnitude.toFixed(3),
        acceleration: strokeData.acceleration.magnitude.toFixed(3),
        rotation: strokeData.rotation.toFixed(1),
        smoothness: strokeData.smoothness.toFixed(0)
      },
      
      // Session context
      session: {
        strokeCount: this.sessionStats.totalStrokes,
        averageScore: this.getAverageScore(),
        strokeDistribution: this.sessionStats.strokeTypes,
        consistency: this.getConsistency(),
        skillLevels: this.sessionStats.skillLevels
      }
    };
    
    // Add orchestrator coaching if available
    if (coachingRecommendation) {
      const strengths = coachingRecommendation.strengths || [];
      if (coachingRecommendation.type === 'excellence') {
        baseContext.orchestratorFeedback = {
          type: 'excellence',
          message: coachingRecommendation.message,
          trend: coachingRecommendation.sessionContext.recentQualityTrend,
          strengths: strengths
        };
      } else if (coachingRecommendation.issue) {
        baseContext.orchestratorFeedback = {
          type: 'coaching',
          issue: coachingRecommendation.issue,
          cue: coachingRecommendation.cue,
          diagnosis: coachingRecommendation.diagnosis,
          keyMetrics: coachingRecommendation.keyMetrics,
          expectedImprovement: coachingRecommendation.expectedImprovement,
          playerLevel: coachingRecommendation.playerLevel,
          criticalSituation: coachingRecommendation.criticalSituation,
          consecutiveOccurrences: coachingRecommendation.consecutiveOccurrences,
          strengths: strengths
        };
      }
      baseContext.strengths = strengths;
    }

    // Add sequence analysis if available (phase-by-phase insights)
    if (strokeData.sequenceAnalysis) {
      const seq = strokeData.sequenceAnalysis;
      baseContext.sequenceAnalysis = {
        sequenceQuality: seq.sequenceQuality?.overall,
        phaseBreakdown: seq.sequenceQuality?.breakdown,
        kineticChainQuality: seq.kineticChain?.chainQuality,
        phaseDurations: seq.phases?.durations,
        feedback: seq.feedback
      };
    }

    // Add biomechanical evaluation (checkpoint-based quality)
    if (strokeData.biomechanicalEvaluation) {
      const bio = strokeData.biomechanicalEvaluation;
      baseContext.biomechanical = {
        overallScore: bio.overall,
        phaseScores: Object.fromEntries(
          Object.entries(bio.byPhase).map(([phase, data]) => [phase, Math.round(data.score)])
        ),
        detectedFaults: bio.detectedFaults.slice(0, 3).map(f => ({
          name: f.name,
          fix: f.fix
        })),
        primaryFeedback: bio.primaryFeedback,
        drillRecommendations: this.biomechanicalCheckpoints?.getDrillRecommendations(bio) || []
      };
    }

    // Add footwork analysis
    if (strokeData.footwork) {
      baseContext.footwork = strokeData.footwork;
    }

    // Add serve analysis
    if (strokeData.serveAnalysis) {
      baseContext.serveAnalysis = strokeData.serveAnalysis;
    }

    // Inject previous stroke's Gemini visual context (if available)
    if (typeof tennisAI !== 'undefined' && tennisAI.visualMerger) {
      const prevVisual = tennisAI.visualMerger.formatForNextStrokeContext();
      if (prevVisual) {
        baseContext.previousVisualContext = prevVisual;
      }
    }

    return baseContext;
  }

  getTrend() {
    const recent = this.sessionStats.scores.slice(-5);
    if (recent.length < 2) return 'stable';
    
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const prevAvg = this.sessionStats.scores.slice(-10, -5)
      .reduce((a, b) => a + b, 0) / 5;
    
    if (avg > prevAvg + 5) return 'improving';
    if (avg < prevAvg - 5) return 'declining';
    return 'stable';
  }
  
  getAverageScore() {
    if (this.sessionStats.scores.length === 0) return 0;
    return this.sessionStats.scores.reduce((a, b) => a + b, 0) / 
           this.sessionStats.scores.length;
  }
  
  getConsistency() {
    if (this.sessionStats.scores.length < 3) return 'N/A';
    
    const scores = this.sessionStats.scores;
    const avg = this.getAverageScore();
    const variance = scores.reduce((sum, score) => 
      sum + Math.pow(score - avg, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev < 10) return 'Excellent';
    if (stdDev < 15) return 'Good';
    return 'Needs Work';
  }
  
  updateUI(context) {
    // Update status bar
    document.getElementById('strokeCount').textContent = context.session.strokeCount;
    document.getElementById('avgScore').textContent = context.quality.overall.toFixed(0);
    document.getElementById('consistencyScore').textContent = context.session.consistency;

    // Update analysis card
    const strokeTypeText = context.strokeType.charAt(0).toUpperCase() +
                          context.strokeType.slice(1);
    document.getElementById('strokeType').textContent = strokeTypeText;
    document.getElementById('techniqueScore').textContent =
      `${context.quality.overall.toFixed(0)}/100`;

    // Update advanced metrics
    document.getElementById('elbowAngleMetric').textContent =
      `${context.technique.elbowAngleAtContact.toFixed(0)}°`;
    document.getElementById('hipSepMetric').textContent =
      `${context.technique.hipShoulderSeparation.toFixed(0)}°`;
    document.getElementById('stanceMetric').textContent = context.technique.stance;
    document.getElementById('weightMetric').textContent = context.technique.weightTransfer;

    // Show card
    const card = document.getElementById('analysisCard');
    card.classList.add('visible');
    setTimeout(() => {
      card.classList.remove('visible');
    }, 4000);

    // Update phase indicator
    const phaseIndicator = document.getElementById('phaseIndicator');
    if (phaseIndicator && context.sequenceAnalysis?.phaseDurations) {
      phaseIndicator.style.display = 'flex';
      const steps = phaseIndicator.querySelectorAll('.phase-step');
      const phases = ['preparation', 'loading', 'acceleration', 'contact', 'followThrough'];
      const durations = context.sequenceAnalysis.phaseDurations;
      steps.forEach((step, i) => {
        step.className = 'phase-step';
        // Contact phase has no explicit duration - it's always present if acceleration was detected
        const detected = phases[i] === 'contact'
          ? (durations.acceleration > 0)
          : (durations[phases[i]] > 0);
        if (detected) {
          step.classList.add('completed');
        }
      });
    }

    // Update fault and strength chips
    const faultChips = document.getElementById('faultChips');
    if (faultChips) {
      faultChips.innerHTML = '';
      // Strength chips
      const strengths = context.strengths || [];
      strengths.slice(0, 2).forEach(s => {
        const chip = document.createElement('span');
        chip.className = 'strength-chip';
        chip.textContent = s;
        faultChips.appendChild(chip);
      });
      // Fault chips
      const faults = context.biomechanical?.detectedFaults || [];
      faults.forEach(f => {
        const chip = document.createElement('span');
        chip.className = f.priority >= 8 ? 'fault-chip' : 'fault-chip low-priority';
        chip.textContent = f.name;
        faultChips.appendChild(chip);
      });
    }
  }
}