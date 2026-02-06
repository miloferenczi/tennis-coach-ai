/**
 * Physics Analyzer Module
 * Handles velocity, acceleration, and motion calculations for tennis stroke analysis
 */

class PhysicsAnalyzer {
    constructor() {
        this.positionHistory = [];
        this.maxHistoryLength = 30; // Keep 1 second of data at 30fps
        this.frameRate = 30;
    }

    /**
     * Add new pose data and return whether we have enough data for analysis
     */
    addPoseData(landmarks, timestamp) {
        const keyPoints = this.extractKeyPoints(landmarks);
        
        this.positionHistory.push({
            timestamp: timestamp,
            keyPoints: keyPoints
        });

        // Keep only recent history
        if (this.positionHistory.length > this.maxHistoryLength) {
            this.positionHistory.shift();
        }

        // Need at least 3 frames for velocity calculation
        return this.positionHistory.length >= 3;
    }

    /**
     * Extract key anatomical points from MediaPipe landmarks
     */
    extractKeyPoints(landmarks) {
        return {
            leftShoulder: landmarks[11],
            rightShoulder: landmarks[12],
            leftElbow: landmarks[13],
            rightElbow: landmarks[14],
            leftWrist: landmarks[15],
            rightWrist: landmarks[16],
            leftHip: landmarks[23],
            rightHip: landmarks[24],
            nose: landmarks[0]
        };
    }

    /**
     * Calculate wrist velocity (primary indicator of racquet speed)
     */
    calculateWristVelocity() {
        if (this.positionHistory.length < 3) {
            return { magnitude: 0, components: { x: 0, y: 0 }, direction: 0 };
        }

        const current = this.positionHistory[this.positionHistory.length - 1];
        const previous = this.positionHistory[this.positionHistory.length - 3];

        // Calculate velocity for both wrists
        const rightVel = this.getPointVelocity(
            current.keyPoints.rightWrist, 
            previous.keyPoints.rightWrist,
            current.timestamp - previous.timestamp
        );
        
        const leftVel = this.getPointVelocity(
            current.keyPoints.leftWrist, 
            previous.keyPoints.leftWrist,
            current.timestamp - previous.timestamp
        );

        // Return the higher velocity (dominant hand)
        return rightVel.magnitude > leftVel.magnitude ? rightVel : leftVel;
    }

    /**
     * Calculate velocity between two points
     */
    getPointVelocity(current, previous, deltaTime) {
        if (!current || !previous || deltaTime === 0) {
            return { magnitude: 0, components: { x: 0, y: 0 }, direction: 0 };
        }

        const dt = deltaTime / 1000; // Convert to seconds
        const dx = (current.x - previous.x) / dt;
        const dy = (current.y - previous.y) / dt;
        
        return {
            magnitude: Math.sqrt(dx * dx + dy * dy),
            components: { x: dx, y: dy },
            direction: Math.atan2(dy, dx)
        };
    }

    /**
     * Calculate acceleration from velocity changes
     */
    calculateAcceleration() {
        if (this.positionHistory.length < 5) {
            return { magnitude: 0, components: { x: 0, y: 0 } };
        }

        const velocities = [];
        
        // Calculate velocities for last 3 data points
        for (let i = this.positionHistory.length - 3; i < this.positionHistory.length; i++) {
            if (i >= 2) {
                const current = this.positionHistory[i];
                const previous = this.positionHistory[i - 2];
                
                const rightWrist = current.keyPoints.rightWrist;
                const prevRightWrist = previous.keyPoints.rightWrist;
                
                if (rightWrist && prevRightWrist) {
                    const velocity = this.getPointVelocity(
                        rightWrist, 
                        prevRightWrist,
                        current.timestamp - previous.timestamp
                    );
                    velocities.push({
                        ...velocity,
                        timestamp: current.timestamp
                    });
                }
            }
        }

        if (velocities.length < 2) {
            return { magnitude: 0, components: { x: 0, y: 0 } };
        }

        // Calculate acceleration from velocity change
        const current = velocities[velocities.length - 1];
        const previous = velocities[velocities.length - 2];
        
        const dt = (current.timestamp - previous.timestamp) / 1000;
        if (dt === 0) return { magnitude: 0, components: { x: 0, y: 0 } };
        
        const dvx = current.components.x - previous.components.x;
        const dvy = current.components.y - previous.components.y;

        return {
            magnitude: Math.sqrt(dvx * dvx + dvy * dvy) / dt,
            components: { 
                x: dvx / dt, 
                y: dvy / dt 
            }
        };
    }

    /**
     * Calculate body rotation from shoulder angle changes
     */
    calculateBodyRotation() {
        if (this.positionHistory.length < 5) return 0;

        const current = this.positionHistory[this.positionHistory.length - 1];
        const previous = this.positionHistory[this.positionHistory.length - 5];

        const currentAngle = this.getShoulderAngle(current.keyPoints);
        const previousAngle = this.getShoulderAngle(previous.keyPoints);

        let angleDiff = currentAngle - previousAngle;
        
        // Normalize angle difference to [-π, π]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        return angleDiff * (180 / Math.PI); // Convert to degrees
    }

    /**
     * Get shoulder line angle
     */
    getShoulderAngle(keyPoints) {
        if (!keyPoints.leftShoulder || !keyPoints.rightShoulder) return 0;
        
        return Math.atan2(
            keyPoints.rightShoulder.y - keyPoints.leftShoulder.y,
            keyPoints.rightShoulder.x - keyPoints.leftShoulder.x
        );
    }

    /**
     * Calculate vertical motion range
     */
    calculateVerticalMotion() {
        if (this.positionHistory.length < 8) return 0;

        const recent = this.positionHistory.slice(-8);
        let maxY = -Infinity, minY = Infinity;

        recent.forEach(pose => {
            const wrist = pose.keyPoints.rightWrist || pose.keyPoints.leftWrist;
            if (wrist) {
                maxY = Math.max(maxY, wrist.y);
                minY = Math.min(minY, wrist.y);
            }
        });

        return maxY !== -Infinity ? maxY - minY : 0;
    }

    /**
     * Extract swing path for visualization
     */
    extractSwingPath(length = 15) {
        if (this.positionHistory.length < length) {
            return this.positionHistory.map(p => ({
                x: p.keyPoints.rightWrist?.x || 0,
                y: p.keyPoints.rightWrist?.y || 0,
                timestamp: p.timestamp
            }));
        }

        return this.positionHistory.slice(-length).map(p => ({
            x: p.keyPoints.rightWrist?.x || 0,
            y: p.keyPoints.rightWrist?.y || 0,
            timestamp: p.timestamp
        }));
    }

    /**
     * Calculate swing path smoothness
     */
    calculatePathSmoothness(pathPoints) {
        if (pathPoints.length < 3) return 100;
        
        let totalVariation = 0;
        for (let i = 1; i < pathPoints.length - 1; i++) {
            const angle1 = Math.atan2(
                pathPoints[i].y - pathPoints[i-1].y, 
                pathPoints[i].x - pathPoints[i-1].x
            );
            const angle2 = Math.atan2(
                pathPoints[i+1].y - pathPoints[i].y, 
                pathPoints[i+1].x - pathPoints[i].x
            );
            
            let angleDiff = Math.abs(angle2 - angle1);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            totalVariation += angleDiff;
        }
        
        // Convert to 0-100 smoothness score
        const avgVariation = totalVariation / (pathPoints.length - 2);
        return Math.max(0, 100 - (avgVariation * 50));
    }

    /**
     * Get dominant wrist position
     */
    getDominantWrist() {
        if (this.positionHistory.length === 0) return null;
        
        const latest = this.positionHistory[this.positionHistory.length - 1];
        
        // Assume right-handed for now (could be made configurable)
        return latest.keyPoints.rightWrist;
    }

    /**
     * Reset analyzer state
     */
    reset() {
        this.positionHistory = [];
    }

    /**
     * Get current analysis state
     */
    getState() {
        return {
            historyLength: this.positionHistory.length,
            hasEnoughData: this.positionHistory.length >= 3,
            oldestTimestamp: this.positionHistory.length > 0 ? this.positionHistory[0].timestamp : null,
            newestTimestamp: this.positionHistory.length > 0 ? this.positionHistory[this.positionHistory.length - 1].timestamp : null
        };
    }
}

// Export for browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PhysicsAnalyzer;
} else {
    window.PhysicsAnalyzer = PhysicsAnalyzer;
}