import { WifiHigh, WifiSlash, Play, Eye, Moon, Sun, ShieldCheck, ShieldSlash, Clock } from 'phosphor-react';

function StatusCard({ label, value, detail, icon: Icon, state = 'inactive' }) {
  return (
    <article className="status-card" data-state={state} aria-label={`${label}: ${value}`}>
      <div className="status-card-icon-wrap">
        {Icon && <Icon size={20} weight="duotone" />}
      </div>
      <span className="status-card-label">{label}</span>
      <span className="status-card-value">{value}</span>
      <span className="status-card-detail">{detail}</span>
    </article>
  );
}

export default function StatusDashboard({ status, onTrigger, busy }) {
  const updated = status.updatedAt
    ? new Date(status.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Derive semantic state for each card
  const motionState  = status.pir  ? 'alert'  : 'inactive';
  const lightState   = status.light ? 'warning' : 'inactive';
  const armedState   = status.armed ? 'active'  : 'inactive';

  return (
    <section className="panel-card" aria-label="Coop status">
      <div className="section-header">
        <div className="section-header-info">
          <p className="eyebrow">Live system</p>
          <h2>Coop Status</h2>
        </div>
        <span
          className="connection-badge"
          data-status={status.online ? 'online' : 'offline'}
          role="status"
          aria-label={status.online ? 'Device online' : 'Device offline'}
          title={status.online ? 'Device is connected' : 'Device is not responding'}
        >
          <span className="connection-dot" aria-hidden="true" />
          {status.online ? (
            <><WifiHigh size={12} weight="fill" aria-hidden="true" /> Online</>
          ) : (
            <><WifiSlash size={12} weight="fill" aria-hidden="true" /> Offline</>
          )}
        </span>
      </div>

      <div className="status-grid" role="list" aria-label="Sensor readings">
        <StatusCard
          label="Motion"
          value={status.pir ? 'Detected' : 'Clear'}
          detail="PIR sensor"
          icon={Eye}
          state={motionState}
        />
        <StatusCard
          label="Light"
          value={status.light ? 'Dark' : 'Bright'}
          detail="LDR sensor"
          icon={status.light ? Moon : Sun}
          state={lightState}
        />
        <StatusCard
          label="Protection"
          value={status.armed ? 'Armed' : 'Disarmed'}
          detail="Deterrent state"
          icon={status.armed ? ShieldCheck : ShieldSlash}
          state={armedState}
        />
      </div>

      {updated && (
        <p className="updated-line" aria-label={`Last update at ${updated}`}>
          <Clock size={12} aria-hidden="true" />
          Last update: {updated}
        </p>
      )}

      <button
        id="trigger-deterrent-btn"
        onClick={onTrigger}
        disabled={busy || !status.online}
        title={
          !status.online
            ? 'Device must be online to send commands'
            : 'Trigger a deterrent test signal'
        }
        aria-busy={busy}
      >
        <Play size={16} weight="fill" aria-hidden="true" />
        {busy ? 'Sending…' : 'Trigger deterrent test'}
      </button>

      {!status.online && (
        <p className="hint-box" role="status">
          <WifiSlash size={16} aria-hidden="true" />
          The device must come online before commands can be sent.
        </p>
      )}
    </section>
  );
}