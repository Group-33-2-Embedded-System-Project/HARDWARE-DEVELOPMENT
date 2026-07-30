import { X, WarningOctagon } from 'phosphor-react';

export default function AlertBanner({ alert, onClose }) {
  if (!alert) return null;

  return (
    <div className="alert-banner" role="alert" aria-live="assertive">
      <div className="alert-content">
        <WarningOctagon
          size={22}
          weight="fill"
          className="alert-icon"
          aria-hidden="true"
        />
        <div>
          <strong>Predator Alert</strong>
          <span>Motion detected while the deterrent system was armed</span>
        </div>
      </div>
      <button
        className="alert-close"
        onClick={onClose}
        aria-label="Dismiss alert"
        title="Dismiss this alert"
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}
