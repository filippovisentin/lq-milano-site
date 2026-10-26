// JSON for <script type="application/(ld+)json"> blocks emitted with set:html.
// JSON.stringify leaves '<' as is, so text containing "</script>" would close the
// block and the rest would run as HTML. Escaping '<' (and the two JS line
// separators, U+2028 and U+2029) keeps the JSON identical once parsed.
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const esc = (code: number) => `\\u${code.toString(16).padStart(4, '0')}`;

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, esc(0x3c))
    .replace(LS, esc(0x2028))
    .replace(PS, esc(0x2029));
}
