import { describe, expect, it } from 'vitest';
import { detectLanIp, isOurQuestion } from './mdns';

describe('mDNS', () => {
  it('odpowiada tylko na A/ANY dla własnej nazwy, bez względu na wielkość liter', () => {
    expect(isOurQuestion({ name: 'Trenazer.local', type: 'A' }, 'trenazer.local')).toBe(true);
    expect(isOurQuestion({ name: 'trenazer.local', type: 'ANY' }, 'trenazer.local')).toBe(true);
    expect(isOurQuestion({ name: 'trenazer.local', type: 'AAAA' }, 'trenazer.local')).toBe(false);
    expect(isOurQuestion({ name: 'esphome.local', type: 'A' }, 'trenazer.local')).toBe(false);
  });

  it('wybiera adres LAN z pominięciem mostków Dockera', () => {
    const v4 = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '', mac: '', cidr: null });
    expect(
      detectLanIp({ lo: [v4('127.0.0.1', true)], docker0: [v4('172.17.0.1')], 'br-1a2b': [v4('172.18.0.1')], eth0: [v4('192.168.0.158')] }),
    ).toBe('192.168.0.158');
    expect(detectLanIp({ lo: [v4('127.0.0.1', true)] })).toBeNull();
  });
});
