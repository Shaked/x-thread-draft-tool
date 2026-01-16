/**
 * Authentication utilities
 */

import { authAPI } from './api.js';

/**
 * Get current user
 */
export async function getCurrentUser() {
  try {
    const response = await authAPI.getCurrentUser();
    return response.user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Login (redirects to OAuth)
 */
export function login() {
  authAPI.login();
}

/**
 * Logout
 */
export async function logout() {
  try {
    await authAPI.logout();
  } catch (error) {
    console.error('Error logging out:', error);
    // Still reload to clear local state
    window.location.reload();
  }
}
