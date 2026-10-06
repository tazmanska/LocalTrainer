import type { Profile, ValidationErrors } from '../shared/profile';
import type { Workout } from '../shared/workout';

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
