import { Warning, Play, ToggleLeft, Prohibit, ListBullets, Trash } from 'phosphor-react';

const EVENT_META = {
  predator_alert: {
    label: 'Predator Alert',
    icon:  Warning,
  },
  manual_trigger: {
    label: 'Manual Test',
    icon:  Play,
  },
  arm_change: {
    label: 'Arm Mode Changed',
    icon:  ToggleLeft,
  },
  alert_rate_limited: {
    label: 'Alert Suppressed',
    icon:  Prohibit,
  },
  mqtt_validation_error: {
    label: 'MQTT Error',
    icon:  Warning,
  },
  state_update_error: {
    label: 'State Error',
    icon:  Warning,
  },
};

function formatDate(isoString) {
  const d = new Date(`${isoString}Z`);
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { date, time };
}

function SkeletonRow() {
  return (
    <li className="event-item" aria-hidden="true">
      <div style={{ width: '2rem', height: '2rem', borderRadius: 'var(--radius-sm)' }} className="skeleton" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
        <div className="skeleton" style={{ height: '0.8125rem', width: '55%' }} />
        <div className="skeleton" style={{ height: '0.6875rem', width: '38%' }} />
      </div>
      <div className="skeleton" style={{ height: '0.6875rem', width: '3.5rem', borderRadius: 'var(--radius-sm)' }} />
    </li>
  );
}

export default function EventHistory({ events, loading, onDeleteEvent, onClearEvents }) {
  return (
    <section className="panel-card" aria-label="Event history">
      <div className="section-header">
        <div className="section-header-info">
          <p className="eyebrow">Activity log</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h2>Event History</h2>
            {events.length > 0 && (
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  color: 'var(--text-tertiary)',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius-full)',
                }}
                aria-label={`${events.length} events`}
              >
                {events.length}
              </span>
            )}
          </div>
        </div>
        {events.length > 0 && (
          <button
            className="btn-text btn-danger"
            onClick={onClearEvents}
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}
            title="Clear all event logs"
          >
            <Trash size={13} />
            Clear logs
          </button>
        )}
      </div>

      <div className="events-container" role="region" aria-label="Recent events" tabIndex={0}>
        {loading ? (
          <ol className="events" aria-label="Loading events" aria-busy="true">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </ol>
        ) : events.length ? (
          <ol className="events" aria-label={`${events.length} events`}>
            {events.map((event) => {
              const meta = EVENT_META[event.type];
              const Icon = meta?.icon ?? Warning;
              const label = meta?.label ?? event.type;
              const { date, time } = formatDate(event.created_at);

              return (
                <li key={event.id} className="event-item">
                  <div
                    className="event-icon-wrap"
                    data-type={event.type}
                    aria-hidden="true"
                  >
                    <Icon size={15} weight="fill" />
                  </div>
                  <div className="event-body">
                    <span className="event-title">{label}</span>
                    <span className="event-sub">{date}</span>
                  </div>
                  <div className="event-meta-actions">
                    <span className="event-time">{time}</span>
                    <button
                      className="event-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteEvent?.(event.id);
                      }}
                      title="Delete this log entry"
                      aria-label="Delete log entry"
                    >
                      <Trash size={13} weight="bold" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="events-empty" role="status">
            <div className="events-empty-icon">
              <ListBullets size={24} />
            </div>
            <p>No events recorded yet.</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              Events will appear here as the system runs.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}