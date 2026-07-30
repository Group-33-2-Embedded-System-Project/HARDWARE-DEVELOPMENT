import { useEffect, useState } from 'react';
import { Database, Radio, Plugs, DeviceMobile, Cpu, CaretDown, CaretUp, ArrowClockwise } from 'phosphor-react';
import { api } from '../services/api.js';

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m uptime`;
  if (m > 0) return `${m}m ${s}s uptime`;
  return `${s}s uptime`;
}

function CheckRow({ label, check, icon: Icon }) {
  if (!check) return null;

  let displayValue = '';
  if (check.latencyMs != null) displayValue = `${check.latencyMs} ms`;
  else if (check.connectedClients != null) displayValue = `${check.connectedClients} client${check.connectedClients !== 1 ? 's' : ''}`;
  else if (check.uptimeSeconds != null) displayValue = formatUptime(check.uptimeSeconds);
  else if (check.status === 'error') displayValue = check.error || 'Error';
  else if (check.status === 'degraded') displayValue = 'Degraded';
  else displayValue = 'OK';

  return (
    <div className="health-check-row">
      <span className="health-check-left">
        <span className="health-check-icon">
          <Icon size={14} weight="regular" />
        </span>
        {label}
      </span>
      <span
        className="health-check-right"
        data-status={check.status}
      >
        {displayValue}
      </span>
    </div>
  );
}

export default function SystemHealth({ session, onTokenRefreshed }) {
  const [health, setHealth]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);

  async function fetchHealth() {
    if (!session?.token) return;
    setLoading(true);
    try {
      const data = await api.detailedHealth(session.token, session.refreshToken, onTokenRefreshed);
      setHealth(data);
      setLastFetch(new Date());
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 30_000);
    return () => clearInterval(id);
  }, [session?.token]);

  const overallStatus = !health ? 'unknown'
    : health.status === 'ok' ? 'ok'
    : health.status === 'degraded' ? 'degraded'
    : 'error';

  const overallLabel = loading ? 'Checking systems…'
    : !health ? 'Status unknown'
    : health.status === 'ok' ? 'All systems operational'
    : health.status === 'degraded' ? 'System degraded'
    : 'System unhealthy';

  const fetchTime = lastFetch
    ? lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <section className="panel-card" aria-label="System health">
      <div className="section-header">
        <div className="section-header-info">
          <p className="eyebrow">Diagnostics</p>
          <h2>System Health</h2>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="btn-text"
            onClick={fetchHealth}
            disabled={loading}
            title="Refresh health status"
            aria-label="Refresh health status"
          >
            <ArrowClockwise size={14} style={{ ...(loading ? { animation: 'spin 1s linear infinite' } : {}) }} />
          </button>
          <button
            className="btn-text"
            onClick={() => {
              setExpanded((e) => !e);
              if (!expanded) fetchHealth();
            }}
            aria-expanded={expanded}
            aria-controls="health-details"
          >
            {expanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
            {expanded ? 'Collapse' : 'Details'}
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="health-summary" role="status" aria-live="polite" aria-label={overallLabel}>
        <span
          className="health-status-dot"
          data-status={overallStatus}
          aria-hidden="true"
        />
        <span className="health-label">{overallLabel}</span>
        {fetchTime && (
          <span className="health-time">{fetchTime}</span>
        )}
      </div>

      {/* Expanded checks */}
      {expanded && health && (
        <div id="health-details" aria-label="Health check details">
          <div className="health-checks">
            <CheckRow label="Database"  check={health.checks?.database}  icon={Database}     />
            <CheckRow label="MQTT"       check={health.checks?.mqtt}       icon={Radio}        />
            <CheckRow label="WebSocket"  check={health.checks?.websocket}  icon={Plugs}        />
            <CheckRow label="Device"     check={health.checks?.device}     icon={DeviceMobile} />
            <CheckRow label="Process"    check={health.checks?.system}     icon={Cpu}          />
          </div>

          {health.checks?.system?.memory && (
            <div className="health-memory" aria-label="Memory usage">
              <span>
                <Database size={11} aria-hidden="true" />
                Heap {health.checks.system.memory.heapUsedMb} / {health.checks.system.memory.heapTotalMb} MB
              </span>
              <span>RSS {health.checks.system.memory.rssMb} MB</span>
              {health.checks.system.nodeVersion && (
                <span>Node {health.checks.system.nodeVersion}</span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
