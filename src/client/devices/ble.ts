// Trenażer (FTMS albo Tacx FE-C) i pas tętna przez Web Bluetooth.
// Łączenie z ponowieniem, zapamiętywanie urządzeń i kolejka zapisów na podstawie GPX Rider
// (MIT, https://github.com/gpx-rider/gpx-rider.github.io); tryb ERG i automatyczne ponowne łączenie dodane tutaj.

import {
  ANT_ACKNOWLEDGED_DATA,
  ANT_BROADCAST_DATA,
  buildAntFrame,
  decodeFecPage,
  encodeFecTargetPower,
  encodeFecTrackResistance,
  encodeSetSimulation,
  encodeSetTargetPower,
  FEC_PAGE_GENERAL,
  FTMS_CONTROL_POINT,
  FTMS_INDOOR_BIKE_DATA,
  FTMS_OPCODE_NAMES,
  FTMS_RESULT_TEXT,
  FTMS_SERVICE,
  FTMS_STATUS,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  OP_REQUEST_CONTROL,
  OP_RESET,
  OP_SET_TARGET_POWER,
  OP_START_OR_RESUME,
  parseAntFrame,
  parseControlPointResponse,
  parseHeartRate,
  parseIndoorBikeData,
  RESULT_CONTROL_NOT_PERMITTED,
  RESULT_SUCCESS,
  TACX_FEC_NOTIFY,
  TACX_FEC_SERVICE,
  TACX_FEC_WRITE,
} from './protocol';
import type { DataSource, DeviceInfo, DeviceState, Reading } from './source';

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000];
const GATT_RETRY_DELAY_MS = 350;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Komunikat, gdy Bluetooth w tej przeglądarce jest niedostępny; null, gdy można łączyć. */
export function bluetoothUnavailable(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Bluetooth działa tylko na stronie otwartej przez HTTPS albo pod localhost.';
  }
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    return 'Ta przeglądarka nie obsługuje Bluetooth. Użyj Chrome lub Edge na komputerze albo Androidzie.';
  }
  return null;
}

const isGattDisconnected = (e: unknown) =>
  /GATT Server is disconnected|Cannot retrieve services|disconnected/i.test((e as Error)?.message ?? '');
const isNotFound = (e: unknown) =>
  (e as Error)?.name === 'NotFoundError' || /No Services matching|not found/i.test((e as Error)?.message ?? '');
const isUserCancel = (e: unknown) => (e as Error)?.name === 'NotFoundError' && /cancel/i.test((e as Error)?.message ?? '');

async function connectGatt(device: BluetoothDevice): Promise<BluetoothRemoteGATTServer> {
  if (!device.gatt) throw new Error('To urządzenie nie udostępnia usług Bluetooth (GATT).');
  return device.gatt.connected ? device.gatt : device.gatt.connect();
}

/** Usługa z jednym ponowieniem, bo część urządzeń zrywa połączenie w trakcie wykrywania usług. */
async function getService(device: BluetoothDevice, uuid: BluetoothServiceUUID, optional = false) {
  try {
    return await (await connectGatt(device)).getPrimaryService(uuid);
  } catch (e) {
    if (optional && isNotFound(e)) return null;
    if (!isGattDisconnected(e)) throw e;
    try {
      device.gatt?.disconnect();
    } catch {
      // już rozłączone
    }
    await delay(GATT_RETRY_DELAY_MS);
    try {
      return await (await connectGatt(device)).getPrimaryService(uuid);
    } catch (e2) {
      if (optional && isNotFound(e2)) return null;
      throw e2;
    }
  }
}

function errorMessage(e: unknown, what: string): string {
  if (isGattDisconnected(e)) return `Nie udało się utrzymać połączenia z ${what}. Obudź urządzenie, zbliż je i połącz ponownie.`;
  return (e as Error)?.message || `Nie udało się połączyć z ${what}.`;
}

interface Saved {
  id: string;
  name: string;
}
const load = (key: string): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
const save = (key: string, v: Saved) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // brak dostępu do pamięci przeglądarki; urządzenie trzeba będzie wybrać ponownie
  }
};

/** Wspólna obsługa jednego urządzenia: stan, zapamiętanie, rozłączenie i automatyczne ponowne łączenie. */
abstract class BleDevice {
  device: BluetoothDevice | null = null;
  state: DeviceState = 'idle';
  message: string | undefined;
  private manualDisconnect = false;
  private reconnecting = false;

  constructor(
    protected readonly storageKey: string,
    protected readonly what: string,
    protected readonly changed: () => void,
  ) {}

  get label() {
    return this.device?.name || load(this.storageKey)?.name || '';
  }

  protected abstract requestOptions(): RequestDeviceOptions;
  /** Wykrycie usług i subskrypcje; wołane przy pierwszym połączeniu i po każdym ponownym. */
  protected abstract setup(device: BluetoothDevice): Promise<void>;
  /** Wyzerowanie stanu protokołu po utracie połączenia. */
  protected abstract teardown(): void;

  protected set(state: DeviceState, message?: string) {
    this.state = state;
    this.message = message;
    this.changed();
  }

  /** Wybór urządzenia w oknie przeglądarki; musi być wywołane bezpośrednio z kliknięcia. */
  async pair() {
    const unavailable = bluetoothUnavailable();
    if (unavailable) return this.set('error', unavailable);
    let device: BluetoothDevice;
    try {
      this.set('connecting');
      device = await navigator.bluetooth.requestDevice(this.requestOptions());
    } catch (e) {
      return isUserCancel(e) ? this.set(this.device ? 'connected' : 'idle') : this.set('error', errorMessage(e, this.what));
    }
    await this.connectDevice(device);
  }

  /** Ciche połączenie z zapamiętanym urządzeniem (bez okna wyboru), jeśli przeglądarka na to pozwala. */
  async reconnectSaved() {
    const saved = load(this.storageKey);
    if (!saved || this.device || bluetoothUnavailable() || !navigator.bluetooth.getDevices) return;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const device = devices.find((d) => d.id === saved.id) ?? devices.find((d) => d.name === saved.name);
      if (device) await this.connectDevice(device);
    } catch {
      // brak uprawnień do listy urządzeń; użytkownik połączy ręcznie
    }
  }

  /** Połączenie z już wybranym urządzeniem (po oknie wyboru, z listy zapamiętanych albo w testach). */
  async connectDevice(device: BluetoothDevice) {
    this.disconnectQuietly();
    this.manualDisconnect = false;
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
    this.device = device;
    this.set('connecting');
    try {
      await this.setup(device);
      save(this.storageKey, { id: device.id, name: device.name || this.what });
      this.set('connected');
    } catch (e) {
      device.removeEventListener('gattserverdisconnected', this.onDisconnected);
      this.teardown();
      this.device = null;
      try {
        device.gatt?.disconnect();
      } catch {
        // już rozłączone
      }
      this.set('error', errorMessage(e, this.what));
    }
  }

  disconnect() {
    this.disconnectQuietly();
    this.set('idle');
  }

  private disconnectQuietly() {
    const d = this.device;
    if (!d) return;
    this.manualDisconnect = true;
    d.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.teardown();
    this.device = null;
    try {
      d.gatt?.disconnect();
    } catch {
      // już rozłączone
    }
  }

  private onDisconnected = () => {
    this.teardown();
    if (this.manualDisconnect || !this.device) return;
    void this.autoReconnect(this.device);
  };

  /** Po zerwaniu połączenia w trakcie jazdy próbujemy wrócić bez udziału użytkownika. */
  private async autoReconnect(device: BluetoothDevice) {
    if (this.reconnecting) return;
    this.reconnecting = true;
    for (let i = 0; i < RECONNECT_DELAYS_MS.length; i++) {
      this.set('reconnecting', `Ponowne łączenie (${i + 1}/${RECONNECT_DELAYS_MS.length})…`);
      await delay(RECONNECT_DELAYS_MS[i]!);
      if (this.manualDisconnect || this.device !== device) break;
      try {
        await this.setup(device);
        this.reconnecting = false;
        this.set('connected');
        return;
      } catch {
        this.teardown();
      }
    }
    this.reconnecting = false;
    if (this.device === device && !this.manualDisconnect) {
      this.set('error', `Utracono połączenie z ${this.what}. Połącz ponownie.`);
    }
  }
}

type WriteTarget = { kind: 'erg'; watts: number } | { kind: 'free' };
const targetKey = (t: WriteTarget) => (t.kind === 'erg' ? `erg:${t.watts}` : 'free');

export class BleTrainer extends BleDevice {
  protocol: 'ftms' | 'fec' | null = null;
  private cp: BluetoothRemoteGATTCharacteristic | null = null;
  private fecWrite: BluetoothRemoteGATTCharacteristic | null = null;
  private fecFraming: 'raw' | 'ant' = 'raw';
  private fecChannel = 0x05;
  private fec = { power: null as number | null, cadence: null as number | null, hr: null as number | null };
  private queue: Promise<unknown> = Promise.resolve();
  private desired: WriteTarget | null = null;
  private sent: string | null = null;
  private writing = false;
  private lastControlRequest = 0;

  constructor(
    changed: () => void,
    private readonly emit: (r: Reading & { trainerHr?: number | null }) => void,
  ) {
    super('trenazer:trainer', 'trenażerem', changed);
  }

  protected requestOptions(): RequestDeviceOptions {
    return {
      filters: [{ services: [FTMS_SERVICE] }, { services: [TACX_FEC_SERVICE] }, { namePrefix: 'KICKR' }, { namePrefix: 'Tacx' }],
      optionalServices: [FTMS_SERVICE, TACX_FEC_SERVICE],
    };
  }

  protected async setup(device: BluetoothDevice) {
    // FTMS najpierw; Tacx FE-C dla starszych trenażerów Tacx bez FTMS.
    const ftms = await getService(device, FTMS_SERVICE, true);
    if (ftms) {
      this.cp = await ftms.getCharacteristic(FTMS_CONTROL_POINT);
      this.cp.addEventListener('characteristicvaluechanged', this.onControlPoint);
      try {
        await this.cp.startNotifications();
      } catch {
        // część trenażerów nie odsyła odpowiedzi punktu sterowania
      }
      const bike = await ftms.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
      bike.addEventListener('characteristicvaluechanged', this.onBikeData);
      await bike.startNotifications();
      try {
        await (await ftms.getCharacteristic(FTMS_STATUS)).startNotifications();
      } catch {
        // status jest opcjonalny
      }
      this.protocol = 'ftms';
      // Przejęcie kontroli, reset celu pozostawionego przez inną aplikację, ponowne przejęcie (reset je odbiera) i start.
      await this.write(Uint8Array.of(OP_REQUEST_CONTROL));
      await this.write(Uint8Array.of(OP_RESET));
      await this.write(Uint8Array.of(OP_REQUEST_CONTROL));
      await this.write(Uint8Array.of(OP_START_OR_RESUME));
    } else {
      const fec = await getService(device, TACX_FEC_SERVICE, true);
      if (!fec) throw new Error('Ten trenażer nie obsługuje ani FTMS, ani Tacx FE-C przez Bluetooth.');
      const notify = await fec.getCharacteristic(TACX_FEC_NOTIFY);
      this.fecWrite = await fec.getCharacteristic(TACX_FEC_WRITE);
      notify.addEventListener('characteristicvaluechanged', this.onFec);
      await notify.startNotifications();
      this.protocol = 'fec';
    }
    // Po (ponownym) połączeniu odtwarzamy bieżący cel.
    this.sent = null;
    void this.flush();
  }

  protected teardown() {
    this.cp = null;
    this.fecWrite = null;
    this.protocol = null;
    this.fecFraming = 'raw';
    this.fec = { power: null, cadence: null, hr: null };
    this.queue = Promise.resolve();
    this.writing = false;
    this.emit({ power: null, cadence: null, trainerHr: null });
  }

  setTarget(watts: number | null) {
    this.desired = watts === null ? { kind: 'free' } : { kind: 'erg', watts: Math.round(watts) };
    void this.flush();
  }

  /** Wysyła najnowszy cel; gdy zapis trwa, kolejny wyśle się po nim (pośrednie wartości są pomijane). */
  private async flush() {
    if (this.writing || !this.desired || (!this.cp && !this.fecWrite)) return;
    const t = this.desired;
    const key = targetKey(t);
    if (key === this.sent) return;
    this.writing = true;
    try {
      await this.write(this.encode(t));
      this.sent = key;
      if (this.state === 'error') this.set('connected');
    } catch (e) {
      this.set('error', `Trenażer nie przyjął polecenia: ${(e as Error).message}`);
    } finally {
      this.writing = false;
    }
    if (this.desired && targetKey(this.desired) !== this.sent && this.state !== 'error') void this.flush();
  }

  private encode(t: WriteTarget): Uint8Array {
    if (this.protocol === 'fec') {
      const page = t.kind === 'erg' ? encodeFecTargetPower(t.watts) : encodeFecTrackResistance(0);
      return this.fecFraming === 'ant' ? buildAntFrame(ANT_ACKNOWLEDGED_DATA, this.fecChannel, page) : page;
    }
    // Jazda swobodna w FTMS: tryb symulacji z płaską drogą zamiast sztywnego oporu.
    return t.kind === 'erg' ? encodeSetTargetPower(t.watts) : encodeSetSimulation(0);
  }

  /** Urządzenie przyjmuje jedną operację GATT naraz, więc wszystkie zapisy idą przez kolejkę. */
  private write(data: Uint8Array): Promise<void> {
    const bytes = new Uint8Array(data);
    const ch = this.cp ?? this.fecWrite;
    if (!ch) return Promise.reject(new Error('trenażer rozłączony'));
    const task = this.queue.then(async () => {
      // Write Request, żeby trenażer potraktował to jako polecenie sterujące; bez odpowiedzi tylko dla niezgodnych urządzeń.
      try {
        await ch.writeValue(bytes);
      } catch {
        await ch.writeValueWithoutResponse(bytes);
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  private onControlPoint = (e: Event) => {
    const r = parseControlPointResponse((e.target as BluetoothRemoteGATTCharacteristic).value!);
    if (!r || r.result === RESULT_SUCCESS) return;
    const op = FTMS_OPCODE_NAMES[r.opcode] ?? `0x${r.opcode.toString(16)}`;
    console.warn(`[trenażer] ${op}: ${FTMS_RESULT_TEXT[r.result] ?? r.result}`);
    // Inna aplikacja przejęła kontrolę albo trenażer ją zgubił: odzyskujemy ją i ponawiamy cel (najwyżej co 5 s).
    if (r.result === RESULT_CONTROL_NOT_PERMITTED && Date.now() - this.lastControlRequest > 5000) {
      this.lastControlRequest = Date.now();
      this.sent = null;
      void this.write(Uint8Array.of(OP_REQUEST_CONTROL)).then(() => this.flush());
    } else if (r.opcode === OP_SET_TARGET_POWER) {
      this.set('error', `Trenażer odrzucił moc docelową: ${FTMS_RESULT_TEXT[r.result] ?? r.result}`);
    }
  };

  private onBikeData = (e: Event) => {
    const d = parseIndoorBikeData((e.target as BluetoothRemoteGATTCharacteristic).value!);
    this.emit({ power: d.power, cadence: d.cadence, trainerHr: d.hr });
  };

  private onFec = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
    let page = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const frame = parseAntFrame(page);
    if (frame && (frame.msgId === ANT_BROADCAST_DATA || frame.msgId === ANT_ACKNOWLEDGED_DATA)) {
      // Urządzenie owija strony w ramki ANT: zapisy muszą robić to samo, na tym samym kanale.
      if (this.fecFraming !== 'ant') this.sent = null;
      this.fecFraming = 'ant';
      this.fecChannel = frame.channel;
      page = frame.data;
    }
    const t = decodeFecPage(page);
    if (!t) return;
    if (t.page === FEC_PAGE_GENERAL) this.fec.hr = t.hr;
    else {
      this.fec.power = t.power;
      this.fec.cadence = t.cadence;
    }
    this.emit({ power: this.fec.power, cadence: this.fec.cadence, trainerHr: this.fec.hr });
    if (this.sent === null) void this.flush();
  };
}

export class BleHeartRate extends BleDevice {
  private ch: BluetoothRemoteGATTCharacteristic | null = null;

  constructor(
    changed: () => void,
    private readonly emit: (hr: number | null) => void,
  ) {
    super('trenazer:hr', 'pasem tętna', changed);
  }

  protected requestOptions(): RequestDeviceOptions {
    return { filters: [{ services: [HEART_RATE_SERVICE] }] };
  }

  protected async setup(device: BluetoothDevice) {
    const service = await getService(device, HEART_RATE_SERVICE);
    this.ch = await service!.getCharacteristic(HEART_RATE_MEASUREMENT);
    this.ch.addEventListener('characteristicvaluechanged', this.onMeasurement);
    await this.ch.startNotifications();
  }

  protected teardown() {
    this.ch?.removeEventListener('characteristicvaluechanged', this.onMeasurement);
    this.ch = null;
    this.emit(null);
  }

  private onMeasurement = (e: Event) => {
    this.emit(parseHeartRate((e.target as BluetoothRemoteGATTCharacteristic).value!));
  };
}

/** Źródło danych z prawdziwych urządzeń; żyje przez całą sesję przeglądarki, niezależnie od ekranu treningu. */
export class BleSource implements DataSource {
  readonly id = 'ble' as const;
  readonly trainer: BleTrainer;
  readonly heartRate: BleHeartRate;
  private readings = new Set<(r: Reading) => void>();
  private changes = new Set<() => void>();
  private strapHr: number | null = null;

  constructor() {
    const changed = () => this.changes.forEach((cb) => cb());
    this.trainer = new BleTrainer(changed, ({ trainerHr, ...r }) => {
      // Tętno z trenażera (gdy przekazuje je z własnego odbiornika) tylko wtedy, gdy nie ma osobnego pasa.
      const out: Reading = { ...r };
      if (this.heartRate.state !== 'connected' && trainerHr !== undefined) out.hr = trainerHr;
      this.emit(out);
    });
    this.heartRate = new BleHeartRate(changed, (hr) => {
      this.strapHr = hr;
      this.emit({ hr });
    });
  }

  devices(): DeviceInfo[] {
    const info = (d: BleDevice, kind: 'trainer' | 'hr', fallback: string): DeviceInfo => ({
      label: d.label || fallback,
      kind,
      connected: d.state === 'connected',
      state: d.state,
      message: d.message,
    });
    return [info(this.trainer, 'trainer', 'Trenażer'), info(this.heartRate, 'hr', 'Pas tętna')];
  }

  /** Ciche połączenie z zapamiętanymi urządzeniami. */
  async connect() {
    await Promise.all([this.trainer.reconnectSaved(), this.heartRate.reconnectSaved()]);
  }

  disconnect() {
    this.trainer.disconnect();
    this.heartRate.disconnect();
  }

  setTargetPower(watts: number | null) {
    this.trainer.setTarget(watts);
  }

  onReading(cb: (r: Reading) => void) {
    this.readings.add(cb);
    return () => {
      this.readings.delete(cb);
    };
  }

  onChange(cb: () => void) {
    this.changes.add(cb);
    return () => {
      this.changes.delete(cb);
    };
  }

  get lastStrapHr() {
    return this.strapHr;
  }

  private emit(r: Reading) {
    this.readings.forEach((cb) => cb(r));
  }
}
