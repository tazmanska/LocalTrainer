// Wymienne źródło danych treningowych: symulacja albo trenażer FTMS / Tacx FE-C i pas tętna przez BLE.

export interface Reading {
  /** null = brak danych (np. urządzenie rozłączone) */
  power?: number | null;
  cadence?: number | null;
  hr?: number | null;
  /** moc zmierzona przez pedały (do podziału na lewą i prawą nogę), W */
  pedalPower?: number | null;
  /** udział lewej nogi w mocy pedałów, % */
  balance?: number | null;
}

export type DeviceState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface DeviceInfo {
  /** nazwa wyświetlana na chipie, np. „KICKR CORE” albo „Symulowany trenażer” */
  label: string;
  kind: 'trainer' | 'hr' | 'pedals';
  connected: boolean;
  state: DeviceState;
  /** komunikat błędu albo stanu do pokazania użytkownikowi */
  message?: string;
}

export interface DataSource {
  readonly id: 'sim' | 'ble';
  devices(): DeviceInfo[];
  connect(): Promise<void>;
  disconnect(): void;
  /** Tryb ERG: moc docelowa w W; null = jazda swobodna (opór nie jest sterowany). */
  setTargetPower(watts: number | null): void;
  /** Subskrypcja odczytów; zwraca funkcję wypisującą. */
  onReading(cb: (r: Reading) => void): () => void;
  /** Zmiana stanu urządzeń (połączenie, rozłączenie, błąd). */
  onChange(cb: () => void): () => void;
}
