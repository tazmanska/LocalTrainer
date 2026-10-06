import { useState } from 'react';
import type { Profile } from '../shared/profile';
import type { Workout } from '../shared/workout';
import { getProfile } from './api';
import { HistoryScreen } from './screens/HistoryScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { LiveScreen } from './screens/LiveScreen';
import { ProfileScreen } from './screens/ProfileScreen';

type View = 'live' | 'lib' | 'hist' | 'prof';

const VIEWS: { id: View; label: string }[] = [
  { id: 'live', label: 'Trening' },
  { id: 'lib', label: 'Treningi' },
  { id: 'hist', label: 'Historia' },
  { id: 'prof', label: 'Profil' },
];

interface Active {
  workout: Workout;
  profile: Profile;
  /** zmienia się przy każdym starcie, żeby ten sam trening uruchomiony ponownie zaczynał od zera */
  key: number;
}

export function App() {
  const [view, setView] = useState<View>('lib');
  const [active, setActive] = useState<Active | null>(null);
  const [historyId, setHistoryId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  async function start(workout: Workout) {
    if (active && !confirm('Trwa inny trening. Porzucić go bez zapisu?')) return;
    try {
      const profile = await getProfile();
      setActive({ workout, profile, key: Date.now() });
      setView('live');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <header className="appbar">
        <div className="brand">
          <i />
          Trenażer
        </div>
        <nav aria-label="Ekrany">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
              {v.label}
              {v.id === 'live' && active && <span className="live-dot" title="Trening w toku" />}
            </button>
          ))}
        </nav>
        <span className="modeflag" title="Trenażer i pulsometr są symulowane">
          tryb symulacji
        </span>
      </header>
      <main className={view === 'live' ? 'wrap full' : 'wrap'}>
        {error && <p className="err">{error}</p>}
        {/* Ekran treningu zostaje zamontowany przy przełączaniu zakładek, żeby trening trwał dalej. */}
        {active && (
          <div hidden={view !== 'live'}>
            <LiveScreen
              key={active.key}
              workout={active.workout}
              profile={active.profile}
              onSaved={(id) => {
                setActive(null);
                setHistoryId(id);
                setView('hist');
              }}
              onDiscard={() => {
                setActive(null);
                setView('lib');
              }}
            />
          </div>
        )}
        {view === 'live' && !active && (
          <div className="panel placeholder">
            <h2>Trening</h2>
            <p>
              Wybierz trening w zakładce{' '}
              <button type="button" className="linkbtn" onClick={() => setView('lib')}>
                Treningi
              </button>{' '}
              i kliknij „Rozpocznij trening”.
            </p>
          </div>
        )}
        {view === 'lib' && <LibraryScreen onStart={start} />}
        {view === 'hist' && <HistoryScreen key={historyId} initialId={historyId} />}
        {view === 'prof' && <ProfileScreen />}
      </main>
    </>
  );
}
