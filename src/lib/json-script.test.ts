import { describe, expect, it } from 'vitest';
import { jsonForScript } from './json-script';

describe('jsonForScript', () => {
  it('never emits a raw "<", so a title cannot close the script block', () => {
    const title = '</script><script>alert(document.domain)</script>';
    const out = jsonForScript([{ name: title }]);
    expect(out).not.toContain('<');
    expect(out.toLowerCase()).not.toContain('</script');
    expect(out).toContain('\\u003c/script>');
  });

  it('parses back to the same value', () => {
    const value = { name: 'Giacca <Yohji> & co', alt: 'a\u2028b\u2029c', n: 1, list: ['<!--', '-->'] };
    expect(JSON.parse(jsonForScript(value))).toEqual(value);
  });

  it('escapes the JS line separators', () => {
    const out = jsonForScript('x\u2028y\u2029z');
    expect(out).not.toMatch(/[\u2028\u2029]/);
  });
});
