import { describe, expect, it } from 'vitest';
import { BodyTooLarge, readSmallForm } from './request-limits';

const form = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/admin/login', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });

// A body without content-length, delivered in chunks (as with chunked encoding).
const streamed = (size: number) => {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= size) return ctrl.close();
      const n = Math.min(4096, size - sent);
      sent += n;
      ctrl.enqueue(new Uint8Array(n).fill(97));
    },
  });
  return new Request('http://localhost/api/admin/login', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  } as RequestInit);
};

describe('readSmallForm', () => {
  it('parses a normal login form', async () => {
    const f = await readSmallForm(form('user=anna&password=segreta&next=%2Fadmin'));
    expect(f.get('user')).toBe('anna');
    expect(f.get('next')).toBe('/admin');
  });

  it('rejects a declared content-length above the limit before reading', async () => {
    await expect(readSmallForm(form('user=a', { 'content-length': String(10 * 1024 * 1024) }), 1024)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it('stops reading a streamed body as soon as it exceeds the limit', async () => {
    await expect(readSmallForm(streamed(200 * 1024), 16 * 1024)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it('parses multipart with a boundary like request.formData()', async () => {
    const fd = new FormData();
    fd.set('user', 'anna'); fd.set('code', '123 456');
    const req = new Request('http://localhost/api/admin/login-code', { method: 'POST', body: fd });
    const f = await readSmallForm(req);
    expect(f.get('user')).toBe('anna');
    expect(f.get('code')).toBe('123 456');
  });

  it('gives an empty form for an empty urlencoded body', async () => {
    const f = await readSmallForm(form(''));
    expect([...f.keys()]).toEqual([]);
  });

  it('rejects a body without a form content type (the routes treat it as a failed login)', async () => {
    const req = new Request('http://localhost/api/admin/login', { method: 'POST', body: 'user=a' , headers: { 'content-type': 'text/plain' } });
    await expect(readSmallForm(req)).rejects.toBeInstanceOf(TypeError);
  });

  it('accepts a streamed body under the limit', async () => {
    const f = await readSmallForm(streamed(100), 16 * 1024);
    expect([...f.keys()].length).toBe(1);
  });
});
