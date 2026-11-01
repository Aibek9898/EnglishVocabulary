import { beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, groupKey, hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, totp, verifyTotp } from '../lib/totp';

// RFC 6238 test secret: the ASCII bytes of "12345678901234567890".
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('matches the RFC secret and round-trips', () => {
    expect(base32Encode(new TextEncoder().encode('12345678901234567890'))).toBe(RFC);
    expect(new TextDecoder().decode(base32Decode(RFC))).toBe('12345678901234567890');
    expect(base32Decode('gezd gnbv-gy3t')).toEqual(base32Decode('GEZDGNBVGY3T'));
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(() => base32Decode('ABC1')).toThrow();
  });
  it('makes 32-letter secrets', () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(newSecret()).not.toBe(s);
    expect(groupKey('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
});

describe('codes (RFC 6238 test vectors)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at %i s the code is %s', async (seconds, code) => {
    expect(await totp(RFC, seconds * 1000, 8)).toBe(code);
    expect(await totp(RFC, seconds * 1000)).toBe(code.slice(2));
  });
});

describe('checking a code', () => {
  const now = 1_700_000_000_000;
  it('accepts the current code and the ones just before and after', async () => {
    const step = Math.floor(now / 30_000);
    for (const t of [now, now - 30_000, now + 30_000]) {
      const code = await totp(RFC, t);
      const r = await verifyTotp(RFC, code, { now });
      expect(r.ok).toBe(true);
      if (r.ok) expect(Math.abs(r.step - step)).toBeLessThanOrEqual(1);
    }
    expect((await verifyTotp(RFC, ` ${(await totp(RFC, now)).replace(/(\d{3})/, '$1 ')} `, { now })).ok).toBe(true);
  });
  it('refuses old, wrong and malformed codes', async () => {
    expect(await verifyTotp(RFC, await totp(RFC, now - 120_000), { now })).toEqual({ ok: false, reason: 'wrong' });
    expect(await verifyTotp(RFC, '12345', { now })).toEqual({ ok: false, reason: 'wrong' });
    expect(await verifyTotp(RFC, 'abcdef', { now })).toEqual({ ok: false, reason: 'wrong' });
  });
  it('refuses a code that was already used', async () => {
    const code = await totp(RFC, now);
    const first = await verifyTotp(RFC, code, { now });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await verifyTotp(RFC, code, { now, lastStep: first.step })).toEqual({ ok: false, reason: 'used' });
    expect((await verifyTotp(RFC, await totp(RFC, now + 30_000), { now, lastStep: first.step })).ok).toBe(true);
  });
});

describe('setup link and recovery codes', () => {
  it('builds the link Google Authenticator reads', () => {
    expect(otpauthUri('ABC', 'aibek on iPhone', 'Vocab')).toBe(
      'otpauth://totp/Vocab:aibek%20on%20iPhone?secret=ABC&issuer=Vocab&algorithm=SHA1&digits=6&period=30',
    );
  });
  it('makes distinct, readable recovery codes and hashes them loosely', async () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    expect(await hashRecoveryCode('ABCDE-FGHJK')).toBe(await hashRecoveryCode(' abcdefghjk '));
    expect(await hashRecoveryCode('abcde-fghjk')).not.toBe(await hashRecoveryCode('abcde-fghjm'));
  });
});

describe('two-step sign-in on this device', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
  });

  it('turns on only with a matching code, then needs a fresh code or a recovery code', async () => {
    const auth = await import('../lib/auth');
    expect(auth.getTwoFactor()).toBeNull();
    const setup = auth.startSetup();
    expect(setup.uri).toContain(`secret=${setup.secret}`);
    expect(await auth.finishSetup(setup, '000000').then((r) => r.ok && (r.codes.length > 0))).toBe(false);
    expect(auth.getTwoFactor()).toBeNull();

    const code = await totp(setup.secret);
    const done = await auth.finishSetup(setup, code);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const saved = auth.getTwoFactor()!;
    expect(saved.recovery).toHaveLength(8);
    // Only hashes are stored, never the codes themselves.
    expect(store.get('vocab-2fa')).not.toContain(done.codes[0]);

    // The code used for setup can't be used again to sign in.
    expect(await auth.checkSecondStep(code)).toEqual({ ok: false, reason: 'used' });
    expect(await auth.checkSecondStep(await totp(setup.secret, Date.now() + 30_000))).toEqual({ ok: true });

    // A recovery code works once.
    expect(await auth.checkSecondStep(done.codes[3].toUpperCase())).toEqual({ ok: true, recoveryLeft: 7 });
    expect(await auth.checkSecondStep(done.codes[3])).toEqual({ ok: false, reason: 'wrong' });
    expect(await auth.checkSecondStep('nope')).toEqual({ ok: false, reason: 'wrong' });

    const fresh = await auth.renewRecoveryCodes();
    expect(await auth.checkSecondStep(done.codes[0])).toEqual({ ok: false, reason: 'wrong' });
    expect(await auth.checkSecondStep(fresh[0])).toEqual({ ok: true, recoveryLeft: 7 });

    auth.turnOffTwoFactor();
    expect(auth.getTwoFactor()).toBeNull();
  });

  it('names the device for the line in the app', async () => {
    const { deviceName } = await import('../lib/auth');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari')).toBe('Android phone');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(deviceName('')).toBe('this device');
  });
});
