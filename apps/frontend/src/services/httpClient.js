const API_BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "medbridge_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (networkErr) {
    // fetch() itself throws on network failure (backend down, no internet, etc.)
    const err = new Error("Can't reach the server. Check your connection and try again.");
    err.status = 0;
    err.cause = networkErr;
    throw err;
  }

  if (res.status === 204) return null;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const isGatewayError = [502, 503, 504].includes(res.status);
    const message =
      body.error ||
      body.message ||
      (isGatewayError
        ? "Can't reach the server right now. Please try again in a moment."
        : `Request failed (${res.status})`);
    const err = new Error(message);
    err.status = res.status;
    err.details = body.details;

    // A 401 on any authenticated request means the session is invalid/expired.
    // Broadcast it so AuthContext (which owns the user state) can log out
    // and redirect, without httpClient needing to import AuthContext directly.
    if (res.status === 401 && path !== "/auth/login") {
      window.dispatchEvent(new CustomEvent("medbridge:unauthorized"));
    }

    throw err;
  }

  return body;
}
