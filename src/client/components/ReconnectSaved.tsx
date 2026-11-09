import { useState } from 'react';
import { reconnectAll, type ReconnectResult } from '../devices/ble';

/** Przycisk ponawiający łączenie z zapamiętanymi urządzeniami, bez okna wyboru i osobnych kliknięć. */
export function ReconnectSaved({ devices }: { devices: readonly { reconnectSaved(): Promise<ReconnectResult> }[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setResult(await reconnectAll(devices));
    setBusy(false);
  }

  return (
    <div className="reconnect">
      <button className="btn" type="button" onClick={run} disabled={busy}>
        {busy ? 'Łączenie…' : 'Połącz zapamiętane'}
      </button>
      {result && (
        <span className="muted small" role="status">
          {result}
        </span>
      )}
    </div>
  );
}
