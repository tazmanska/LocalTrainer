import { useState } from 'react';
import { LibraryScreen } from './screens/LibraryScreen';
import { ProfileScreen } from './screens/ProfileScreen';

type View = 'live' | 'lib' | 'hist' | 'prof';

const VIEWS: { id: View; label: string }[] = [
  { id: 'live', label: 'Trening' },
  { id: 'lib', label: 'Treningi' },
  { id: 'hist', label: 'Historia' },
  { id: 'prof', label: 'Profil' },
];

export function App() {
  const [view, setView] = useState<View>('lib');

  return (
    <>
      <header className="appbar">
        <div className="brand">
          <i />
          Trenażer
        </div>
        <nav aria-label="Ekrany">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="wrap">
        {view === 'prof' ? <ProfileScreen /> : view === 'lib' ? <LibraryScreen /> : <Placeholder view={view} />}
      </main>
    </>
  );
}

function Placeholder({ view }: { view: View }) {
  const step = { live: 4, lib: 3, hist: 5, prof: 2 }[view];
  return (
    <div className="panel placeholder">
      <h2>{VIEWS.find((v) => v.id === view)?.label}</h2>
      <p>Ten ekran powstanie w kroku {step}.</p>
    </div>
  );
}
