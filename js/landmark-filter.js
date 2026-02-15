/**
 * Landmark Visibility Utility
 *
 * MediaPipe Pose landmarks include a `visibility` score (0-1) indicating
 * how confident the model is that the landmark is visible in the frame.
 * Low-visibility landmarks produce unreliable positions and should be
 * excluded from biomechanical calculations.
 *
 * Usage:
 *   if (isLandmarkVisible(landmarks[16])) { ... }
 *   if (areLandmarksVisible(landmarks, [11, 12, 23, 24])) { ... }
 */

/**
 * Check if a single MediaPipe landmark has sufficient visibility.
 * @param {object} landmark - MediaPipe landmark with .visibility property
 * @param {number} [threshold=0.5] - Minimum visibility score (0-1)
 * @returns {boolean}
 */
function isLandmarkVisible(landmark, threshold = 0.5) {
  if (!landmark) return false;
  // Some landmarks may lack a visibility property (e.g. synthetic data);
  // treat missing visibility as visible to avoid breaking existing flows.
  if (landmark.visibility === undefined || landmark.visibility === null) return true;
  return landmark.visibility >= threshold;
}

/**
 * Check if ALL specified landmarks are visible.
 * @param {Array} landmarks - Full 33-landmark array from MediaPipe
 * @param {number[]} indices - Array of landmark indices to check
 * @param {number} [threshold=0.5] - Minimum visibility score
 * @returns {boolean}
 */
function areLandmarksVisible(landmarks, indices, threshold = 0.5) {
  if (!landmarks) return false;
  for (const idx of indices) {
    if (!isLandmarkVisible(landmarks[idx], threshold)) return false;
  }
  return true;
}

/**
 * Check if ANY of the specified landmarks are visible.
 * @param {Array} landmarks - Full 33-landmark array from MediaPipe
 * @param {number[]} indices - Array of landmark indices to check
 * @param {number} [threshold=0.5] - Minimum visibility score
 * @returns {boolean}
 */
function anyLandmarkVisible(landmarks, indices, threshold = 0.5) {
  if (!landmarks) return false;
  for (const idx of indices) {
    if (isLandmarkVisible(landmarks[idx], threshold)) return true;
  }
  return false;
}

// Export for browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isLandmarkVisible, areLandmarksVisible, anyLandmarkVisible };
} else {
  window.isLandmarkVisible = isLandmarkVisible;
  window.areLandmarksVisible = areLandmarksVisible;
  window.anyLandmarkVisible = anyLandmarkVisible;
}
