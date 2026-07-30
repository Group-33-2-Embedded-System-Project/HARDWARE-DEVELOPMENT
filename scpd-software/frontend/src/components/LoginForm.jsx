import { useState } from 'react';
import { Lock, Eye, EyeSlash, ShieldCheck, Warning } from 'phosphor-react';

export default function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-container">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <ShieldCheck size={32} weight="duotone" />
          </div>
          <h1>Coop Guard</h1>
          <p>Sign in to monitor your coop and control the deterrent system.</p>
        </div>

        {/* Card */}
        <div className="login-card">
          <form className="login-form" onSubmit={submit} noValidate>
            {/* Username */}
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">
                Username
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                disabled={busy}
                aria-describedby={error ? 'login-error' : undefined}
              />
            </div>

            {/* Password */}
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={busy}
                  style={{ paddingRight: '2.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '0.625rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-tertiary)',
                    padding: '0.25rem',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: 'none',
                    width: 'auto',
                    height: 'auto',
                  }}
                >
                  {showPassword
                    ? <EyeSlash size={16} />
                    : <Eye size={16} />
                  }
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p
                id="login-error"
                role="alert"
                className="error-inline"
                aria-live="assertive"
              >
                <Warning size={14} weight="fill" style={{ flexShrink: 0 }} />
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              className="login-submit"
              disabled={busy || !username || !password}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <Lock size={16} />
                  Signing in…
                </>
              ) : (
                <>
                  <Lock size={16} />
                  Sign in
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
