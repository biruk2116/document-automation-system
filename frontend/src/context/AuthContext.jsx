import { createContext, useEffect, useState, useCallback } from 'react';
import {
  login as loginRequest,
  logout as logoutRequest,
  fetchCurrentUser,
  restoreTokenFromStorage,
} from '../services/authService';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // On app load, try to restore a session from a previously stored token
  useEffect(() => {
    (async () => {
      const token = restoreTokenFromStorage();
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const currentUser = await fetchCurrentUser();
        setUser(currentUser);
      } catch {
        // Token expired/invalid — clear silently, force re-login
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password, rememberMe = false) => {
    setError(null);
    try {
      const loggedInUser = await loginRequest(email, password, rememberMe);
      setUser(loggedInUser);
      return loggedInUser;
    } catch (err) {
      setError(err.message || 'Login failed.');
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  /** Merge partial fields (e.g. a fresh avatar_url or full_name) into the current
   *  user without a full re-login — used right after a profile-photo upload or a
   *  self-service profile edit so the sidebar reflects it instantly. */
  const updateUser = useCallback((partial) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  /** Re-pulls /auth/me — used when we want the full, DB-fresh record rather than
   *  just patching in the fields a given response happened to return. */
  const refreshUser = useCallback(async () => {
    const currentUser = await fetchCurrentUser();
    setUser(currentUser);
    return currentUser;
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, error, login, logout, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
