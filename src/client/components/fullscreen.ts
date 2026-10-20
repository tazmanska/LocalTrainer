import { useEffect, useState } from 'react';

export function exitFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

/**
 * Pełny ekran na czas treningu: stan podąża za przeglądarką (także po wyjściu klawiszem Esc),
 * a zamknięcie ekranu treningu (zapis, odrzucenie, zamknięcie) zawsze z niego wychodzi.
 */
export function useFullscreen() {
  const [isFull, setIsFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      exitFullscreen();
    };
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return { isFull, toggle, exit: exitFullscreen };
}
