/**
 * Signal Filters for Pose Data Quality
 * One Euro Filter (adaptive low-pass) + Bone-Length Constraints
 *
 * Smooths MediaPipe landmark positions while preserving fast motion responsiveness.
 * Reduces jitter in velocity/acceleration estimates that feed stroke classification,
 * phase detection, and biomechanical evaluation.
 */

class LowPassFilter {
    constructor(alpha) {
        this.alpha = alpha;
        this.initialized = false;
        this.value = 0;
    }

    filter(value, alpha) {
        if (alpha !== undefined) {
            this.alpha = alpha;
        }
        if (!this.initialized) {
            this.value = value;
            this.initialized = true;
            return value;
        }
        this.value = this.alpha * value + (1 - this.alpha) * this.value;
        return this.value;
    }

    reset() {
        this.initialized = false;
        this.value = 0;
    }

    lastValue() {
        return this.value;
    }
}

class OneEuroFilter {
    /**
     * @param {number} frequency - Expected signal frequency (Hz)
     * @param {number} minCutoff - Minimum cutoff frequency (lower = more smoothing at rest)
     * @param {number} beta - Speed coefficient (higher = less lag during fast motion)
     * @param {number} dCutoff - Cutoff frequency for derivative filtering
     */
    constructor(frequency, minCutoff, beta, dCutoff) {
        this.frequency = frequency;
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;

        this.xFilter = new LowPassFilter(this._alpha(minCutoff));
        this.dxFilter = new LowPassFilter(this._alpha(dCutoff));
        this.lastTime = null;
    }

    _alpha(cutoff) {
        const te = 1.0 / this.frequency;
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / te);
    }

    filter(value, timestamp) {
        // Update frequency from timestamps if available
        if (this.lastTime !== null && timestamp !== undefined) {
            const dt = (timestamp - this.lastTime) / 1000; // ms to seconds
            if (dt > 0 && dt < 1) { // Sanity check: between 0 and 1 second
                this.frequency = 1.0 / dt;
            }
        }
        this.lastTime = timestamp;

        // Estimate derivative
        const prevValue = this.xFilter.lastValue();
        const dx = this.xFilter.initialized
            ? (value - prevValue) * this.frequency
            : 0;

        // Filter derivative
        const edx = this.dxFilter.filter(dx, this._alpha(this.dCutoff));

        // Adaptive cutoff based on speed
        const cutoff = this.minCutoff + this.beta * Math.abs(edx);

        // Filter value with adaptive alpha
        return this.xFilter.filter(value, this._alpha(cutoff));
    }

    reset() {
        this.xFilter.reset();
        this.dxFilter.reset();
        this.lastTime = null;
    }
}

// Bone definitions: pairs of MediaPipe landmark indices + readable name
const BONE_DEFINITIONS = [
    { name: 'leftUpperArm',  from: 11, to: 13 },  // left shoulder → left elbow
    { name: 'leftForearm',   from: 13, to: 15 },  // left elbow → left wrist
    { name: 'rightUpperArm', from: 12, to: 14 },  // right shoulder → right elbow
    { name: 'rightForearm',  from: 14, to: 16 },  // right elbow → right wrist
    { name: 'leftThigh',     from: 23, to: 25 },  // left hip → left knee
    { name: 'leftShin',      from: 25, to: 27 },  // left knee → left ankle
    { name: 'rightThigh',    from: 24, to: 26 },  // right hip → right knee
    { name: 'rightShin',     from: 26, to: 28 },  // right knee → right ankle
];

class LandmarkFilter {
    /**
     * @param {Object} options
     * @param {number} options.frequency - Expected frame rate (Hz)
     * @param {number} options.minCutoff - Minimum cutoff (lower = more smoothing at rest)
     * @param {number} options.beta - Speed coefficient (higher = less lag during fast motion)
     * @param {number} options.dCutoff - Derivative cutoff frequency
     * @param {boolean} options.enableBoneConstraints - Whether to enforce bone-length constraints
     * @param {number} options.boneDeviationThreshold - Max relative deviation before correction (0-1)
     * @param {number} options.calibrationFrames - Frames to collect for bone calibration
     */
    constructor({
        frequency = 30,
        minCutoff = 1.0,
        beta = 80.0,
        dCutoff = 1.0,
        enableBoneConstraints = true,
        boneDeviationThreshold = 0.15,
        calibrationFrames = 30
    } = {}) {
        this.frequency = frequency;
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.enableBoneConstraints = enableBoneConstraints;
        this.boneDeviationThreshold = boneDeviationThreshold;
        this.calibrationFrames = calibrationFrames;

        // 33 landmarks x 3 axes (x, y, z) = 99 One Euro filters
        this.filters = [];
        for (let i = 0; i < 33; i++) {
            this.filters.push({
                x: new OneEuroFilter(frequency, minCutoff, beta, dCutoff),
                y: new OneEuroFilter(frequency, minCutoff, beta, dCutoff),
                z: new OneEuroFilter(frequency, minCutoff, beta, dCutoff)
            });
        }

        // Bone constraint calibration
        this.boneLengths = {}; // median bone lengths after calibration
        this.boneSamples = {}; // samples during calibration
        this.calibrated = false;
        this.frameCount = 0;

        for (const bone of BONE_DEFINITIONS) {
            this.boneSamples[bone.name] = [];
        }
    }

    /**
     * Filter a full set of 33 landmarks
     * @param {Array} landmarks - MediaPipe pose landmarks (33 points, each {x, y, z, visibility})
     * @param {number} timestamp - Frame timestamp in ms
     * @returns {Array} Filtered landmarks (same shape as input)
     */
    filterLandmarks(landmarks, timestamp) {
        if (!landmarks || landmarks.length < 33) {
            return landmarks;
        }

        this.frameCount++;

        // Step 1: Apply One Euro filter to each coordinate
        const filtered = landmarks.map((lm, i) => ({
            x: this.filters[i].x.filter(lm.x, timestamp),
            y: this.filters[i].y.filter(lm.y, timestamp),
            z: this.filters[i].z.filter(lm.z || 0, timestamp),
            visibility: lm.visibility
        }));

        // Step 2: Bone-length constraints
        if (this.enableBoneConstraints) {
            if (!this.calibrated) {
                this._calibrateBones(filtered);
            } else {
                this._enforceBoneConstraints(filtered);
            }
        }

        return filtered;
    }

    /**
     * Collect bone-length samples during calibration period
     */
    _calibrateBones(landmarks) {
        for (const bone of BONE_DEFINITIONS) {
            const from = landmarks[bone.from];
            const to = landmarks[bone.to];
            if (from.visibility < 0.5 || to.visibility < 0.5) continue;

            const length = this._boneLength(from, to);
            if (length > 0.001) { // Skip degenerate measurements
                this.boneSamples[bone.name].push(length);
            }
        }

        if (this.frameCount >= this.calibrationFrames) {
            // Calculate median bone lengths
            for (const bone of BONE_DEFINITIONS) {
                const samples = this.boneSamples[bone.name];
                if (samples.length >= 10) {
                    samples.sort((a, b) => a - b);
                    this.boneLengths[bone.name] = samples[Math.floor(samples.length / 2)];
                }
            }
            this.calibrated = true;
            this.boneSamples = {}; // Free memory
            console.log('LandmarkFilter: Bone calibration complete', this.boneLengths);
        }
    }

    /**
     * Enforce bone-length constraints via soft correction
     * If a bone deviates >threshold from calibrated length, pull endpoints proportionally
     */
    _enforceBoneConstraints(landmarks) {
        for (const bone of BONE_DEFINITIONS) {
            const medianLength = this.boneLengths[bone.name];
            if (!medianLength) continue;

            const from = landmarks[bone.from];
            const to = landmarks[bone.to];

            // Skip low-visibility landmarks
            if (from.visibility < 0.5 || to.visibility < 0.5) continue;

            const currentLength = this._boneLength(from, to);
            if (currentLength < 0.001) continue;

            const deviation = Math.abs(currentLength - medianLength) / medianLength;
            if (deviation <= this.boneDeviationThreshold) continue;

            // Soft correction: move each endpoint 50% of the excess
            const scale = medianLength / currentLength;
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            const midZ = (from.z + to.z) / 2;

            // Blend toward corrected position (proportional to deviation beyond threshold)
            const correctionStrength = Math.min(
                (deviation - this.boneDeviationThreshold) / this.boneDeviationThreshold,
                1.0
            ) * 0.5; // Max 50% correction per frame

            const correctedFromX = midX + (from.x - midX) * scale;
            const correctedFromY = midY + (from.y - midY) * scale;
            const correctedFromZ = midZ + (from.z - midZ) * scale;
            const correctedToX = midX + (to.x - midX) * scale;
            const correctedToY = midY + (to.y - midY) * scale;
            const correctedToZ = midZ + (to.z - midZ) * scale;

            from.x += (correctedFromX - from.x) * correctionStrength;
            from.y += (correctedFromY - from.y) * correctionStrength;
            from.z += (correctedFromZ - from.z) * correctionStrength;
            to.x += (correctedToX - to.x) * correctionStrength;
            to.y += (correctedToY - to.y) * correctionStrength;
            to.z += (correctedToZ - to.z) * correctionStrength;
        }
    }

    /**
     * Euclidean distance between two 3D points
     */
    _boneLength(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Reset all filters and bone calibration
     */
    reset() {
        for (const f of this.filters) {
            f.x.reset();
            f.y.reset();
            f.z.reset();
        }
        this.boneLengths = {};
        this.boneSamples = {};
        this.calibrated = false;
        this.frameCount = 0;
        for (const bone of BONE_DEFINITIONS) {
            this.boneSamples[bone.name] = [];
        }
    }

    /**
     * Whether bone calibration is complete
     */
    isCalibrated() {
        return this.calibrated;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LowPassFilter, OneEuroFilter, LandmarkFilter };
} else {
    window.LowPassFilter = LowPassFilter;
    window.OneEuroFilter = OneEuroFilter;
    window.LandmarkFilter = LandmarkFilter;
}
