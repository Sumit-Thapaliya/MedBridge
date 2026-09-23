import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  getToken,
  fetchCurrentUser,
  login as loginRequest,
  registerHospital as registerRequest,
  registerMember as registerMemberRequest,
  logout as clearSession,
} from "../services/authService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `isAuthenticated` is the source of truth for "should this person see
  // protected pages" — it's driven by having a token, not by the profile
  // fetch succeeding. That way a temporarily unreachable backend doesn't
  // bounce a genuinely logged-in person to /login; only a real 401 (the
  // token itself being invalid/expired) does.
  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());
  const [loading, setLoading] = useState(!!getToken());

  const loadSession = useCallback(async () => {
    if (!getToken()) {
      setIsAuthenticated(false);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const profile = await fetchCurrentUser();
      setUser(profile);
      setIsAuthenticated(true);
    } catch (err) {
      if (err.status === 401) {
        // The token itself is invalid/expired — this really is "logged out".
        clearSession();
        setIsAuthenticated(false);
        setUser(null);
      }
      // Any other error (backend down, 502/503, network hiccup): keep
      // isAuthenticated as-is. The token is still presumed valid; we just
      // couldn't refresh the profile right now. Pages that show user info
      // already fall back gracefully (e.g. Topbar shows "…" for the name).
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadSession());
  }, [loadSession]);

  // A 401 from ANY request (not just the initial session check) means the
  // token is genuinely invalid — this is the one case that should always
  // log the person out, no matter which page triggered it.
  useEffect(() => {
    const handleUnauthorized = () => {
      clearSession();
      setIsAuthenticated(false);
      setUser(null);
    };
    window.addEventListener("medbridge:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("medbridge:unauthorized", handleUnauthorized);
  }, []);

  const login = async (email, password) => {
    const result = await loginRequest(email, password);
    setUser(result.user);
    setIsAuthenticated(true);
    return result.user;
  };

  const registerHospital = async (data) => {
    const result = await registerRequest(data);
    setUser(result.user);
    setIsAuthenticated(true);
    return result.user;
  };

  // Self-register as Staff / Inventory Manager. Does NOT log the user in —
  // returns the pending result so the UI can show a "awaiting approval" message.
  const registerMember = async (data) => registerMemberRequest(data);

  const logout = () => {
    clearSession();
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, isAuthenticated, login, registerHospital, registerMember, logout, refreshUser: loadSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
