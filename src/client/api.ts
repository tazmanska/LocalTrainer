import type { Profile, ValidationErrors } from '../shared/profile';
import type { Workout } from '../shared/workout';
import type { Session, SessionInput, SessionListItem } from '../shared/session';
import type { TreadmillWorkout, TreadmillWorkoutInput } from '../shared/treadmill';

export class ApiValidationError extends Error {
  constructor(public readonly errors: ValidationErrors) {
    super('Niepoprawne dane');
  }
}

export async function getProfile(): Promise<Profile> {
  const res = await fetch('/api/profile');
  if (!res.ok) throw new Error(`Nie udało się wczytać profilu (${res.status})`);
  return res.json();
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (res.status === 400) throw new ApiValidationError((await res.json()).errors ?? {});
  if (!res.ok) throw new Error(`Nie udało się zapisać profilu (${res.status})`);
  return res.json();
}

export async function listWorkouts(): Promise<Workout[]> {
  const res = await fetch('/api/workouts');
  if (!res.ok) throw new Error(`Nie udało się wczytać treningów (${res.status})`);
  return res.json();
}

export async function importWorkout(fileName: string, content: string): Promise<Workout> {
  const res = await fetch('/api/workouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, content }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Nie udało się wczytać pliku (${res.status})`);
  return body;
}

export async function deleteWorkout(id: string): Promise<void> {
  const res = await fetch(`/api/workouts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Nie udało się usunąć treningu (${res.status})`);
}

export async function listSessions(): Promise<SessionListItem[]> {
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error(`Nie udało się wczytać historii (${res.status})`);
  return res.json();
}

export async function getSession(id: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Nie udało się wczytać sesji (${res.status})`);
  return res.json();
}

export async function saveSession(input: SessionInput): Promise<Session> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Nie udało się zapisać sesji (${res.status})`);
  return body;
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Nie udało się usunąć sesji (${res.status})`);
}

export const exportUrl = (id: string, format: 'tcx' | 'gpx') => `/api/sessions/${encodeURIComponent(id)}/export.${format}`;

export async function listTreadmillWorkouts(): Promise<TreadmillWorkout[]> {
  const res = await fetch('/api/treadmill');
  if (!res.ok) throw new Error(`Nie udało się wczytać treningów bieżni (${res.status})`);
  return res.json();
}

/** Zapis nowego treningu (bez id) albo zmian w istniejącym. */
export async function saveTreadmillWorkout(input: TreadmillWorkoutInput, id?: string): Promise<TreadmillWorkout> {
  const res = await fetch(id ? `/api/treadmill/${encodeURIComponent(id)}` : '/api/treadmill', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Nie udało się zapisać treningu (${res.status})`);
  return body;
}

export async function deleteTreadmillWorkout(id: string): Promise<void> {
  const res = await fetch(`/api/treadmill/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Nie udało się usunąć treningu (${res.status})`);
}
