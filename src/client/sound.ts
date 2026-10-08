// Krótkie sygnały dźwiękowe generowane w przeglądarce (bez plików audio).

let ctx: AudioContext | null = null;

/**
 * Przygotowanie dźwięku. Przeglądarka pozwala uruchomić audio dopiero po geście użytkownika,
 * więc wywołujemy to przy kliknięciu Start / Wznów.
 */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, seconds: number, volume = 0.25) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // łagodne narastanie i wygaszenie, żeby nie było trzasków
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.setValueAtTime(volume, t + seconds - 0.03);
  gain.gain.linearRampToValueAtTime(0, t + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

/** Odliczanie ostatnich sekund etapu. */
export const countdownBeep = () => tone(880, 0.12);
/** Początek nowego etapu: wyższy i dłuższy ton. */
export const segmentStartBeep = () => tone(1320, 0.4, 0.3);

const MUTE_KEY = 'trenazer:muted';

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeMuted(m: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // ustawienie wróci do domyślnego po odświeżeniu
  }
}
