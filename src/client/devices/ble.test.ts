import { describe, expect, it } from 'vitest';
import { BleSource } from './ble';
import {
  buildAntFrame,
  decodeFecPage,
  encodeFecTargetPower,
  encodeSetSimulation,
  encodeSetTargetPower,
  FTMS_CONTROL_POINT,
  FTMS_INDOOR_BIKE_DATA,
  FTMS_SERVICE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  parseAntFrame,
  parseControlPointResponse,
  parseHeartRate,
  parseIndoorBikeData,
  parsePowerMeasurement,
  crankCadence,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
} from './protocol';
import type { Reading } from './source';

const dv = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('kodeki FTMS', () => {
  it('czyta Indoor Bike Data z prędkością, kadencją i mocą', () => {
    // flagi 0x0044: kadencja + moc; bit 0 wyzerowany, więc jest prędkość
    const d = parseIndoorBikeData(dv(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00));
    expect(d).toEqual({ speedKph: 25, cadence: 90, power: 250, hr: null });
  });

  it('pomija pola, których nie używamy, i czyta tętno z trenażera', () => {
    // flagi 0x0254: kadencja, dystans (3 B), moc, tętno; bit 0 wyzerowany
    const d = parseIndoorBikeData(dv(0x54, 0x02, 0x10, 0x27, 0xa0, 0x00, 0x01, 0x02, 0x03, 0x2c, 0x01, 0x8c));
    expect(d).toEqual({ speedKph: 100, cadence: 80, power: 300, hr: 140 });
  });

  it('koduje moc docelową ERG i jazdę swobodną', () => {
    expect([...encodeSetTargetPower(250)]).toEqual([0x05, 0xfa, 0x00]);
    expect([...encodeSetTargetPower(1000.4)]).toEqual([0x05, 0xe8, 0x03]);
    expect([...encodeSetTargetPower(-20)]).toEqual([0x05, 0x00, 0x00]);
    expect([...encodeSetSimulation(0)]).toEqual([0x11, 0, 0, 0, 0, 0x40, 0x51]);
    expect([...encodeSetSimulation(-1.5)].slice(3, 5)).toEqual([0x6a, 0xff]);
  });

  it('czyta odpowiedź punktu sterowania', () => {
    expect(parseControlPointResponse(dv(0x80, 0x05, 0x05))).toEqual({ opcode: 0x05, result: 0x05 });
    expect(parseControlPointResponse(dv(0x05, 0xfa, 0x00))).toBeNull();
  });
});

describe('Cycling Power (pedały)', () => {
  it('czyta moc, balans lewej nogi i dane korby', () => {
    // flagi 0x0023: balans, odniesienie = lewa, dane korby; moc 280 W, balans 102 * 0,5% = 51%, korba 1000 obr., czas 2048
    const m = parsePowerMeasurement(dv(0x23, 0x00, 0x18, 0x01, 102, 0xe8, 0x03, 0x00, 0x08));
    expect(m).toEqual({ power: 280, balanceLeft: 51, crank: { revs: 1000, time: 2048 } });
  });

  it('bez balansu i z pominięciem pól momentu i koła', () => {
    // flagi 0x0034: moment (2 B), koło (6 B), korba
    const m = parsePowerMeasurement(dv(0x34, 0x00, 0xc8, 0x00, 1, 2, 1, 2, 3, 4, 5, 6, 0x0a, 0x00, 0x00, 0x04));
    expect(m).toEqual({ power: 200, balanceLeft: null, crank: { revs: 10, time: 1024 } });
  });

  it('liczy kadencję z korby, także po zawinięciu liczników', () => {
    expect(crankCadence({ revs: 10, time: 0 }, { revs: 11, time: 683 })).toBeCloseTo(90, 0);
    expect(crankCadence({ revs: 0xffff, time: 0xff00 }, { revs: 0, time: 0x01ab })).toBeCloseTo(90, 0);
    expect(crankCadence({ revs: 10, time: 100 }, { revs: 10, time: 100 })).toBeNull();
  });
});

describe('kodeki tętna i Tacx FE-C', () => {
  it('czyta tętno 8- i 16-bitowe', () => {
    expect(parseHeartRate(dv(0x00, 142))).toBe(142);
    expect(parseHeartRate(dv(0x01, 0x2c, 0x01))).toBe(300);
    expect(parseHeartRate(dv(0x00, 0))).toBeNull();
  });

  it('koduje moc docelową FE-C (strona 49, 0,25 W) i ramkę ANT z sumą kontrolną', () => {
    const page = encodeFecTargetPower(250);
    expect([...page]).toEqual([0x31, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe8, 0x03]);
    const frame = buildAntFrame(0x4f, 5, page);
    expect(parseAntFrame(frame)).toEqual({ msgId: 0x4f, channel: 5, data: page });
    frame[frame.length - 1]! ^= 1;
    expect(parseAntFrame(frame)).toBeNull();
  });

  it('czyta moc i kadencję ze strony 25', () => {
    expect(decodeFecPage(Uint8Array.from([0x19, 0, 88, 0, 0, 0x2c, 0x01, 0]))).toEqual({ page: 0x19, cadence: 88, power: 300 });
  });
});

// ---- atrapa urządzenia Bluetooth ----

class FakeChar extends EventTarget {
  writes: number[][] = [];
  value: DataView | undefined;
  async startNotifications() {
    return this;
  }
  async writeValue(b: Uint8Array) {
    this.writes.push([...b]);
  }
  async writeValueWithoutResponse(b: Uint8Array) {
    this.writes.push([...b]);
  }
  push(v: DataView) {
    this.value = v;
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

function fakeDevice(services: Record<number, Record<number, FakeChar>>) {
  const device = new EventTarget() as EventTarget & { id: string; name: string; gatt: unknown };
  const server = {
    connected: true,
    connect: async () => server,
    disconnect: () => {},
    getPrimaryService: async (uuid: number) => {
      const chars = services[uuid];
      if (!chars) throw Object.assign(new Error('No Services matching UUID'), { name: 'NotFoundError' });
      return { getCharacteristic: async (c: number) => chars[c] ?? new FakeChar() };
    },
  };
  Object.assign(device, { id: 'dev1', name: 'KICKR CORE 1234', gatt: server });
  return device as unknown as BluetoothDevice;
}

describe('BleSource', () => {
  it('przejmuje kontrolę, wysyła ERG bez duplikatów i przekazuje odczyty', async () => {
    const cp = new FakeChar();
    const bike = new FakeChar();
    const src = new BleSource();
    const readings: Reading[] = [];
    src.onReading((r) => readings.push(r));

    await src.trainer.connectDevice(fakeDevice({ [FTMS_SERVICE]: { [FTMS_CONTROL_POINT]: cp, [FTMS_INDOOR_BIKE_DATA]: bike } }));
    expect(src.devices()[0]).toMatchObject({ label: 'KICKR CORE 1234', connected: true, state: 'connected' });
    expect(cp.writes).toEqual([[0x00], [0x01], [0x00], [0x07]]);

    src.setTargetPower(200);
    src.setTargetPower(200);
    await tick();
    src.setTargetPower(null);
    await tick();
    expect(cp.writes.slice(4)).toEqual([[0x05, 200, 0], [0x11, 0, 0, 0, 0, 0x40, 0x51]]);

    bike.push(dv(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00));
    expect(readings.at(-1)).toEqual({ power: 250, cadence: 90, hr: null });
  });

  it('po odmowie kontroli odzyskuje ją i ponawia cel', async () => {
    const cp = new FakeChar();
    const src = new BleSource();
    await src.trainer.connectDevice(fakeDevice({ [FTMS_SERVICE]: { [FTMS_CONTROL_POINT]: cp, [FTMS_INDOOR_BIKE_DATA]: new FakeChar() } }));
    src.setTargetPower(180);
    await tick();
    cp.writes = [];
    cp.push(dv(0x80, 0x05, 0x05));
    await tick();
    await tick();
    expect(cp.writes).toEqual([[0x00], [0x05, 180, 0]]);
  });

  it('pas tętna ma pierwszeństwo przed tętnem z trenażera', async () => {
    const hrChar = new FakeChar();
    const bike = new FakeChar();
    const src = new BleSource();
    const readings: Reading[] = [];
    src.onReading((r) => readings.push(r));
    await src.trainer.connectDevice(fakeDevice({ [FTMS_SERVICE]: { [FTMS_CONTROL_POINT]: new FakeChar(), [FTMS_INDOOR_BIKE_DATA]: bike } }));
    bike.push(dv(0x40, 0x02, 0x00, 0x00, 0x64, 0x00, 0x78)); // moc 100, tętno 120 z trenażera
    expect(readings.at(-1)).toMatchObject({ power: 100, hr: 120 });

    await src.heartRate.connectDevice(fakeDevice({ [HEART_RATE_SERVICE]: { [HEART_RATE_MEASUREMENT]: hrChar } }));
    hrChar.push(dv(0x00, 133));
    bike.push(dv(0x40, 0x02, 0x00, 0x00, 0x64, 0x00, 0x78));
    expect(readings.at(-2)).toEqual({ hr: 133 });
    expect(readings.at(-1)).toEqual({ power: 100, cadence: null });
  });

  it('pedały jako źródło mocy zastępują moc trenażera, a po przełączeniu wraca moc trenażera', async () => {
    const bike = new FakeChar();
    const pm = new FakeChar();
    const src = new BleSource();
    src.powerSource = 'pedals';
    const readings: Reading[] = [];
    src.onReading((r) => readings.push(r));
    await src.trainer.connectDevice(fakeDevice({ [FTMS_SERVICE]: { [FTMS_CONTROL_POINT]: new FakeChar(), [FTMS_INDOOR_BIKE_DATA]: bike } }));
    await src.pedals.connectDevice(fakeDevice({ [CYCLING_POWER_SERVICE]: { [CYCLING_POWER_MEASUREMENT]: pm } }));

    pm.push(dv(0x03, 0x00, 0x18, 0x01, 102));
    expect(readings.at(-1)).toEqual({ pedalPower: 280, balance: 51, power: 280 });
    bike.push(dv(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00));
    expect(readings.at(-1)).toEqual({ hr: null }); // moc i kadencja z trenażera pominięte

    src.powerSource = 'trainer';
    bike.push(dv(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00));
    expect(readings.at(-1)).toMatchObject({ power: 250, cadence: 90 });
    pm.push(dv(0x03, 0x00, 0x18, 0x01, 102));
    expect(readings.at(-1)).toEqual({ pedalPower: 280, balance: 51 });
  });

  it('trenażer bez FTMS i FE-C daje czytelny błąd', async () => {
    const src = new BleSource();
    await src.trainer.connectDevice(fakeDevice({}));
    expect(src.devices()[0]).toMatchObject({ state: 'error', connected: false });
    expect(src.devices()[0]!.message).toMatch(/FTMS/);
  });
});
