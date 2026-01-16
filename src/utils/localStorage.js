/**
 * LocalStorage utilities for draft persistence
 */

const STORAGE_KEY = 'x-thread-draft-autosave';

/**
 * Saves draft to localStorage
 * @param {Object} draft - Draft object to save
 */
export function saveDraftToLocalStorage(draft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch (error) {
    // Handle quota exceeded error or other storage errors
    console.warn('Failed to save draft to localStorage:', error);
    // Try to clear old data and retry
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch (retryError) {
      console.error('Failed to save draft after retry:', retryError);
    }
  }
}

/**
 * Loads draft from localStorage
 * @returns {Object|null} - Draft object or null if not found
 */
export function loadDraftFromLocalStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn('Failed to load draft from localStorage:', error);
  }
  return null;
}

/**
 * Clears draft from localStorage
 */
export function clearDraftFromLocalStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear draft from localStorage:', error);
  }
}
