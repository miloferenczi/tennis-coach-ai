# **AI Tennis Coach MVP \- Phase Checklist**

## **Phase 1: Foundation (Week 1-2)**

**Goal: Reliable pose tracking \+ GPT voice coaching**

### **Step 1.1: Clean Up Codebase**

*  Remove all ball detection code from API and frontend  
*  Remove all court detection code from API and frontend  
*  Delete court/ball UI status indicators  
*  Test that app runs with only MediaPipe pose tracking  
*  Verify canvas shows clean pose overlay on video feed

### **Step 1.2: Rich Pose Data Logging**

*  Calculate and store all 33 MediaPipe landmarks with timestamps  
*  Track key joint positions (wrists, elbows, shoulders, hips, knees, ankles)  
*  Calculate critical angles (elbow, shoulder rotation, hip-shoulder separation, knee bend)  
*  Measure velocities of key joints (wrist, hip, shoulder)  
*  Detect footwork patterns (stance type, weight transfer, base width)  
*  Store 2 seconds of pose history (60 frames)  
*  Detect when a stroke pattern completes (peak wrist velocity)  
*  Build comprehensive stroke data package including preparation, contact, and follow-through phases  
*  Score each stroke based on swing plane, hip-shoulder separation, stance, and weight transfer  
*  Display basic metrics in UI (stroke count, average score, consistency)

### **Step 1.3: GPT Voice Coach Integration**

*  Create API key input screen for users to enter OpenAI key  
*  Initialize OpenAI Realtime API connection with GPT-4o voice model  
*  Set up WebSocket connection for real-time audio streaming  
*  Write coaching instructions for GPT (20 years experience, direct, actionable, under 15 seconds)  
*  Format stroke data into natural language prompts for GPT  
*  Handle incoming audio responses from GPT and play through speakers  
*  Build fallback to browser speech synthesis if GPT unavailable  
*  Test that GPT provides specific, actionable feedback after each stroke  
*  Verify audio plays smoothly without lag

### **Step 1.4: Visual Feedback Enhancement**

*  Draw swing path trail on canvas (wrist movement over last 2 seconds)  
*  Use gradient opacity so recent positions are brighter  
*  Draw stance guide showing base width between feet  
*  Flash screen border color based on stroke quality (green=great, orange=good, red=needs work)  
*  Ensure visual feedback doesn't obscure pose skeleton  
*  Test that visuals enhance rather than distract from coaching

---

## **Phase 2: Session Intelligence (Week 3-4)**

**Goal: Track progress and adapt coaching**

### **Step 2.1: Persistent Session Storage**

*  Create session data structure with unique ID, start time, stroke array, and metrics  
*  Store each stroke with timestamp, type, quality, technique details, and swing path  
*  Track session metrics: total strokes, average quality, best/worst strokes, stroke type distribution  
*  Calculate running consistency score based on standard deviation  
*  Detect when player improves (compare last 5 strokes vs previous 5\)  
*  Have GPT verbally celebrate improvements when detected  
*  Generate end-of-session summary with duration, totals, best stroke, consistency rating  
*  Identify dominant stroke type from session  
*  Analyze most common technical weakness across all strokes  
*  Provide specific drill recommendation based on weakness patterns  
*  Store session history across multiple practice sessions  
*  Display session history in analytics modal

### **Step 2.2: Practice Mode vs Analysis Mode**

*  Create two distinct UI modes users can switch between  
*  **Practice Mode (live)**: Continuous real-time audio feedback after each point.  
*  **Practice Mode**: On-screen session stats updating live  
*  **Practice Mode**: Encouraging messages when streaks or improvements detected  
*  **Practice Mode**: No video controls, just start/stop coaching  
*  **Analysis Mode (video upload)**: Upload pre-recorded tennis video  
*  **Analysis Mode**: Scrub through video frame-by-frame  
*  **Analysis Mode**: See all detected strokes marked on timeline  
*  **Analysis Mode**: Click any stroke to see detailed breakdown  
*  **Analysis Mode**: Compare two strokes side-by-side  
*  **Analysis Mode**: Export highlight reel of best 5 strokes  
*  **Analysis Mode**: Export blooper reel of worst 5 strokes for learning  
*  Test both modes work independently and user can switch seamlessly

### **Step 2.3: Adaptive Coaching**

*  Track which technical aspects GPT has mentioned recently  
*  Avoid repeating the same feedback unless issue persists  
*  Escalate feedback if player ignores repeated advice (3+ times)  
*  Reference previous sessions ("last time we worked on rotation...")  
*  Set session goals based on past weaknesses  
*  Detect fatigue by tracking quality decline over time  
*  Adjust coaching tone when fatigue detected (more encouraging, simpler cues)  
*  Celebrate when player fixes a previously identified weakness  
*  Build "player profile" with strengths and weaknesses over multiple sessions  
*  Test that coaching feels progressive and personalized, not robotic

---

## **Phase 3: Composable Architecture (Week 5-6)**

**Goal: Prove it works for multiple sports**

### **Step 3.1: Sport-Agnostic Core**

*  Extract tennis-specific logic into config file  
*  Create universal MovementAnalyzer class that works for any sport  
*  Define sport config structure: name, key points to track, scoring function, feedback function  
*  Build TennisConfig with forehand/backhand specific rules  
*  Build GolfConfig with swing plane and hip-shoulder separation rules  
*  Build BoxingConfig with punch speed and guard position rules  
*  Build WeightliftingConfig with bar path and depth rules  
*  Test switching between sports without reloading app  
*  Verify pose tracking works identically across all sports  
*  Confirm GPT coaching adapts to each sport's terminology

### **Step 3.2: Sport Switcher UI**

*  Add dropdown menu to select current sport  
*  Update UI labels/icons when sport changes  
*  Load appropriate sport config when selected  
*  Adjust GPT coaching instructions per sport  
*  Show sport-specific metrics in analysis card  
*  Save user's preferred sport in session storage  
*  Test that switching mid-session doesn't break anything  
*  Verify analytics stay separate per sport

### **Step 3.3: Golf Implementation (Proof of Concept)**

*  Define golf swing phases: address, backswing, downswing, impact, follow-through  
*  Track club path (hands as proxy for club)  
*  Measure hip-shoulder separation during backswing  
*  Calculate swing plane angle  
*  Detect common golf faults (over-the-top, early extension, chicken wing)  
*  Write golf-specific GPT coaching instructions  
*  Test with sample golf swing videos  
*  Confirm coaching feedback sounds like a golf pro, not tennis coach  
*  Validate that golf works as well as tennis

---

## **Phase 4: "Wow" Features (Week 7-8)**

**Goal: Differentiation and delight**

### **Step 4.1: Ghost Overlay**

*  Record user's best stroke of current session (highest quality score)  
*  Save the full pose landmark sequence of best stroke  
*  Draw best stroke as semi-transparent "ghost" overlay during live practice  
*  User can see exactly where their body should be at each phase  
*  Calculate similarity score between current stroke and ghost (0-100%)  
*  Display similarity score in real-time during swing  
*  Allow user to lock any past stroke as ghost reference  
*  Test that ghost doesn't interfere with seeing current pose  
*  Verify ghost helps users replicate good form

### **Step 4.2: Pro Comparison Library**

*  Record professional stroke sequences (use public tennis footage)  
*  Store Federer forehand, Djokovic backhand, Serena serve, etc.  
*  Allow user to select a pro to compare against  
*  Calculate technique similarity percentage to pro  
*  Show side-by-side comparison: user vs pro at each phase  
*  Highlight specific differences (e.g., "Pro's hip rotation is 20° more")  
*  GPT explains what makes the pro's technique different  
*  Build library with at least 5 pro strokes for tennis  
*  Test that comparisons are meaningful and motivating

### **Step 4.3: Challenge Mode (Gamification)**

*  Define challenge structure: name, goal criteria, reward  
*  Create "Consistency King" challenge: 10 forehands above 80 quality  
*  Create "Topspin Master" challenge: 5 strokes with 45°+ swing plane  
*  Create "Rotation Pro" challenge: 5 strokes with 40°+ hip-shoulder separation  
*  Track challenge progress in UI  
*  Show progress bar for active challenge  
*  Celebrate when challenge completed with animation and sound  
*  Unlock new features as rewards (pro comparisons, advanced analytics)  
*  Save completed challenges to player profile  
*  Test that challenges motivate without feeling grindy

### **Step 4.4: AirPods Integration (The Moat)**

*  Research Web Bluetooth API for audio routing  
*  Detect if AirPods are connected to device  
*  Route GPT voice specifically to AirPods (not phone speaker)  
*  Test hands-free coaching experience (no screen needed)  
*  Verify audio latency is acceptable for real-time coaching  
*  Add "coaching in ear" mode toggle in settings  
*  Test on actual tennis court with AirPods  
*  Confirm this feels like having a pro coach courtside  
*  Document setup instructions for users

---

## **Pre-Launch Polish (Week 8\)**

*  Full end-to-end testing of all features  
*  Fix any visual glitches or UI jank  
*  Optimize performance (should run smoothly on iPhone 12+)  
*  Write user onboarding flow (first-time experience)  
*  Create demo video showing key features  
*  Write README with setup instructions  
*  Test with 3-5 beta users, collect feedback  
*  Implement top 3 user requests if time allows  
*  Prepare launch plan (how will first 10 users find it?)

---

## **Success Criteria for MVP**

**Must achieve:**

* User can practice tennis and get real-time voice feedback within 30 seconds of opening app  
* GPT coaching feels personal and actually helps improve technique  
* Session tracking shows clear progress over multiple practices  
* Works reliably in good lighting conditions  
* At least one beta user says "this is actually useful"

**Nice to have:**

* Ghost overlay feels magical  
* Pro comparison motivates users  
* Works for golf as well as tennis  
* AirPods integration is seamless

**Explicitly not required for MVP:**

  
* Social features  
* User accounts  
* Payment processing  
* Professional-grade accuracy  
* Works in all lighting conditions  
* Mobile app (PWA is fine)

