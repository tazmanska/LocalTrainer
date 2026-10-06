import type { Profile, ValidationErrors } from '../shared/profile';

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
