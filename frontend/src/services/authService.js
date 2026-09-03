import { api, setAuthToken } from './api';

const TOKEN_STORAGE_KEY = 'doc_automation_token';

/**
 * Authenticate the user.
 * @param {string}  email
 * @param {string}  password
 * @param {boolean} [rememberMe=false]  true → persist token in localStorage
 *                                      false → session only (sessionStorage)
 */
export async function login(email, password, rememberMe = false) {
  const res = await api.post('/auth/login', { email, password });
  const { token, user } = res.data;
  setAuthToken(token);

  if (rememberMe) {
    // Persist across browser sessions
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY); // clean up in case of switch
  } else {
    // Session only — cleared when tab/browser closes
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.removeItem(TOKEN_STORAGE_KEY);   // clean up in case of switch
  }

  return user;
}

export async function fetchCurrentUser() {
  const res = await api.get('/auth/me');
  return res.data;
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    setAuthToken(null);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

/**
 * On app startup, restore a previously saved token.
 * Checks sessionStorage first (current-session login), then localStorage
 * (a "keep me signed in" login from a previous session).
 */
export function restoreTokenFromStorage() {
  const token =
    sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
    localStorage.getItem(TOKEN_STORAGE_KEY) ||
    null;
  if (token) setAuthToken(token);
  return token;
}

/** Self-service "Forgot password" — public, available to every role except Super Admin
 *  (enforced server-side). Always resolves with a generic message. */
export async function forgotPassword(email) {
  return api.post('/auth/forgot-password', { email });
}

/** Completes the reset started above, using the token from the emailed link. */
export async function resetPassword(token, newPassword) {
  return api.post('/auth/reset-password', { token, new_password: newPassword });
}
