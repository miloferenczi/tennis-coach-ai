/**
 * Kalman Velocity Estimator
 * Constant-velocity Kalman filter for smooth velocity/acceleration estimation
 * from position-only MediaPipe measurements.
 *
 * State: [x, y, vx, vy]  (position + velocity)
 * Measurement: [x, y]     (position only)
 * Model: constant velocity with process noise
 *
 * All 4x4 matrix math is inline (no external library needed).
 */

class KalmanFilter2D {
    /**
     * @param {number} processNoise - Process noise variance (trust in constant-velocity model)
     * @param {number} measurementNoise - Measurement noise variance (MediaPipe noise)
     */
    constructor(processNoise = 0.001, measurementNoise = 0.01) {
        this.processNoise = processNoise;
        this.measurementNoise = measurementNoise;

        // State vector: [x, y, vx, vy]
        this.x = [0, 0, 0, 0];

        // State covariance matrix (4x4), start with high uncertainty
        this.P = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ];

        this.initialized = false;
        this.lastTimestamp = null;

        // Previous velocity for acceleration estimation
        this.prevVx = 0;
        this.prevVy = 0;
    }

    /**
     * Update with a new position measurement
     * @param {number} mx - Measured x position
     * @param {number} my - Measured y position
     * @param {number} timestamp - Timestamp in ms
     * @returns {{ x, y, vx, vy, speed, ax, ay, accelMag }}
     */
    update(mx, my, timestamp) {
        if (!this.initialized) {
            this.x = [mx, my, 0, 0];
            this.initialized = true;
            this.lastTimestamp = timestamp;
            return this._state(0);
        }

        // Time delta in seconds
        const dt = Math.max((timestamp - this.lastTimestamp) / 1000, 0.001);
        this.lastTimestamp = timestamp;

        // Save previous velocity for acceleration
        this.prevVx = this.x[2];
        this.prevVy = this.x[3];

        // === PREDICT ===
        // State transition: x' = F * x
        // F = [[1, 0, dt, 0],
        //      [0, 1, 0, dt],
        //      [0, 0, 1,  0],
        //      [0, 0, 0,  1]]
        const predicted = [
            this.x[0] + this.x[2] * dt,
            this.x[1] + this.x[3] * dt,
            this.x[2],
            this.x[3]
        ];

        // Predicted covariance: P' = F * P * F^T + Q
        const P = this.P;
        const q = this.processNoise;
        const dt2 = dt * dt;

        // F * P * F^T (expanded for constant-velocity model)
        const PP = [
            [
                P[0][0] + dt * (P[2][0] + P[0][2]) + dt2 * P[2][2],
                P[0][1] + dt * (P[2][1] + P[0][3]) + dt2 * P[2][3],
                P[0][2] + dt * P[2][2],
                P[0][3] + dt * P[2][3]
            ],
            [
                P[1][0] + dt * (P[3][0] + P[1][2]) + dt2 * P[3][2],
                P[1][1] + dt * (P[3][1] + P[1][3]) + dt2 * P[3][3],
                P[1][2] + dt * P[3][2],
                P[1][3] + dt * P[3][3]
            ],
            [
                P[2][0] + dt * P[2][2],
                P[2][1] + dt * P[2][3],
                P[2][2],
                P[2][3]
            ],
            [
                P[3][0] + dt * P[3][2],
                P[3][1] + dt * P[3][3],
                P[3][2],
                P[3][3]
            ]
        ];

        // Add process noise Q (scaled by dt for time-adaptive noise)
        // Q models acceleration uncertainty
        const dt3 = dt2 * dt;
        const dt4 = dt2 * dt2;
        PP[0][0] += q * dt4 / 4;
        PP[0][2] += q * dt3 / 2;
        PP[1][1] += q * dt4 / 4;
        PP[1][3] += q * dt3 / 2;
        PP[2][0] += q * dt3 / 2;
        PP[2][2] += q * dt2;
        PP[3][1] += q * dt3 / 2;
        PP[3][3] += q * dt2;

        // === UPDATE ===
        // Measurement matrix H = [[1,0,0,0],[0,1,0,0]]
        // Innovation: y = z - H * x'
        const innov = [mx - predicted[0], my - predicted[1]];

        // Innovation covariance: S = H * P' * H^T + R
        const r = this.measurementNoise;
        const S00 = PP[0][0] + r;
        const S01 = PP[0][1];
        const S10 = PP[1][0];
        const S11 = PP[1][1] + r;

        // Invert 2x2 S matrix
        const det = S00 * S11 - S01 * S10;
        if (Math.abs(det) < 1e-10) {
            // Degenerate — skip update
            this.x = predicted;
            this.P = PP;
            return this._state(dt);
        }
        const invDet = 1.0 / det;
        const Si00 = S11 * invDet;
        const Si01 = -S01 * invDet;
        const Si10 = -S10 * invDet;
        const Si11 = S00 * invDet;

        // Kalman gain: K = P' * H^T * S^-1 (4x2 matrix)
        // H^T columns are just [1,0,0,0] and [0,1,0,0]
        // So P' * H^T = first two columns of P'
        const K = [
            [PP[0][0] * Si00 + PP[0][1] * Si10, PP[0][0] * Si01 + PP[0][1] * Si11],
            [PP[1][0] * Si00 + PP[1][1] * Si10, PP[1][0] * Si01 + PP[1][1] * Si11],
            [PP[2][0] * Si00 + PP[2][1] * Si10, PP[2][0] * Si01 + PP[2][1] * Si11],
            [PP[3][0] * Si00 + PP[3][1] * Si10, PP[3][0] * Si01 + PP[3][1] * Si11]
        ];

        // Updated state: x = x' + K * y
        this.x = [
            predicted[0] + K[0][0] * innov[0] + K[0][1] * innov[1],
            predicted[1] + K[1][0] * innov[0] + K[1][1] * innov[1],
            predicted[2] + K[2][0] * innov[0] + K[2][1] * innov[1],
            predicted[3] + K[3][0] * innov[0] + K[3][1] * innov[1]
        ];

        // Updated covariance: P = (I - K * H) * P'
        // K*H is 4x4: row i = [K[i][0], K[i][1], 0, 0]
        this.P = [
            [
                (1 - K[0][0]) * PP[0][0] - K[0][1] * PP[1][0],
                (1 - K[0][0]) * PP[0][1] - K[0][1] * PP[1][1],
                (1 - K[0][0]) * PP[0][2] - K[0][1] * PP[1][2],
                (1 - K[0][0]) * PP[0][3] - K[0][1] * PP[1][3]
            ],
            [
                -K[1][0] * PP[0][0] + (1 - K[1][1]) * PP[1][0],
                -K[1][0] * PP[0][1] + (1 - K[1][1]) * PP[1][1],
                -K[1][0] * PP[0][2] + (1 - K[1][1]) * PP[1][2],
                -K[1][0] * PP[0][3] + (1 - K[1][1]) * PP[1][3]
            ],
            [
                -K[2][0] * PP[0][0] - K[2][1] * PP[1][0] + PP[2][0],
                -K[2][0] * PP[0][1] - K[2][1] * PP[1][1] + PP[2][1],
                -K[2][0] * PP[0][2] - K[2][1] * PP[1][2] + PP[2][2],
                -K[2][0] * PP[0][3] - K[2][1] * PP[1][3] + PP[2][3]
            ],
            [
                -K[3][0] * PP[0][0] - K[3][1] * PP[1][0] + PP[3][0],
                -K[3][0] * PP[0][1] - K[3][1] * PP[1][1] + PP[3][1],
                -K[3][0] * PP[0][2] - K[3][1] * PP[1][2] + PP[3][2],
                -K[3][0] * PP[0][3] - K[3][1] * PP[1][3] + PP[3][3]
            ]
        ];

        return this._state(dt);
    }

    _state(dt) {
        const vx = this.x[2];
        const vy = this.x[3];
        const speed = Math.sqrt(vx * vx + vy * vy);

        // Acceleration from velocity change (already smoothed by Kalman)
        let ax = 0, ay = 0;
        if (dt > 0) {
            ax = (vx - this.prevVx) / dt;
            ay = (vy - this.prevVy) / dt;
        }
        const accelMag = Math.sqrt(ax * ax + ay * ay);

        return { x: this.x[0], y: this.x[1], vx, vy, speed, ax, ay, accelMag };
    }

    reset() {
        this.x = [0, 0, 0, 0];
        this.P = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ];
        this.initialized = false;
        this.lastTimestamp = null;
        this.prevVx = 0;
        this.prevVy = 0;
    }
}

// The 13 joints we track with Kalman filters
const KALMAN_JOINTS = [
    'leftShoulder', 'rightShoulder',
    'leftElbow', 'rightElbow',
    'leftWrist', 'rightWrist',
    'leftHip', 'rightHip',
    'nose',
    'rightKnee', 'rightAnkle',
    'leftKnee', 'leftAnkle'
];

// Map joint names to MediaPipe landmark indices
const JOINT_TO_LANDMARK = {
    nose: 0,
    leftShoulder: 11, rightShoulder: 12,
    leftElbow: 13, rightElbow: 14,
    leftWrist: 15, rightWrist: 16,
    leftHip: 23, rightHip: 24,
    leftKnee: 25, rightKnee: 26,
    leftAnkle: 27, rightAnkle: 28
};

class KalmanVelocityEstimator {
    /**
     * @param {Object} options
     * @param {number} options.processNoise - Process noise variance
     * @param {number} options.measurementNoise - Measurement noise variance
     * @param {string[]} options.joints - Joint names to track
     */
    constructor({
        processNoise = 0.001,
        measurementNoise = 0.01,
        joints = KALMAN_JOINTS
    } = {}) {
        this.joints = joints;
        this.filters = {};
        for (const joint of joints) {
            this.filters[joint] = new KalmanFilter2D(processNoise, measurementNoise);
        }
    }

    /**
     * Update all joint filters with new positions
     * @param {Object} joints - Joint positions from extractJointPositions() (e.g. { rightWrist: {x,y}, ... })
     * @param {number} timestamp - Frame timestamp in ms
     * @returns {Object} Kalman estimates keyed by joint name
     */
    update(joints, timestamp) {
        const estimates = {};

        for (const jointName of this.joints) {
            const pos = joints[jointName];
            if (!pos || pos.x === undefined || pos.y === undefined) continue;

            estimates[jointName] = this.filters[jointName].update(pos.x, pos.y, timestamp);
        }

        return estimates;
    }

    /**
     * Get current velocity for a specific joint
     * @param {string} jointName
     * @returns {{ vx, vy, speed } | null}
     */
    getVelocity(jointName) {
        const f = this.filters[jointName];
        if (!f || !f.initialized) return null;
        return { vx: f.x[2], vy: f.x[3], speed: Math.sqrt(f.x[2] ** 2 + f.x[3] ** 2) };
    }

    /**
     * Get current acceleration for a specific joint
     * @param {string} jointName
     * @returns {{ ax, ay, magnitude } | null}
     */
    getAcceleration(jointName) {
        const f = this.filters[jointName];
        if (!f || !f.initialized) return null;
        // Use stored prev velocity and current velocity
        const vx = f.x[2];
        const vy = f.x[3];
        const ax = vx - f.prevVx;
        const ay = vy - f.prevVy;
        return { ax, ay, magnitude: Math.sqrt(ax * ax + ay * ay) };
    }

    /**
     * Reset all filters
     */
    reset() {
        for (const joint of this.joints) {
            this.filters[joint].reset();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KalmanFilter2D, KalmanVelocityEstimator, KALMAN_JOINTS, JOINT_TO_LANDMARK };
} else {
    window.KalmanFilter2D = KalmanFilter2D;
    window.KalmanVelocityEstimator = KalmanVelocityEstimator;
    window.KALMAN_JOINTS = KALMAN_JOINTS;
    window.JOINT_TO_LANDMARK = JOINT_TO_LANDMARK;
}
