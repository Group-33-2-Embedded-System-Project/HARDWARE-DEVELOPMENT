import { useEffect, useState } from 'react';
import { Lock, LockOpen, SlidersHorizontal } from 'phosphor-react';
import { api } from '../services/api.js';

const MODES = [
  {
    key:  'auto',
    label: 'Auto',
    desc:  'Follows the light sensor — arms at dusk, disarms at dawn',
    icon:  SlidersHorizontal,
  },
  {
    key:  'on',
    label: 'Force On',
    desc:  'Always armed regardless of light level',
    icon:  Lock,
  },
  {
    key:  'off',
    label: 'Force Off',
    desc:  'Always disarmed, overrides light sensor',
    icon:  LockOpen,
  },
];

export default function ArmControl({ onSelect, busy, session, onTokenRefreshed }) {
  const [armMode, setArmMode] = useState(null);

  useEffect(() => {
    async function fetchStatus() {
      if (!session?.token) return;
      try {
        const data = await api.status(session.token, session.refreshToken, onTokenRefreshed);
        setArmMode(data.mode);
      } catch {
        // Fail silently — arm mode will update when user selects
      }
    }
    fetchStatus();
    const id = setInterval(fetchStatus, 5_000);
    return () => clearInterval(id);
  }, [session?.token]);

  function handleSelect(mode) {
    setArmMode(mode);
    onSelect(mode);
  }

  const currentMode = MODES.find((m) => m.key === armMode);

  return (
    <section className="panel-card" aria-label="Arm control">
      <div className="section-header">
        <div className="section-header-info">
          <p className="eyebrow">Arm control</p>
          <h2>Protection Mode</h2>
        </div>
      </div>

      <p className="arm-description">
        Choose how the deterrent system arms itself. Auto mode respects the
        ambient light sensor; forced modes override it permanently.
      </p>

      {currentMode && (
        <div className="arm-current" aria-live="polite" aria-label={`Current mode: ${currentMode.label}`}>
          <currentMode.icon size={12} weight="fill" aria-hidden="true" />
          Active: <strong>{currentMode.label}</strong>
        </div>
      )}

      <div
        className="arm-buttons"
        role="radiogroup"
        aria-label="Select arm mode"
      >
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = armMode === mode.key;
          return (
            <button
              key={mode.key}
              id={`arm-mode-${mode.key}`}
              role="radio"
              aria-checked={isActive}
              className="arm-btn"
              onClick={() => handleSelect(mode.key)}
              disabled={busy}
              data-active={isActive}
              title={mode.desc}
            >
              <span className="arm-btn-icon" aria-hidden="true">
                <Icon size={16} weight={isActive ? 'fill' : 'regular'} />
              </span>
              <span className="arm-btn-content">
                <span className="arm-btn-label">{mode.label}</span>
                <span className="arm-btn-desc">{mode.desc}</span>
              </span>
              <span className="arm-btn-radio" aria-hidden="true">
                {isActive && <span className="arm-btn-radio-inner" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
