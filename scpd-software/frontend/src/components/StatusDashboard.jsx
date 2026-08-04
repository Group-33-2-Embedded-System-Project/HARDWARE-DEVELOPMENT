import { WifiHigh, WifiSlash, Play, Eye, Moon, Sun, ShieldCheck, ShieldSlash, Clock, WarningOctagon } from 'phosphor-react';

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
  const updated = status.lastDeviceMessageAt || status.updatedAt;
  const updatedLabel = updated
    ? new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Derive semantic state for each card
  const motionState  = status.pir  ? 'alert'  : 'inactive';
  const lightState   = status.light ? 'warning' : 'inactive';
  const armedState   = status.armed ? 'active'  : 'inactive';
  const deviceState = !status.mqttConnected
    ? 'offline'
    : status.isStale
      ? 'stale'
      : status.online
        ? 'online'
        : 'offline';
  const commandsAllowed = status.mqttConnected && status.online && !status.isStale;
  const deviceLabel = deviceState === 'online'
    ? 'Online'
    : deviceState === 'stale'
      ? 'Stale'
      : 'Offline';
  const deviceAria = deviceState === 'online'
    ? 'Device online'
    : deviceState === 'stale'
      ? 'Device state is stale'
      : 'Device offline';
  const deviceTitle = !status.mqttConnected
    ? 'Backend is disconnected from MQTT'
    : status.isStale
      ? 'Device state is stale and may no longer be current'
      : status.online
        ? 'Device is connected and reporting'
        : 'Device reported offline';

  return (
    <section className="panel-card" aria-label="Coop status">
      <div className="section-header">
        <div className="section-header-info">
          <p className="eyebrow">Live system</p>
          <h2>Coop Status</h2>
        </div>
        <span
          className="connection-badge"
          data-status={deviceState}
          role="status"
          aria-label={deviceAria}
          title={deviceTitle}
        >
          <span className="connection-dot" aria-hidden="true" />
          {deviceState === 'online' ? (
            <><WifiHigh size={12} weight="fill" aria-hidden="true" /> Online</>
          ) : deviceState === 'stale' ? (
            <><Clock size={12} weight="fill" aria-hidden="true" /> Stale</>
          ) : (
            <><WifiSlash size={12} weight="fill" aria-hidden="true" /> {deviceLabel}</>
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

        <StatusCard
          label="Radar"
          value={status.radar ? 'Active' : 'Clear'}
          detail="RCWL-0516 radar"
          icon={Eye}
          state={status.radar ? 'warning' : 'inactive'}
        />

        <StatusCard
          label="Threat"
          value={typeof status.threat_level === 'number' ? ['Clear','Caution','Danger','Alert'][status.threat_level] || 'Unknown' : 'Unknown'}
          detail={typeof status.threat_level === 'number' ? `Level ${status.threat_level}` : ''}
          icon={WarningOctagon}
          state={status.threat_level >= 2 ? 'alert' : (status.threat_level === 1 ? 'warning' : 'inactive')}
        />
      </div>

      {updatedLabel && (
        <p className="updated-line" aria-label={`Last device update at ${updatedLabel}`}>
          <Clock size={12} aria-hidden="true" />
          Last device update: {updatedLabel}
        </p>
      )}

      {status.commandSummary?.pendingCount > 0 && (
        <p className="updated-line" aria-label={`${status.commandSummary.pendingCount} commands awaiting acknowledgement`}>
          <Clock size={12} aria-hidden="true" />
          {status.commandSummary.pendingCount} command{status.commandSummary.pendingCount === 1 ? '' : 's'} awaiting acknowledgement
        </p>
      )}

      <button
        id="trigger-deterrent-btn"
        onClick={onTrigger}
        disabled={busy || !commandsAllowed}
        title={
          !status.mqttConnected
            ? 'Backend must be connected to MQTT to send commands'
            : status.isStale
              ? 'Wait for a fresh device update before sending commands'
              : !status.online
                ? 'Device must be online to send commands'
            : 'Trigger a deterrent test signal'
        }
        aria-busy={busy}
      >
        <Play size={16} weight="fill" aria-hidden="true" />
        {busy ? 'Sending…' : 'Trigger deterrent test'}
      </button>

      {!commandsAllowed && (
        <p className="hint-box" role="status">
          <WifiSlash size={16} aria-hidden="true" />
          {!status.mqttConnected
            ? 'The backend is disconnected from MQTT, so commands are blocked.'
            : status.isStale
              ? 'The last device update is stale, so commands are blocked until the device reports again.'
              : 'The device must come online before commands can be sent.'}
        </p>
      )}
    </section>
  );
}
