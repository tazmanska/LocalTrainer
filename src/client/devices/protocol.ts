// Kodeki protokołów Bluetooth bez zależności od przeglądarki (bajty na wejściu, bajty na wyjściu), testowane jednostkowo.
// Na podstawie GPX Rider (MIT, https://github.com/gpx-rider/gpx-rider.github.io), rozszerzone o tryb ERG.
// Licencja: THIRD_PARTY_NOTICES.md.

// ---------- FTMS (Fitness Machine Service) ----------

export const FTMS_SERVICE = 0x1826;
export const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_CONTROL_POINT = 0x2ad9;
export const FTMS_STATUS = 0x2ada;

export const OP_REQUEST_CONTROL = 0x00;
export const OP_RESET = 0x01;
export const OP_SET_TARGET_POWER = 0x05;
export const OP_START_OR_RESUME = 0x07;
export const OP_STOP_OR_PAUSE = 0x08;
export const OP_SET_SIMULATION = 0x11;
export const OP_RESPONSE = 0x80;

export const RESULT_SUCCESS = 0x01;
export const RESULT_CONTROL_NOT_PERMITTED = 0x05;

export const FTMS_RESULT_TEXT: Record<number, string> = {
  0x01: 'OK',
  0x02: 'polecenie nieobsługiwane',
  0x03: 'niepoprawny parametr',
  0x04: 'operacja nieudana',
  0x05: 'brak kontroli nad trenażerem',
};

export const FTMS_OPCODE_NAMES: Record<number, string> = {
  [OP_REQUEST_CONTROL]: 'Request Control',
  [OP_RESET]: 'Reset',
  [OP_SET_TARGET_POWER]: 'Set Target Power',
  [OP_START_OR_RESUME]: 'Start/Resume',
  [OP_STOP_OR_PAUSE]: 'Stop/Pause',
  [OP_SET_SIMULATION]: 'Set Simulation',
};

export interface BikeData {
  speedKph: number | null;
  cadence: number | null;
  power: number | null;
  hr: number | null;
}

/** Indoor Bike Data (0x2AD2): pola występują w kolejności bitów flag. */
export function parseIndoorBikeData(data: DataView): BikeData {
  const out: BikeData = { speedKph: null, cadence: null, power: null, hr: null };
  if (data.byteLength < 2) return out;
  const flags = data.getUint16(0, true);
  let i = 2;

  // Bit 0 „More Data”: gdy jest WYZEROWANY, występuje prędkość chwilowa.
  if ((flags & 0x0001) === 0 && i + 2 <= data.byteLength) {
    out.speedKph = data.getUint16(i, true) / 100;
    i += 2;
  }
  if (flags & 0x0002) i += 2; // średnia prędkość
  if (flags & 0x0004 && i + 2 <= data.byteLength) {
    out.cadence = data.getUint16(i, true) / 2; // jednostka 0,5 rpm
    i += 2;
  }
  if (flags & 0x0008) i += 2; // średnia kadencja
  if (flags & 0x0010) i += 3; // dystans (uint24)
  if (flags & 0x0020) i += 2; // poziom oporu
  if (flags & 0x0040 && i + 2 <= data.byteLength) {
    out.power = data.getInt16(i, true);
    i += 2;
  }
  if (flags & 0x0080) i += 2; // średnia moc
  if (flags & 0x0100) i += 5; // energia: suma, na godzinę, na minutę
  if (flags & 0x0200 && i + 1 <= data.byteLength) {
    const bpm = data.getUint8(i);
    if (bpm > 0) out.hr = bpm;
  }
  return out;
}

export interface ControlPointResponse {
  opcode: number;
  result: number;
}

export function parseControlPointResponse(data: DataView): ControlPointResponse | null {
  if (data.byteLength < 3 || data.getUint8(0) !== OP_RESPONSE) return null;
  return { opcode: data.getUint8(1), result: data.getUint8(2) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tryb ERG: moc docelowa w W (sint16, rozdzielczość 1 W). */
export function encodeSetTargetPower(watts: number): Uint8Array {
  const w = clamp(Math.round(watts), 0, 4000);
  return Uint8Array.from([OP_SET_TARGET_POWER, w & 0xff, (w >> 8) & 0xff]);
}

/** Tryb symulacji: nachylenie w % (sint16, 0,01%), wiatr 0, Crr 0,0064, Cw 0,81 kg/m. */
export function encodeSetSimulation(gradePercent: number): Uint8Array {
  const g = clamp(Math.round(gradePercent * 100), -4000, 4000);
  return Uint8Array.from([OP_SET_SIMULATION, 0x00, 0x00, g & 0xff, (g >> 8) & 0xff, 0x40, 0x51]);
}

// ---------- Heart Rate Service ----------

export const HEART_RATE_SERVICE = 0x180d;
export const HEART_RATE_MEASUREMENT = 0x2a37;

/** Heart Rate Measurement (0x2A37): bit 0 flag wybiera wartość 8- albo 16-bitową. */
export function parseHeartRate(data: DataView): number | null {
  if (data.byteLength < 2) return null;
  const flags = data.getUint8(0);
  const bpm = flags & 0x01 ? (data.byteLength >= 3 ? data.getUint16(1, true) : 0) : data.getUint8(1);
  return bpm > 0 ? bpm : null;
}

// ---------- Tacx FE-C over BLE ----------
// Starsze trenażery Tacx (Flow, Vortex, Bushido, Genius) bez FTMS tunelują strony ANT+ FE-C przez usługę producenta.

export const TACX_FEC_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
export const TACX_FEC_NOTIFY = '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e';
export const TACX_FEC_WRITE = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e';

export const ANT_SYNC = 0xa4;
export const ANT_BROADCAST_DATA = 0x4e;
export const ANT_ACKNOWLEDGED_DATA = 0x4f;

export const FEC_PAGE_GENERAL = 0x10; // 16: prędkość, tętno
export const FEC_PAGE_TRAINER = 0x19; // 25: moc, kadencja
export const FEC_PAGE_TARGET_POWER = 0x31; // 49: moc docelowa (ERG)
export const FEC_PAGE_TRACK_RESISTANCE = 0x33; // 51: nachylenie

export function xorChecksum(bytes: ArrayLike<number>): number {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) c ^= bytes[i]!;
  return c & 0xff;
}

/** Ramka szeregowa ANT: [0xA4][długość][msgId][kanał][8 bajtów danych][XOR]. */
export function buildAntFrame(msgId: number, channel: number, data: Uint8Array): Uint8Array {
  const head = [ANT_SYNC, 1 + data.length, msgId, channel, ...data];
  return Uint8Array.from([...head, xorChecksum(head)]);
}

export function parseAntFrame(bytes: Uint8Array): { msgId: number; channel: number; data: Uint8Array } | null {
  if (bytes.length < 5 || bytes[0] !== ANT_SYNC) return null;
  const total = bytes[1]! + 4;
  if (bytes.length < total) return null;
  const frame = bytes.subarray(0, total);
  if (frame[total - 1] !== xorChecksum(frame.subarray(0, total - 1))) return null;
  return { msgId: frame[2]!, channel: frame[3]!, data: Uint8Array.from(frame.subarray(4, total - 1)) };
}

/** Strona 49 (Target Power): moc w jednostkach 0,25 W. */
export function encodeFecTargetPower(watts: number): Uint8Array {
  const raw = clamp(Math.round(watts * 4), 0, 4000 * 4);
  return Uint8Array.from([FEC_PAGE_TARGET_POWER, 0xff, 0xff, 0xff, 0xff, 0xff, raw & 0xff, (raw >> 8) & 0xff]);
}

/** Strona 51 (Track Resistance): nachylenie 0,01% z przesunięciem −200%, Crr w jednostkach 5·10⁻⁵. */
export function encodeFecTrackResistance(gradePercent: number, crr = 0.004): Uint8Array {
  const raw = clamp(Math.round((clamp(gradePercent, -200, 200) + 200) * 100), 0, 0xfffe);
  const crrRaw = clamp(Math.round(crr / 5e-5), 0, 0xfe);
  return Uint8Array.from([FEC_PAGE_TRACK_RESISTANCE, 0xff, 0xff, 0xff, 0xff, raw & 0xff, (raw >> 8) & 0xff, crrRaw]);
}

export type FecTelemetry = { page: typeof FEC_PAGE_GENERAL; speedKph: number | null; hr: number | null } | { page: typeof FEC_PAGE_TRAINER; cadence: number | null; power: number | null };

/** Odczyt stron telemetrii 16 i 25; pola oznaczone przez trenażer jako nieważne zwracane są jako null. */
export function decodeFecPage(p: Uint8Array): FecTelemetry | null {
  if (p.length < 8) return null;
  if (p[0] === FEC_PAGE_GENERAL) {
    const speed = p[4]! | (p[5]! << 8);
    const hr = p[6]!;
    return { page: FEC_PAGE_GENERAL, speedKph: speed === 0xffff ? null : speed * 0.001 * 3.6, hr: hr === 0xff || hr === 0 ? null : hr };
  }
  if (p[0] === FEC_PAGE_TRAINER) {
    const cad = p[2]!;
    const power = p[5]! | ((p[6]! & 0x0f) << 8);
    return { page: FEC_PAGE_TRAINER, cadence: cad === 0xff ? null : cad, power: power === 0x0fff ? null : power };
  }
  return null;
}

// ---------- Cycling Power Service (pedały i korby pomiarowe, np. Favero Assioma) ----------

export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;

export interface PowerMeasurement {
  power: number;
  /** udział lewej nogi w %, gdy miernik go podaje (obustronne pedały) */
  balanceLeft: number | null;
  /** licznik obrotów korby i czas ostatniego obrotu (1/1024 s), do wyliczenia kadencji */
  crank: { revs: number; time: number } | null;
}

/** Cycling Power Measurement (0x2A63): pola opcjonalne występują w kolejności bitów flag. */
export function parsePowerMeasurement(data: DataView): PowerMeasurement | null {
  if (data.byteLength < 4) return null;
  const flags = data.getUint16(0, true);
  const power = data.getInt16(2, true);
  let i = 4;
  let balanceLeft: number | null = null;
  if (flags & 0x0001) {
    if (i + 1 > data.byteLength) return { power, balanceLeft, crank: null };
    const raw = data.getUint8(i);
    i += 1;
    // jednostka 0,5%; bit 1 flag mówi, czy wartość dotyczy lewej nogi (0 = nieokreślone, traktujemy jak lewą,
    // tak jak robi to większość aplikacji); 0xFF oznacza brak danych
    if (raw !== 0xff) balanceLeft = raw / 2;
  }
  if (flags & 0x0004) i += 2; // skumulowany moment obrotowy
  if (flags & 0x0010) i += 6; // obroty koła: uint32 + czas uint16
  let crank: PowerMeasurement['crank'] = null;
  if (flags & 0x0020 && i + 4 <= data.byteLength) {
    crank = { revs: data.getUint16(i, true), time: data.getUint16(i + 2, true) };
  }
  return { power, balanceLeft, crank };
}

/** Kadencja z dwóch kolejnych odczytów korby (liczniki 16-bitowe zawijają się); null, gdy nie było nowego obrotu. */
export function crankCadence(prev: { revs: number; time: number }, cur: { revs: number; time: number }): number | null {
  const dRevs = (cur.revs - prev.revs + 0x10000) & 0xffff;
  const dTime = (cur.time - prev.time + 0x10000) & 0xffff;
  if (dRevs === 0 || dTime === 0) return null;
  const rpm = (dRevs * 60 * 1024) / dTime;
  return rpm > 250 ? null : rpm;
}
