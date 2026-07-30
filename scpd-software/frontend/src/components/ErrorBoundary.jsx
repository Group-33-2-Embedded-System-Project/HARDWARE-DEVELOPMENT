import { Component } from 'react';
import { Warning, ArrowClockwise } from 'phosphor-react';

/**
 * React class-based error boundary.
 *
 * Wraps a subtree and catches any render-time or lifecycle errors,
 * showing a fallback UI instead of a blank screen.
 *
 * Usage:
 *   <ErrorBoundary label="Status dashboard">
 *     <StatusDashboard ... />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface in console so DevTools still show the problem
    console.error(`[ErrorBoundary: ${this.props.label || 'component'}]`, error, info.componentStack);
  }

  handleReset() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    const { children, label, inline = false } = this.props;

    if (!error) return children;

    // Compact inline fallback (for small cards / panels)
    if (inline) {
      return (
        <div
          role="alert"
          className="error-inline"
        >
          <Warning size={14} weight="fill" style={{ flexShrink: 0 }} />
          <span>
            <strong>{label || 'Component'}</strong> failed to render.
          </span>
          <button
            onClick={this.handleReset}
            className="btn-secondary"
            style={{ marginLeft: 'auto', padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
          >
            <ArrowClockwise size={12} />
            Retry
          </button>
        </div>
      );
    }

    // Full-section fallback (for top-level sections)
    return (
      <section
        role="alert"
        className="panel-card"
        style={{
          borderColor: 'var(--color-danger-border)',
          borderTop: '3px solid var(--color-danger)',
          textAlign: 'center',
          padding: 'var(--space-10)',
        }}
      >
        <div
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-danger-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-danger)',
            margin: '0 auto var(--space-5)',
          }}
        >
          <Warning size={24} weight="fill" />
        </div>
        <p
          className="eyebrow"
          style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}
        >
          Error
        </p>
        <h2 style={{ marginBottom: 'var(--space-2)' }}>
          {label ? `${label} unavailable` : 'Something went wrong'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)', fontSize: '0.875rem', lineHeight: 1.5 }}>
          {error.message || 'An unexpected error occurred in this section.'}
        </p>
        <button onClick={this.handleReset} className="btn-secondary">
          <ArrowClockwise size={14} />
          Try again
        </button>
      </section>
    );
  }
}
