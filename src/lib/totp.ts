// TOTP (RFC 6238, SHA-1, 6 digits, 30 s) built on node:crypto.
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Chiave base32 non valida');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

// HOTP truncation (RFC 4226) over the 8-byte big-endian counter.
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Returns the accepted step, or null when the code is wrong or its step is not
// newer than lastStep (a code can be used only once). Window: -1, 0, +1 steps.
export function verifyTotp(secret: string, code: string, lastStep: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = Math.floor(now / 1000 / PERIOD);
  const given = Buffer.from(code);
  let accepted: number | null = null;
  // No early exit: same work whichever step matches.
  for (const d of [-1, 0, 1]) {
    const step = cur + d;
    const ok = timingSafeEqual(Buffer.from(totpAt(secret, step)), given);
    if (ok && step > lastStep && (accepted === null || step > accepted)) accepted = step;
  }
  return accepted;
}

export function otpauthUri(user: string, secret: string): string {
  const issuer = encodeURIComponent('LQ Milano');
  return `otpauth://totp/${issuer}:${encodeURIComponent(user)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}
