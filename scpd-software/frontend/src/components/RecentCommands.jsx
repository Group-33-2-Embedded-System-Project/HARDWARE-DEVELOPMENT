import { CheckCircle, ClockCounterClockwise, WarningCircle, PaperPlaneTilt } from 'phosphor-react';

function formatDate(isoString) {
  if (!isoString) return 'Not yet';
  return new Date(isoString).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCommandLabel(command) {
  if (command.type === 'deterrent') return 'Trigger deterrent';
  if (command.type === 'arm') return `Set arm mode to ${command.payload_json?.mode || 'unknown'}`;
  return command.type;
}

function getCommandState(command) {
  if (command.ack_status === 'acknowledged') return { label: 'Acknowledged', tone: 'active', icon: CheckCircle };
  if (command.publish_status === 'failed' || command.ack_status === 'failed') return { label: 'Failed', tone: 'alert', icon: WarningCircle };
  if (command.ack_status === 'timed_out') return { label: 'Timed out', tone: 'warning', icon: WarningCircle };
  if (command.publish_status === 'published') return { label: 'Awaiting ack', tone: 'warning', icon: ClockCounterClockwise };
  return { label: 'Pending publish', tone: 'inactive', icon: PaperPlaneTilt };
}

import { useState, useEffect } from 'react';

export default function RecentCommands({ commands, session, onTokenRefreshed }) {
  const [showAll, setShowAll] = useState(false);
  const [localCommands, setLocalCommands] = useState(commands || []);

  // Keep localCommands in sync with incoming prop updates
  useEffect(() => {
    setLocalCommands(commands || []);
  }, [commands]);

  const MAX_VISIBLE = 5;
  const displayed = showAll ? localCommands : localCommands.slice(0, MAX_VISIBLE);

  async function handleDelete(commandId) {
    if (!confirm('Delete this command? This cannot be undone.')) return;

    const token = session?.token;
    const refreshToken = session?.refreshToken;

    try {
      // Use API helper which handles auth + refresh
      await import('../services/api.js').then(({ api }) => api.deleteCommand(token, commandId, refreshToken, onTokenRefreshed));
      setLocalCommands((prev) => prev.filter((c) => c.id !== commandId));
    } catch (err) {
      console.error('Error deleting command:', err);
      alert('Failed to delete command on server.');
    }
  }

  return (
    <section className="panel-card" aria-label="Recent commands">
      <div className="section-header">
        <div className="section-header-info">
          <p className="eyebrow">Command queue</p>
          <h2>Recent Commands</h2>
        </div>
      </div>

      {commands.length ? (
        <>
          <ol className="events" aria-label={`${commands.length} recent commands`}>
            {displayed.map((command) => {
              const state = getCommandState(command);
              const Icon = state.icon;

              return (
                <li key={command.id} className="event-item">
                  <div className="event-icon-wrap" data-type={state.tone} aria-hidden="true">
                    <Icon size={15} weight="fill" />
                  </div>
                  <div className="event-body">
                    <span className="event-title">{getCommandLabel(command)}</span>
                    <span className="event-sub">
                      Requested by {command.requested_by} · {formatDate(command.requested_at)}
                    </span>
                  </div>
                  <div className="event-meta-actions">
                    <span className="event-time">{state.label}</span>
                    <button
                      className="btn-link"
                      title="Delete command"
                      onClick={() => handleDelete(command.id)}
                      style={{ marginLeft: '0.5rem' }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
            {commands.length > MAX_VISIBLE && (
              <div>
                <button
                  className="btn-secondary"
                  onClick={() => setShowAll((s) => !s)}
                  aria-expanded={showAll}
                  aria-controls="recent-commands-list"
                >
                  {showAll ? `Show fewer` : `Show all (${commands.length})`}
                </button>
              </div>
            )}

            <div>
              <button
                className="btn-danger"
                onClick={async () => {
                  if (!confirm('Delete ALL commands in the database? This is irreversible.')) return;
                  const token = session?.token;
                  const refreshToken = session?.refreshToken;
                  try {
                    const { api } = await import('../services/api.js');
                    await api.deleteAllCommands(token, refreshToken, onTokenRefreshed);
                    setLocalCommands([]);
                    setShowAll(false);
                    alert('All commands deleted.');
                  } catch (err) {
                    console.error('Failed to delete all commands:', err);
                    alert('Failed to delete all commands on server.');
                  }
                }}
              >
                Delete all
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="events-empty" role="status">
          <div className="events-empty-icon">
            <PaperPlaneTilt size={24} />
          </div>
          <p>No commands sent yet.</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            Manual triggers and arm changes will appear here.
          </p>
        </div>
      )}
    </section>
  );
}
