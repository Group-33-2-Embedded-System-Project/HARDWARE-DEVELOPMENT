const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ── Helpers ───────────────────────────────────────────────────────────────────

function headers(token, json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Core fetch wrapper.
 * Throws a typed error so callers can distinguish auth failures from other errors.
 */
async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_URL}${path}`, options);
  } catch (networkError) {
    throw Object.assign(new Error('Unable to reach the server.'), { type: 'network' });
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = Object.assign(
      new Error(body.error || `Request failed (${response.status})`),
      { status: response.status, type: response.status === 401 ? 'auth' : 'http' }
    );
    throw error;
  }

  return body;
}

/**
 * Attempt a token refresh.
 * Returns the new access token or null if refresh fails.
 */
async function tryRefresh(refreshToken) {
  try {
    const body = await request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: headers(null, true),
      body: JSON.stringify({ refreshToken }),
    });
    return body.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Authenticated request with automatic token refresh on 401.
 *
 * @param {string}   path
 * @param {object}   options      - fetch options
 * @param {string}   token        - current access token
 * @param {string}   refreshToken - long-lived refresh token
 * @param {Function} onTokenRefreshed - callback(newToken) to persist the new token
 */
async function authRequest(path, options, token, refreshToken, onTokenRefreshed) {
  try {
    return await request(path, {
      ...options,
      headers: { ...options.headers, ...headers(token, false) },
    });
  } catch (error) {
    if (error.type === 'auth' && refreshToken) {
      const newToken = await tryRefresh(refreshToken);
      if (newToken) {
        onTokenRefreshed?.(newToken);
        return request(path, {
          ...options,
          headers: { ...options.headers, ...headers(newToken, false) },
        });
      }
    }
    throw error;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const api = {
  login: (username, password) =>
    request('/api/v1/auth/login', {
      method:  'POST',
      headers: headers(null, true),
      body:    JSON.stringify({ username, password }),
    }),

  refreshToken: (refreshToken) =>
    request('/api/v1/auth/refresh', {
      method:  'POST',
      headers: headers(null, true),
      body:    JSON.stringify({ refreshToken }),
    }),

  status: () => request('/api/v1/status'),

  events: (token, refreshToken, onRefresh) =>
    authRequest('/api/v1/events?limit=50', { headers: {} }, token, refreshToken, onRefresh),

  commands: (token, refreshToken, onRefresh) =>
    authRequest('/api/v1/commands?limit=20', { headers: {} }, token, refreshToken, onRefresh),

  command: (token, id, refreshToken, onRefresh) =>
    authRequest(`/api/v1/commands/${id}`, { headers: {} }, token, refreshToken, onRefresh),

  deleteEvent: (token, id, refreshToken, onRefresh) =>
    authRequest(`/api/v1/events/${id}`, { method: 'DELETE' }, token, refreshToken, onRefresh),

  clearEvents: (token, refreshToken, onRefresh) =>
    authRequest('/api/v1/events', { method: 'DELETE' }, token, refreshToken, onRefresh),

  // Commands
  trigger: (token, refreshToken, onRefresh) =>
    authRequest(
      '/api/v1/commands/deterrent',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'trigger' }) },
      token, refreshToken, onRefresh
    ),

  arm: (token, mode, refreshToken, onRefresh) =>
    authRequest(
      '/api/v1/commands/arm',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) },
      token, refreshToken, onRefresh
    ),

  pushPublicKey: () => request('/api/v1/push/public-key'),

  subscribePush: (token, subscription, refreshToken, onRefresh) =>
    authRequest(
      '/api/v1/push/subscribe',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) },
      token, refreshToken, onRefresh
    ),

  health: () => request('/health'),

  detailedHealth: (token, refreshToken, onRefresh) =>
    authRequest('/health/detailed', { headers: {} }, token, refreshToken, onRefresh),

  // --- New command delete APIs (authenticated)
  deleteCommand: (token, id, refreshToken, onRefresh) =>
    authRequest(`/api/v1/commands/${encodeURIComponent(id)}`, { method: 'DELETE' }, token, refreshToken, onRefresh),

  deleteAllCommands: (token, refreshToken, onRefresh) =>
    authRequest('/api/v1/commands', { method: 'DELETE' }, token, refreshToken, onRefresh),

  trigger: (token, refreshToken, onRefresh) =>
    authRequest(
      '/api/v1/commands/deterrent',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'trigger' }) },
      token, refreshToken, onRefresh
    ),

  arm: (token, mode, refreshToken, onRefresh) =>
    authRequest(
      '/api/v1/commands/arm',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) },
      token, refreshToken, onRefresh
    ),

  pushPublicKey: () => request('/api/v1/push/public-key'),

  subscribePush: (token, subscription, refreshToken, onRefresh) =>
    authRequest(
      '/api/v1/push/subscribe',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) },
      token, refreshToken, onRefresh
    ),

  health: () => request('/health'),

  detailedHealth: (token, refreshToken, onRefresh) =>
    authRequest('/health/detailed', { headers: {} }, token, refreshToken, onRefresh),
};

export { API_URL };
