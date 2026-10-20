import { describe, expect, it } from 'vitest';
import { BleSource } from './ble';
import {
  buildAntFrame,
  decodeFecPage,
  encodeFanMetrics,
  encodeFecTargetPower,
  FAN_METRICS,
  FAN_SERVICE,
  FAN_STATUS,
  encodeSetSimulation,
  encodeSetTargetPower,
  FTMS_CONTROL_POINT,
  FTMS_INDOOR_BIKE_DATA,
  FTMS_SERVICE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  parseAntFrame,
  parseControlPointResponse,
  parseFanStatus,
  parseHeartRate,
  parseIndoorBikeData,
  parsePowerMeasurement,
  crankCadence,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  encodeSetTargetIncline,
  encodeSetTargetSpeed,
  FTMS_STATUS,
  FTMS_SUPPORTED_INCLINE_RANGE,
  FTMS_SUPPORTED_SPEED_RANGE,
  FTMS_TREADMILL_DATA,
  parseInclineRange,
  parseMachineStatus,
  parseSpeedRange,
  parseTreadmillData,
  type TreadmillData,
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

describe('kodeki bieżni FTMS', () => {
  it('czyta prędkość, dystans, nachylenie i tętno, pomijając pozostałe pola', () => {
    // flagi 0x01ee: średnia prędkość, dystans, nachylenie + kąt, tempo chwilowe, tempo średnie, energia, tętno
    const d = parseTreadmillData(
      dv(0xee, 0x01, 0xe8, 0x03, 0x10, 0x27, 0x10, 0x27, 0x00, 0x14, 0x00, 0x00, 0x00, 60, 61, 1, 0, 2, 0, 3, 150),
    );
    expect(d).toEqual({ speedKph: 10, distanceM: 10000, inclinePct: 2, hr: 150 });
  });

  it('bez prędkości, gdy ustawiony jest bit More Data', () => {
    expect(parseTreadmillData(dv(0x01, 0x00))).toEqual({ speedKph: null, distanceM: null, inclinePct: null, hr: null });
  });

  it('koduje prędkość i nachylenie docelowe oraz czyta zakresy', () => {
    expect([...encodeSetTargetSpeed(12)]).toEqual([0x02, 0xb0, 0x04]);
    expect([...encodeSetTargetIncline(-1.5)]).toEqual([0x03, 0xf1, 0xff]);
    expect(parseSpeedRange(dv(0x64, 0x00, 0x40, 0x06, 0x0a, 0x00))).toEqual({ min: 1, max: 16 });
    expect(parseInclineRange(dv(0x00, 0x00, 0x96, 0x00, 0x05, 0x00))).toEqual({ min: 0, max: 15 });
  });

  it('rozpoznaje zatrzymanie, pauzę i start z konsoli', () => {
    expect(parseMachineStatus(dv(0x02, 0x01))).toBe('stopped');
    expect(parseMachineStatus(dv(0x02, 0x02))).toBe('paused');
    expect(parseMachineStatus(dv(0x04))).toBe('started');
    expect(parseMachineStatus(dv(0x05, 0xe8, 0x03))).toBeNull();
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

describe('kodeki wentylatora TrainerFan', () => {
  it('koduje moc i tętno z flagami ważności', () => {
    expect([...encodeFanMetrics(250, 142)]).toEqual([0x03, 0xfa, 0x00, 142]);
    expect([...encodeFanMetrics(1000.4, null)]).toEqual([0x01, 0xe8, 0x03, 0]);
    expect([...encodeFanMetrics(null, 130)]).toEqual([0x02, 0, 0, 130]);
    expect([...encodeFanMetrics(null, null)]).toEqual([0x00, 0, 0, 0]);
    expect([...encodeFanMetrics(-5, 300)]).toEqual([0x03, 0, 0, 255]);
  });

  it('czyta status wentylatora', () => {
    expect(parseFanStatus(dv(62, 60, 1))).toEqual({ level: 62, duty: 60, state: 1 });
    expect(parseFanStatus(dv(1, 2))).toBeNull();
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
  async readValue() {
    return this.value!;
  }
  async writeValueWithoutResponse(b: Uint8Array) {
    this.writes.push([...b]);
  }
  push(v: DataView) {
    this.value = v;
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

/** strict: brakująca charakterystyka rzuca błąd jak w przeglądarce (domyślnie dostaje się pustą atrapę) */
function fakeDevice(services: Record<string | number, Record<string | number, FakeChar>>, strict = false) {
  const device = new EventTarget() as EventTarget & { id: string; name: string; gatt: unknown };
  const server = {
    connected: true,
    connect: async () => server,
    disconnect: () => {},
    getPrimaryService: async (uuid: string | number) => {
      const chars = services[uuid];
      if (!chars) throw Object.assign(new Error('No Services matching UUID'), { name: 'NotFoundError' });
      return {
        getCharacteristic: async (c: string | number) => {
          if (chars[c]) return chars[c];
          if (strict) throw Object.assign(new Error('No Characteristics matching UUID'), { name: 'NotFoundError' });
          return new FakeChar();
        },
      };
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

  it('wentylator dostaje najświeższą moc i tętno, a status trafia do podglądu', async () => {
    const bike = new FakeChar();
    const hrChar = new FakeChar();
    const metrics = new FakeChar();
    const status = new FakeChar();
    const src = new BleSource();
    await src.trainer.connectDevice(fakeDevice({ [FTMS_SERVICE]: { [FTMS_CONTROL_POINT]: new FakeChar(), [FTMS_INDOOR_BIKE_DATA]: bike } }));
    await src.heartRate.connectDevice(fakeDevice({ [HEART_RATE_SERVICE]: { [HEART_RATE_MEASUREMENT]: hrChar } }));
    await src.fan.connectDevice(fakeDevice({ [FAN_SERVICE]: { [FAN_METRICS]: metrics, [FAN_STATUS]: status } }));
    expect(metrics.writes.at(-1)).toEqual([0x00, 0, 0, 0]); // jeszcze brak danych
    expect(src.allDevices()[3]).toMatchObject({ kind: 'fan', connected: true });
    expect(src.devices().map((d) => d.kind)).toContain('fan');

    bike.push(dv(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00)); // 250 W
    hrChar.push(dv(0x00, 142));
    await src.fan.send();
    expect(metrics.writes.at(-1)).toEqual([0x03, 0xfa, 0x00, 142]);

    status.push(dv(62, 60, 1));
    expect(src.fan.status).toEqual({ level: 62, duty: 60, state: 1 });
    src.fan.disconnect();
    expect(src.fan.status).toBeNull();
  });

  it('trenażer bez FTMS i FE-C daje czytelny błąd', async () => {
    const src = new BleSource();
    await src.trainer.connectDevice(fakeDevice({}));
    expect(src.devices()[0]).toMatchObject({ state: 'error', connected: false });
    expect(src.devices()[0]!.message).toMatch(/FTMS/);
  });
});

describe('BleTreadmill', () => {
  function treadmill(speedMax = 0x0640) {
    const cp = new FakeChar();
    const data = new FakeChar();
    const status = new FakeChar();
    const speedRange = new FakeChar();
    speedRange.value = dv(0x64, 0x00, speedMax & 0xff, speedMax >> 8, 0x0a, 0x00);
    const inclineRange = new FakeChar();
    inclineRange.value = dv(0x00, 0x00, 0x96, 0x00, 0x05, 0x00);
    const device = fakeDevice({
      [FTMS_SERVICE]: {
        [FTMS_CONTROL_POINT]: cp,
        [FTMS_TREADMILL_DATA]: data,
        [FTMS_STATUS]: status,
        [FTMS_SUPPORTED_SPEED_RANGE]: speedRange,
        [FTMS_SUPPORTED_INCLINE_RANGE]: inclineRange,
      },
    });
    return { cp, data, status, device };
  }

  it('po połączeniu tylko przejmuje kontrolę; taśma rusza dopiero po start()', async () => {
    const { cp, device } = treadmill();
    const src = new BleSource();
    await src.treadmill.connectDevice(device);
    expect(src.treadmill.state).toBe('connected');
    expect(cp.writes).toEqual([[0x00]]);
    expect(src.treadmill.speedRange).toEqual({ min: 1, max: 16 });
    expect(src.treadmill.supportsIncline).toBe(true);

    src.treadmill.setTarget(10, 2);
    await src.treadmill.start();
    await tick();
    expect(cp.writes).toContainEqual([0x07]);
    expect(cp.writes.at(-2)).toEqual([0x02, 0xe8, 0x03]);
    expect(cp.writes.at(-1)).toEqual([0x03, 20, 0]);
  });

  it('nigdy nie ustawia więcej niż 12 km/h ani więcej, niż pozwala bieżnia', async () => {
    const a = treadmill();
    const src = new BleSource();
    await src.treadmill.connectDevice(a.device);
    src.treadmill.setTarget(15, null);
    await tick();
    expect(a.cp.writes.at(-1)).toEqual([0x02, 0xb0, 0x04]); // 12,00 km/h

    const b = treadmill(0x03e8); // bieżnia do 10 km/h
    const src2 = new BleSource();
    await src2.treadmill.connectDevice(b.device);
    expect(src2.treadmill.maxSpeed).toBe(10);
    src2.treadmill.setTarget(11, null);
    await tick();
    expect(b.cp.writes.at(-1)).toEqual([0x02, 0xe8, 0x03]);
  });

  it('przekazuje odczyty, tętno z bieżni bez pasa i zdarzenia z konsoli', async () => {
    const { data, status, device } = treadmill();
    const src = new BleSource();
    const got: TreadmillData[] = [];
    const readings: Reading[] = [];
    const events: string[] = [];
    src.onTreadmill((d) => got.push(d));
    src.onReading((r) => readings.push(r));
    src.onMachine((e) => events.push(e));
    await src.treadmill.connectDevice(device);
    data.push(dv(0x04, 0x01, 0xe8, 0x03, 0x64, 0x00, 0x00, 140)); // prędkość, dystans, tętno
    expect(got.at(-1)).toEqual({ speedKph: 10, distanceM: 100, inclinePct: null, hr: 140 });
    expect(readings.at(-1)).toEqual({ hr: 140 });
    status.push(dv(0x02, 0x02));
    expect(events).toEqual(['paused']);
  });

  it('pauza zapomina cel, żeby ponowne połączenie nie ruszyło taśmy', async () => {
    const { cp, device } = treadmill();
    const src = new BleSource();
    await src.treadmill.connectDevice(device);
    src.treadmill.setTarget(8, null);
    await tick();
    await src.treadmill.pause();
    expect(cp.writes.at(-1)).toEqual([0x08, 0x02]);
    cp.writes = [];
    await src.treadmill.connectDevice(device);
    await tick();
    expect(cp.writes).toEqual([[0x00]]);
  });

  it('trenażer bez Treadmill Data daje czytelny błąd', async () => {
    const src = new BleSource();
    await src.treadmill.connectDevice(
      fakeDevice({ [FTMS_SERVICE]: { [FTMS_CONTROL_POINT]: new FakeChar(), [FTMS_INDOOR_BIKE_DATA]: new FakeChar() } }, true),
    );
    expect(src.treadmill.state).toBe('error');
    expect(src.treadmill.message).toMatch(/nie jest bieżnią/);
  });
});
