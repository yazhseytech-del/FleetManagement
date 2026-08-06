// Authentication state for the whole app.
//
// Holds the logged-in user, exposes login/register/logout, and — on first load
// — restores the session from a saved token by asking the backend "who am I?"
// (GET /api/auth/me). main.jsx uses `user` to decide whether to show the Login
// screen or the app.
import { createContext, useContext, useEffect, useState } from "react";
import api, { getToken, setToken, clearToken } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until we've checked for a saved session

  // On mount: if a token is saved, verify it and load the user.
  useEffect(() => {
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { user } = await api.get("/auth/me");
        setUser(user);
      } catch {
        clearToken(); // token missing/expired — force a fresh login
      } finally {
        setLoading(false);
      }
    }
    restore();
  }, []);

  async function login(username, password) {
    try {
      const { token, user } = await api.post("/auth/login", { username, password });
      setToken(token);
      setUser(user);
    } catch (err) {
      // Passive log only — does not change login's success/failure behavior
      // or the error thrown to Login.jsx. Read back by useFleetData.js
      // (same "fleetopz:" localStorage namespace) to surface a Failed Login
      // Attempts alert once the person is signed in, since the Alerts
      // screen only exists inside the authenticated app.
      try {
        const raw = window.localStorage.getItem("fleetopz:failedLoginLog");
        const log = raw ? JSON.parse(raw) : [];
        log.push({ id: `failedlogin-${Date.now()}`, username, timestamp: new Date().toISOString() });
        window.localStorage.setItem("fleetopz:failedLoginLog", JSON.stringify(log.slice(-50)));
      } catch (_) { /* best-effort only */ }
      throw err;
    }
  }

  async function register(name, username, password) {
    const { token, user } = await api.post("/auth/register", { name, username, password });
    setToken(token);
    setUser(user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}