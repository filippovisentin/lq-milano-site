// Small-body reader for the open login routes. A login form is a few hundred
// bytes: read at most `max` bytes before parsing, so an anonymous client cannot
// make the server buffer a huge body (the adapter-wide limit is much larger
// because admin uploads carry photos).
export const LOGIN_BODY_MAX = 16 * 1024;

export class BodyTooLarge extends Error {
  constructor() { super('Richiesta troppo grande.'); }
}

export async function readSmallForm(request: Request, max = LOGIN_BODY_MAX): Promise<FormData> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLarge();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { body.set(c, at); at += c.byteLength; }
  return new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
}
