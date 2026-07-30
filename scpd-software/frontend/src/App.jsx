import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Gear, SignOut, Warning, ShieldCheck, Info } from 'phosphor-react';
import { api } from './services/api.js';
import { connectSocket } from './services/socket.js';
import LoginForm from './components/LoginForm.jsx';
import StatusDashboard from './components/StatusDashboard.jsx';
import ArmControl from './components/ArmControl.jsx';
import EventHistory from './components/EventHistory.jsx';
import AlertBanner from './components/AlertBanner.jsx';
import SystemHealth from './components/SystemHealth.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';

const emptyStatus = { pir: false, light: false, armed: false, online: false, updatedAt: null };

function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${'='.repeat((4 - base64.length % 4) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export default function App() {
  const [session, setSession] = useState(
    () => JSON.parse(localStorage.getItem('coop-session') || 'null')
  );
  const [status, setStatus]   = useState(emptyStatus);
  const [events, setEvents]   = useState([]);
  const [alert, setAlert]     = useState(null);
  const [notice, setNotice]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [connectionState, setConnectionState] = useState({ connected: false, reconnecting: false });
  const [theme, setTheme]     = useState(() => localStorage.getItem('coop-theme') || 'system');

  // Keep session ref in sync so callbacks always use the latest token
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Apply theme to document root
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-mode');
      root.classList.remove('dark-mode');
      root.style.colorScheme = 'light';
    } else if (theme === 'dark') {
      root.classList.add('dark-mode');
      root.classList.remove('light-mode');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark-mode', 'light-mode');
      root.style.colorScheme = 'light dark';
    }
    localStorage.setItem('coop-theme', theme);
  }, [theme]);

  /** Persist a new access token without changing the rest of the session. */
  function onTokenRefreshed(newToken) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, token: newToken };
      localStorage.setItem('coop-session', JSON.stringify(next));
      return next;
    });
  }

  /** Handle an auth error — force logout when refresh failed. */
  function handleAuthError(error) {
    if (error.type === 'auth') {
      setNotice('Session expired. Please log in again.');
      logout();
    } else {
      setNotice(error.message);
    }
  }

  async function loadEvents(tok, refresh) {
    const t = tok ?? sessionRef.current?.token;
    const r = refresh ?? sessionRef.current?.refreshToken;
    if (!t) return;
    setLoadingEvents(true);
    try {
      setEvents((await api.events(t, r, onTokenRefreshed)).events);
    } catch (error) {
      handleAuthError(error);
    } finally {
      setLoadingEvents(false);
    }
  }

  useEffect(() => {
    api.status().then(setStatus).catch(() => setNotice('Unable to reach the backend.'));

    const disconnect = connectSocket({
      onStatus: setStatus,
      onAlert: (payload) => {
        setAlert(payload);
        loadEvents();
      },
      onConnectionChange: (state) => {
        setConnectionState(state);
        if (!state.connected && state.reconnecting && state.attempt > 3) {
          setNotice(`Reconnecting to server… (attempt ${state.attempt})`);
        } else if (state.connected && connectionState.reconnecting) {
          api.status().then(setStatus).catch(console.error);
          setNotice('Connection restored');
          setTimeout(() => setNotice(''), 3000);
        }
      },
    });

    return disconnect;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session) {
      loadEvents(session.token, session.refreshToken);
      enablePush(session.token, session.refreshToken);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  async function enablePush(token, refreshToken) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission === 'denied') return;
    try {
      const { publicKey } = await api.pushPublicKey();
      if (!publicKey) return;
      const registration = await navigator.serviceWorker.ready;
      const existing     = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.subscribePush(token, subscription, refreshToken, onTokenRefreshed);
    } catch {
      /* Push is optional; keep the dashboard usable if unavailable. */
    }
  }

  async function login(username, password) {
    const next = await api.login(username, password);
    localStorage.setItem('coop-session', JSON.stringify(next));
    setSession(next);
  }

  async function command(action) {
    setBusy(true);
    setNotice('');
    const { token, refreshToken } = sessionRef.current ?? {};
    try {
      if (action === 'trigger') {
        await api.trigger(token, refreshToken, onTokenRefreshed);
      } else {
        await api.arm(token, action, refreshToken, onTokenRefreshed);
      }
      setNotice(action === 'trigger' ? 'Deterrent test command sent.' : `Arm mode set to "${action}".`);
      await loadEvents();
    } catch (error) {
      handleAuthError(error);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem('coop-session');
    setSession(null);
    setEvents([]);
  }

  async function deleteLog(id) {
    const { token, refreshToken } = sessionRef.current ?? {};
    if (!token) return;
    try {
      await api.deleteEvent(token, id, refreshToken, onTokenRefreshed);
      setNotice('Log entry deleted.');
      await loadEvents();
    } catch (error) {
      handleAuthError(error);
    }
  }

  async function clearLogs() {
    if (!window.confirm('Are you sure you want to clear all logs?')) return;
    const { token, refreshToken } = sessionRef.current ?? {};
    if (!token) return;
    try {
      await api.clearEvents(token, refreshToken, onTokenRefreshed);
      setNotice('All activity logs cleared.');
      await loadEvents();
    } catch (error) {
      handleAuthError(error);
    }
  }

  if (!session) {
    return (
      <ErrorBoundary label="Login">
        <LoginForm onLogin={login} />
      </ErrorBoundary>
    );
  }

  return (
    <>
      <OfflineBanner />
      <main className="app">
        {/* Header */}
        <header className="app-header" role="banner">
          <div className="header-brand">
            <div className="header-brand-icon" aria-hidden="true">
              <ShieldCheck size={22} weight="duotone" />
            </div>
            <div className="header-brand-text">
              <p className="eyebrow">Smart Coop</p>
              <h1>Coop Guard</h1>
            </div>
          </div>

          <div className="header-actions">
            {/* Reconnecting indicator */}
            {connectionState.reconnecting && (
              <span className="header-status" role="status" aria-live="polite">
                <Warning size={12} weight="fill" aria-hidden="true" />
                Reconnecting…
              </span>
            )}

            {/* Theme switcher */}
            <div className="theme-toggle" role="group" aria-label="Theme selection">
              <button
                id="theme-light"
                onClick={() => setTheme('light')}
                title="Light mode"
                data-active={theme === 'light'}
                aria-pressed={theme === 'light'}
                aria-label="Switch to light mode"
              >
                <Sun size={14} weight={theme === 'light' ? 'fill' : 'regular'} />
              </button>
              <button
                id="theme-dark"
                onClick={() => setTheme('dark')}
                title="Dark mode"
                data-active={theme === 'dark'}
                aria-pressed={theme === 'dark'}
                aria-label="Switch to dark mode"
              >
                <Moon size={14} weight={theme === 'dark' ? 'fill' : 'regular'} />
              </button>
              <button
                id="theme-system"
                onClick={() => setTheme('system')}
                title="System theme"
                data-active={theme === 'system'}
                aria-pressed={theme === 'system'}
                aria-label="Follow system theme"
              >
                <Gear size={14} weight={theme === 'system' ? 'fill' : 'regular'} />
              </button>
            </div>

            {/* Sign out */}
            <button
              id="signout-btn"
              className="btn-text"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <SignOut size={16} />
              <span className="sr-only">Sign out</span>
            </button>
          </div>
        </header>

        {/* Alert banner */}
        <ErrorBoundary label="Alert banner" inline>
          <AlertBanner alert={alert} onClose={() => setAlert(null)} />
        </ErrorBoundary>

        {/* Notice message */}
        {notice && (
          <p className="notice" role="status" aria-live="polite">
            <Info size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.375rem' }} />
            {notice}
          </p>
        )}

        {/* Dashboard grid */}
        <div className="layout" role="region" aria-label="Dashboard">
          <ErrorBoundary label="Status dashboard">
            <StatusDashboard status={status} onTrigger={() => command('trigger')} busy={busy} />
          </ErrorBoundary>

          <ErrorBoundary label="Arm control" inline>
            <ArmControl onSelect={command} busy={busy} session={session} onTokenRefreshed={onTokenRefreshed} />
          </ErrorBoundary>

          <ErrorBoundary label="Event history">
            <EventHistory events={events} loading={loadingEvents} onDeleteEvent={deleteLog} onClearEvents={clearLogs} />
          </ErrorBoundary>

          <ErrorBoundary label="System health">
            <SystemHealth session={session} onTokenRefreshed={onTokenRefreshed} />
          </ErrorBoundary>
        </div>
      </main>
    </>
  );
}
