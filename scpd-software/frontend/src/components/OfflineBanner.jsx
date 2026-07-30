import { useEffect, useState } from 'react';
import { WifiSlash } from 'phosphor-react';

/**
 * Monitors browser online/offline events and shows a sticky banner
 * when the user loses network connectivity.
 *
 * This is distinct from the WebSocket reconnection indicator — it fires
 * when the browser itself reports no network, not just when the server
 * is unreachable.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline  = () => setOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online',  goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online',  goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="offline-banner"
    >
      <WifiSlash size={16} weight="fill" aria-hidden="true" />
      No internet connection — live updates are paused.
    </div>
  );
}
