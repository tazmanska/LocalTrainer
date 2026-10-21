// Trenażer (FTMS albo Tacx FE-C) i pas tętna przez Web Bluetooth.
// Łączenie z ponowieniem, zapamiętywanie urządzeń i kolejka zapisów na podstawie GPX Rider
// (MIT, https://github.com/gpx-rider/gpx-rider.github.io); tryb ERG i automatyczne ponowne łączenie dodane tutaj.

import {
  ANT_ACKNOWLEDGED_DATA,
  crankCadence,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  ANT_BROADCAST_DATA,
  buildAntFrame,
  decodeFecPage,
  encodeFecTargetPower,
  encodeFecTrackResistance,
  encodeSetSimulation,
  encodeFanMetrics,
  encodeSetTargetPower,
  encodeSetTargetIncline,
  encodeSetTargetSpeed,
  FAN_METRICS,
  FAN_SERVICE,
  FAN_STATUS,
  type FanStatus,
  FEC_PAGE_GENERAL,
  FTMS_CONTROL_POINT,
  FTMS_INDOOR_BIKE_DATA,
  FTMS_OPCODE_NAMES,
  FTMS_RESULT_TEXT,
  FTMS_SERVICE,
  FTMS_STATUS,
  FTMS_SUPPORTED_INCLINE_RANGE,
  FTMS_SUPPORTED_SPEED_RANGE,
  FTMS_TREADMILL_DATA,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  OP_REQUEST_CONTROL,
  OP_RESET,
  OP_SET_TARGET_POWER,
  OP_START_OR_RESUME,
  OP_STOP_OR_PAUSE,
  parseAntFrame,
  parseControlPointResponse,
  parseFanStatus,
  parseHeartRate,
  parseIndoorBikeData,
  parseInclineRange,
  parseMachineStatus,
  parsePowerMeasurement,
  parseSpeedRange,
  parseTreadmillData,
  PAUSE,
  type MachineEvent,
  type Range,
  STOP,
  type TreadmillData,
  RESULT_CONTROL_NOT_PERMITTED,
  RESULT_SUCCESS,
  TACX_FEC_NOTIFY,
  TACX_FEC_SERVICE,
  TACX_FEC_WRITE,
} from './protocol';
import { TREADMILL_MAX_KPH } from '../../shared/treadmill';
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

/** Pedały lub korba pomiarowa (Cycling Power Service), np. Favero Assioma Duo: moc, balans L/P i kadencja z korby. */
export class BlePowerMeter extends BleDevice {
  private ch: BluetoothRemoteGATTCharacteristic | null = null;
  private lastCrank: { revs: number; time: number } | null = null;
  private lastCrankMoveAt = 0;
  private cadence: number | null = null;

  constructor(
    changed: () => void,
    private readonly emit: (r: { pedalPower: number | null; balance: number | null; cadence: number | null }) => void,
  ) {
    super('trenazer:pedals', 'pedałami mocy', changed);
  }

  protected requestOptions(): RequestDeviceOptions {
    return { filters: [{ services: [CYCLING_POWER_SERVICE] }] };
  }

  protected async setup(device: BluetoothDevice) {
    const service = await getService(device, CYCLING_POWER_SERVICE);
    this.ch = await service!.getCharacteristic(CYCLING_POWER_MEASUREMENT);
    this.ch.addEventListener('characteristicvaluechanged', this.onMeasurement);
    await this.ch.startNotifications();
  }

  protected teardown() {
    this.ch?.removeEventListener('characteristicvaluechanged', this.onMeasurement);
    this.ch = null;
    this.lastCrank = null;
    this.cadence = null;
    this.emit({ pedalPower: null, balance: null, cadence: null });
  }

  private onMeasurement = (e: Event) => {
    const m = parsePowerMeasurement((e.target as BluetoothRemoteGATTCharacteristic).value!);
    if (!m) return;
    const now = Date.now();
    if (m.crank) {
      if (this.lastCrank) {
        const rpm = crankCadence(this.lastCrank, m.crank);
        if (rpm !== null) {
          this.cadence = rpm;
          this.lastCrankMoveAt = now;
        }
      }
      this.lastCrank = m.crank;
      // brak nowego obrotu korby przez 3 s = kolarz nie pedałuje
      if (now - this.lastCrankMoveAt > 3000) this.cadence = 0;
    }
    this.emit({ pedalPower: Math.max(0, m.power), balance: m.balanceLeft, cadence: m.crank ? Math.round(this.cadence ?? 0) : null });
  };
}

/** Odczyt starszy niż ten czas traktujemy jak brak danych (wentylator przejdzie wtedy na obroty minimalne). */
const FAN_STALE_MS = 5000;
const FAN_SEND_MS = 1000;

/**
 * Wentylator TrainerFan (ESP32 z ESPHome). Pas tętna często przyjmuje tylko jedno połączenie BLE,
 * więc wentylator nie łączy się z czujnikami sam: aplikacja co sekundę przekazuje mu moc i tętno,
 * a poziom nawiewu (progi, tryb mix, podtrzymanie po wysiłku) liczy już wentylator.
 * Wysyłamy także wtedy, gdy wartości się nie zmieniają: przerwa dłuższa niż 5 s to dla wentylatora utrata danych.
 */
export class BleFan extends BleDevice {
  status: FanStatus | null = null;
  private metrics: BluetoothRemoteGATTCharacteristic | null = null;
  private statusCh: BluetoothRemoteGATTCharacteristic | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending = false;

  constructor(
    changed: () => void,
    private readonly latest: () => { power: number | null; hr: number | null },
  ) {
    super('trenazer:fan', 'wentylatorem', changed);
  }

  protected requestOptions(): RequestDeviceOptions {
    return { filters: [{ services: [FAN_SERVICE] }], optionalServices: [FAN_SERVICE] };
  }

  protected async setup(device: BluetoothDevice) {
    const service = await getService(device, FAN_SERVICE);
    this.metrics = await service!.getCharacteristic(FAN_METRICS);
    try {
      this.statusCh = await service!.getCharacteristic(FAN_STATUS);
      this.statusCh.addEventListener('characteristicvaluechanged', this.onStatus);
      await this.statusCh.startNotifications();
    } catch {
      // status jest tylko do podglądu
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.send(), FAN_SEND_MS);
    await this.send();
  }

  protected teardown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.statusCh?.removeEventListener('characteristicvaluechanged', this.onStatus);
    this.statusCh = null;
    this.metrics = null;
    this.sending = false;
    this.status = null;
  }

  /** Wysyła bieżącą moc i tętno (publiczne na potrzeby testów). */
  async send() {
    const ch = this.metrics;
    if (!ch || this.sending) return;
    const { power, hr } = this.latest();
    this.sending = true;
    try {
      const bytes = new Uint8Array(encodeFanMetrics(power, hr));
      // bez odpowiedzi: to strumień co sekundę, zgubiona ramka nic nie psuje
      try {
        await ch.writeValueWithoutResponse(bytes);
      } catch {
        await ch.writeValue(bytes);
      }
    } catch {
      // pojedynczy nieudany zapis pomijamy; zerwane połączenie obsłuży automatyczne ponowne łączenie
    } finally {
      this.sending = false;
    }
  }

  private onStatus = (e: Event) => {
    this.status = parseFanStatus((e.target as BluetoothRemoteGATTCharacteristic).value!);
    this.changed();
  };
}

/**
 * Bieżnia FTMS: odczyt prędkości, dystansu, nachylenia i tętna oraz ustawianie prędkości i nachylenia.
 * Po połączeniu przejmujemy tylko kontrolę; taśma rusza dopiero po kliknięciu Start (start()).
 * Prędkość jest zawsze ograniczona do TREADMILL_MAX_KPH, niezależnie od zakresu bieżni.
 */
export class BleTreadmill extends BleDevice {
  speedRange: Range | null = null;
  inclineRange: Range | null = null;
  /** ostatnie odczyty (scalone z kolejnych pakietów) i diagnostyka odbioru do panelu urządzeń */
  data: TreadmillData = { speedKph: null, distanceM: null, inclinePct: null, hr: null };
  packets = 0;
  lastAt = 0;
  /** ostatni surowy pakiet Treadmill Data (hex), do zgłaszania problemów z konkretną bieżnią */
  lastRaw = '';
  private cp: BluetoothRemoteGATTCharacteristic | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private desired: { speed: number; incline: number | null } | null = null;
  private sent = { speed: null as number | null, incline: null as number | null };
  private writing = false;
  private lastControlRequest = 0;

  constructor(
    changed: () => void,
    private readonly emit: (d: TreadmillData) => void,
    private readonly machine: (e: Exclude<MachineEvent, null>) => void,
  ) {
    super('trenazer:treadmill', 'bieżnią', changed);
  }

  protected requestOptions(): RequestDeviceOptions {
    return { filters: [{ services: [FTMS_SERVICE] }], optionalServices: [FTMS_SERVICE] };
  }

  /** Najwyższa prędkość do ustawienia: limit aplikacji albo niższy limit bieżni. */
  get maxSpeed() {
    return Math.min(TREADMILL_MAX_KPH, this.speedRange?.max || TREADMILL_MAX_KPH);
  }

  get supportsIncline() {
    return this.inclineRange !== null && this.inclineRange.max > this.inclineRange.min;
  }

  protected async setup(device: BluetoothDevice) {
    const ftms = await getService(device, FTMS_SERVICE, true);
    if (!ftms) throw new Error('To urządzenie nie obsługuje FTMS, więc aplikacja nie może sterować bieżnią.');
    let data: BluetoothRemoteGATTCharacteristic;
    try {
      data = await ftms.getCharacteristic(FTMS_TREADMILL_DATA);
    } catch {
      throw new Error('To urządzenie FTMS nie jest bieżnią (brak danych Treadmill Data). Trenażer połączysz w zakładce Treningi.');
    }
    data.addEventListener('characteristicvaluechanged', this.onData);
    await data.startNotifications();
    this.cp = await ftms.getCharacteristic(FTMS_CONTROL_POINT);
    this.cp.addEventListener('characteristicvaluechanged', this.onControlPoint);
    try {
      await this.cp.startNotifications();
    } catch {
      // część urządzeń nie odsyła odpowiedzi punktu sterowania
    }
    try {
      const st = await ftms.getCharacteristic(FTMS_STATUS);
      st.addEventListener('characteristicvaluechanged', this.onStatus);
      await st.startNotifications();
    } catch {
      // status jest opcjonalny
    }
    this.speedRange = await readRange(ftms, FTMS_SUPPORTED_SPEED_RANGE, parseSpeedRange);
    this.inclineRange = await readRange(ftms, FTMS_SUPPORTED_INCLINE_RANGE, parseInclineRange);
    await this.write(Uint8Array.of(OP_REQUEST_CONTROL));
    // Po ponownym połączeniu odtwarzamy cel (bez uruchamiania taśmy).
    this.sent = { speed: null, incline: null };
    void this.flush();
  }

  protected teardown() {
    this.cp = null;
    this.queue = Promise.resolve();
    this.writing = false;
    this.data = { speedKph: null, distanceM: null, inclinePct: null, hr: null };
    this.packets = 0;
    this.lastAt = 0;
    this.lastRaw = '';
    this.emit(this.data);
  }

  /** Uruchomienie lub wznowienie taśmy i ustawienie bieżącego celu. */
  async start() {
    if (!this.cp) return;
    try {
      await this.write(Uint8Array.of(OP_REQUEST_CONTROL));
      await this.write(Uint8Array.of(OP_START_OR_RESUME));
    } catch (e) {
      this.set('error', `Nie udało się uruchomić bieżni: ${(e as Error).message}`);
      return;
    }
    this.sent = { speed: null, incline: null };
    await this.flush();
  }

  /** Pauza taśmy; cel jest zapominany, żeby ponowne połączenie w pauzie nie ruszyło bieżni. */
  pause() {
    this.desired = null;
    return this.write(Uint8Array.of(OP_STOP_OR_PAUSE, PAUSE)).catch(() => {});
  }

  stop() {
    this.desired = null;
    return this.write(Uint8Array.of(OP_STOP_OR_PAUSE, STOP)).catch(() => {});
  }

  /** Prędkość w km/h (ucinana do maxSpeed) i nachylenie w %; null = nachylenie bez zmian. */
  setTarget(speed: number, incline: number | null) {
    const lo = this.speedRange?.min ?? 0;
    const s = Math.round(Math.min(this.maxSpeed, Math.max(lo, speed)) * 10) / 10;
    const r = this.inclineRange;
    const i = incline === null || !r || !this.supportsIncline ? null : Math.round(Math.min(r.max, Math.max(r.min, incline)) * 10) / 10;
    this.desired = { speed: s, incline: i };
    void this.flush();
  }

  /** Wysyła najnowszy cel; gdy zapis trwa, kolejny wyśle się po nim. */
  private async flush() {
    if (this.writing || !this.desired || !this.cp) return;
    const { speed, incline } = this.desired;
    this.writing = true;
    try {
      if (speed !== this.sent.speed) {
        await this.write(encodeSetTargetSpeed(speed));
        this.sent.speed = speed;
      }
      if (incline !== null && incline !== this.sent.incline) {
        await this.write(encodeSetTargetIncline(incline));
        this.sent.incline = incline;
      }
      if (this.state === 'error') this.set('connected');
    } catch (e) {
      this.set('error', `Bieżnia nie przyjęła polecenia: ${(e as Error).message}`);
    } finally {
      this.writing = false;
    }
    const d = this.desired;
    if (d && (d.speed !== this.sent.speed || (d.incline !== null && d.incline !== this.sent.incline)) && this.state !== 'error') {
      void this.flush();
    }
  }

  private write(data: Uint8Array): Promise<void> {
    const bytes = new Uint8Array(data);
    const ch = this.cp;
    if (!ch) return Promise.reject(new Error('bieżnia rozłączona'));
    const task = this.queue.then(async () => {
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
    const why = FTMS_RESULT_TEXT[r.result] ?? String(r.result);
    console.warn(`[bieżnia] ${op}: ${why}`);
    if (r.result === RESULT_CONTROL_NOT_PERMITTED && Date.now() - this.lastControlRequest > 5000) {
      this.lastControlRequest = Date.now();
      this.sent = { speed: null, incline: null };
      void this.write(Uint8Array.of(OP_REQUEST_CONTROL)).then(() => this.flush());
    } else if (r.opcode === OP_START_OR_RESUME) {
      this.set('error', `Bieżnia nie ruszyła na polecenie (${why}). Uruchom ją przyciskiem na konsoli.`);
    }
  };

  /**
   * Bieżnia może dzielić Treadmill Data na kilka powiadomień (bit „More Data”): w części z nich nie ma
   * prędkości, tętna albo dystansu. Pola nieobecne w pakiecie zachowują poprzednią wartość, zamiast znikać.
   */
  private onData = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
    const d = parseTreadmillData(v);
    this.data = {
      speedKph: d.speedKph ?? this.data.speedKph,
      distanceM: d.distanceM ?? this.data.distanceM,
      inclinePct: d.inclinePct ?? this.data.inclinePct,
      hr: d.hr ?? this.data.hr,
    };
    this.packets++;
    this.lastAt = Date.now();
    this.lastRaw = Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), (b) => b.toString(16).padStart(2, '0')).join(' ');
    this.emit(this.data);
    if (this.packets === 1 || this.packets % 5 === 0) this.changed();
  };

  private onStatus = (e: Event) => {
    const ev = parseMachineStatus((e.target as BluetoothRemoteGATTCharacteristic).value!);
    if (ev) this.machine(ev);
  };
}

async function readRange(
  service: BluetoothRemoteGATTService,
  uuid: number,
  parse: (d: DataView) => Range | null,
): Promise<Range | null> {
  try {
    return parse(await (await service.getCharacteristic(uuid)).readValue());
  } catch {
    return null;
  }
}

export type PowerSource = 'pedals' | 'trainer';
const POWER_SOURCE_KEY = 'trenazer:power-source';

/** Źródło danych z prawdziwych urządzeń; żyje przez całą sesję przeglądarki, niezależnie od ekranu treningu. */
export class BleSource implements DataSource {
  readonly id = 'ble' as const;
  readonly trainer: BleTrainer;
  readonly heartRate: BleHeartRate;
  readonly pedals: BlePowerMeter;
  readonly fan: BleFan;
  readonly treadmill: BleTreadmill;
  private treadmillData = new Set<(d: TreadmillData) => void>();
  private machineEvents = new Set<(e: Exclude<MachineEvent, null>) => void>();
  private last = { power: null as number | null, powerAt: 0, hr: null as number | null, hrAt: 0 };
  private readings = new Set<(r: Reading) => void>();
  private changes = new Set<() => void>();
  private source: PowerSource;

  constructor() {
    const changed = () => this.changes.forEach((cb) => cb());
    try {
      this.source = localStorage.getItem(POWER_SOURCE_KEY) === 'trainer' ? 'trainer' : 'pedals';
    } catch {
      this.source = 'pedals';
    }
    this.trainer = new BleTrainer(changed, ({ trainerHr, ...r }) => {
      const out: Reading = {};
      // Moc i kadencja z trenażera, chyba że mierzą je podłączone pedały wybrane jako źródło mocy.
      if (!this.pedalsArePowerSource) {
        if (r.power !== undefined) out.power = r.power;
        if (r.cadence !== undefined) out.cadence = r.cadence;
      }
      // Tętno z trenażera (gdy przekazuje je z własnego odbiornika) tylko wtedy, gdy nie ma osobnego pasa.
      if (this.heartRate.state !== 'connected' && trainerHr !== undefined) out.hr = trainerHr;
      if (Object.keys(out).length) this.emit(out);
    });
    this.heartRate = new BleHeartRate(changed, (hr) => this.emit({ hr }));
    this.pedals = new BlePowerMeter(changed, ({ pedalPower, balance, cadence }) => {
      const out: Reading = { pedalPower, balance };
      if (this.pedalsArePowerSource || pedalPower === null) {
        out.power = pedalPower;
        if (cadence !== null || pedalPower === null) out.cadence = cadence;
      }
      this.emit(out);
    });
    this.fan = new BleFan(changed, () => this.latestForFan());
    this.treadmill = new BleTreadmill(
      changed,
      (d) => {
        this.treadmillData.forEach((cb) => cb(d));
        // Tętno z bieżni (z jej odbiornika lub uchwytów) tylko wtedy, gdy nie ma osobnego pasa.
        if (this.heartRate.state !== 'connected') this.emit({ hr: d.hr });
      },
      (e) => this.machineEvents.forEach((cb) => cb(e)),
    );
  }

  /** Odczyty bieżni (prędkość, dystans, nachylenie, tętno). */
  onTreadmill(cb: (d: TreadmillData) => void) {
    this.treadmillData.add(cb);
    return () => {
      this.treadmillData.delete(cb);
    };
  }

  /** Zatrzymanie, pauza lub start bieżni przyciskiem na jej konsoli. */
  onMachine(cb: (e: Exclude<MachineEvent, null>) => void) {
    this.machineEvents.add(cb);
    return () => {
      this.machineEvents.delete(cb);
    };
  }

  /** Najświeższa moc i tętno dla wentylatora; dane starsze niż 5 s są pomijane. */
  private latestForFan() {
    const now = Date.now();
    return {
      power: now - this.last.powerAt <= FAN_STALE_MS ? this.last.power : null,
      hr: now - this.last.hrAt <= FAN_STALE_MS ? this.last.hr : null,
    };
  }

  get powerSource(): PowerSource {
    return this.source;
  }

  set powerSource(s: PowerSource) {
    this.source = s;
    try {
      localStorage.setItem(POWER_SOURCE_KEY, s);
    } catch {
      // wybór wróci do domyślnego po odświeżeniu
    }
    this.changes.forEach((cb) => cb());
  }

  private get pedalsArePowerSource() {
    return this.source === 'pedals' && this.pedals.state === 'connected';
  }

  devices(): DeviceInfo[] {
    const info = (d: BleDevice, kind: DeviceInfo['kind'], fallback: string): DeviceInfo => ({
      label: d.label || fallback,
      kind,
      connected: d.state === 'connected',
      state: d.state,
      message: d.message,
    });
    const list = [info(this.trainer, 'trainer', 'Trenażer'), info(this.heartRate, 'hr', 'Pas tętna')];
    // pedały i wentylator pokazujemy na ekranie treningu tylko wtedy, gdy są używane
    if (this.pedals.state !== 'idle') list.push(info(this.pedals, 'pedals', 'Pedały'));
    if (this.fan.state !== 'idle') list.push(info(this.fan, 'fan', 'Wentylator'));
    return list;
  }

  /** Pełna lista urządzeń do panelu łączenia, łącznie z niepodłączonymi pedałami. */
  allDevices(): DeviceInfo[] {
    const [t, h] = this.devices() as [DeviceInfo, DeviceInfo];
    const p = this.pedals;
    const f = this.fan;
    return [
      t,
      h,
      { label: p.label || 'Pedały mocy', kind: 'pedals', connected: p.state === 'connected', state: p.state, message: p.message },
      { label: f.label || 'Wentylator', kind: 'fan', connected: f.state === 'connected', state: f.state, message: f.message },
    ];
  }

  /** Ciche połączenie z zapamiętanymi urządzeniami. */
  async connect() {
    await Promise.all([
      this.trainer.reconnectSaved(),
      this.heartRate.reconnectSaved(),
      this.pedals.reconnectSaved(),
      this.fan.reconnectSaved(),
    ]);
  }

  disconnect() {
    this.trainer.disconnect();
    this.heartRate.disconnect();
    this.pedals.disconnect();
    this.fan.disconnect();
    this.treadmill.disconnect();
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

  private emit(r: Reading) {
    const now = Date.now();
    if (r.power !== undefined) this.last = { ...this.last, power: r.power, powerAt: now };
    if (r.hr !== undefined) this.last = { ...this.last, hr: r.hr, hrAt: now };
    this.readings.forEach((cb) => cb(r));
  }
}
