import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, otpauthUri, totpAt, verifyTotp } from './totp';

// RFC 6238 SHA-1 test secret: ASCII "12345678901234567890"
const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const stepOf = (t: number) => Math.floor(t / 30);

describe('totp', () => {
  it('matches the RFC 6238 vectors (last 6 digits)', () => {
    expect(totpAt(secret, stepOf(59))).toBe('287082');
    expect(totpAt(secret, stepOf(1111111109))).toBe('081804');
    expect(totpAt(secret, stepOf(1234567890))).toBe('005924');
  });

  it('accepts steps -1, 0, +1 and rejects +-2', () => {
    const now = 1234567890 * 1000;
    const cur = stepOf(1234567890);
    for (const d of [-1, 0, 1]) expect(verifyTotp(secret, totpAt(secret, cur + d), 0, now)).toBe(cur + d);
    for (const d of [-2, 2]) expect(verifyTotp(secret, totpAt(secret, cur + d), 0, now)).toBeNull();
  });

  it('rejects a step that was already used', () => {
    const now = 1234567890 * 1000;
    const cur = stepOf(1234567890);
    const code = totpAt(secret, cur);
    const used = verifyTotp(secret, code, 0, now);
    expect(used).toBe(cur);
    expect(verifyTotp(secret, code, used!, now)).toBeNull();
    // an older code than the last accepted step is also refused
    expect(verifyTotp(secret, totpAt(secret, cur - 1), used!, now)).toBeNull();
  });

  it('rejects non numeric or malformed codes', () => {
    const now = 1234567890 * 1000;
    for (const bad of ['', 'abcdef', '12345', '1234567', '00 5924', '+05924', '005924 ']) {
      expect(verifyTotp(secret, bad, 0, now)).toBeNull();
    }
  });

  it('base32 round-trips', () => {
    for (const len of [0, 1, 4, 5, 10, 20, 33]) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256));
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('builds an otpauth uri with the issuer', () => {
    const uri = otpauthUri('prova', secret);
    expect(uri).toBe(`otpauth://totp/LQ%20Milano:prova?secret=${secret}&issuer=LQ%20Milano&algorithm=SHA1&digits=6&period=30`);
  });
});
