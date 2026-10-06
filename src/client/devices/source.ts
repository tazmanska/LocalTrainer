// Wymienne źródło danych treningowych. Dziś: symulacja; w kolejnym kroku: trenażer FTMS i pas tętna przez BLE.

export interface Reading {
  power?: number;
  cadence?: number;
  hr?: number;
}

export interface DeviceInfo {
  /** nazwa wyświetlana na chipie, np. „KICKR CORE” albo „Symulowany trenażer” */
  label: string;
  kind: 'trainer' | 'hr';
  connected: boolean;
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
}
