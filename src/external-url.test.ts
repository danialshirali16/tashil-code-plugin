import { describe, expect, it, vi } from 'vitest';
import { normalizeHttpUrl, normalizeOptionalHttpUrl } from './external-url';

describe('normalizeHttpUrl', () => {
  it.each([
    [
      'https://storybook.example.com/?path=/docs/button#primary',
      'https://storybook.example.com/?path=/docs/button#primary',
    ],
    ['http://localhost:6006/story', 'http://localhost:6006/story'],
    ['  https://EXAMPLE.com/source.tsx  ', 'https://example.com/source.tsx'],
    ['HTTPS://EXAMPLE.com:443', 'https://example.com/'],
    ['http://127.0.0.1:65535/path?Mode=One#Top', 'http://127.0.0.1:65535/path?Mode=One#Top'],
    ['https://[2001:DB8::1]:8443/source', 'https://[2001:db8::1]:8443/source'],
    ['https://example.com?path=/docs', 'https://example.com/?path=/docs'],
    ['http://localhost:00080', 'http://localhost/'],
  ])('normalizes an absolute HTTP(S) URL', (value, expected) => {
    expect(normalizeHttpUrl(value)).toBe(expected);
  });

  it('normalizes valid URLs when the browser URL constructor is unavailable', () => {
    vi.stubGlobal('URL', undefined);

    try {
      expect(normalizeHttpUrl('https://EXAMPLE.com:443/source?raw=One#Line'))
        .toBe('https://example.com/source?raw=One#Line');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    '/relative/story',
    '//example.com/protocol-relative',
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/source.tsx',
    'blob:https://example.com/id',
    'https://',
    'https://user@example.com/source',
    'https://user:password@example.com/source',
    'https://example.com@attacker.example/source',
    'https://@example.com/source',
    'https://example.com/a b',
    'https://example.com\\@attacker.example/source',
    'https://example.com/source\nhttps://attacker.example',
    'https://example.com/source%0ahttps://attacker.example',
    'https://example.com/source%7f',
    'https://example.com:',
    'https://example.com:port/source',
    'https://example.com:+443/source',
    'https://example.com:65536/source',
    'https://example.com:80:90/source',
    'https://-example.com/source',
    'https://example-.com/source',
    'https://example..com/source',
    'https://under_score.example/source',
    'https://éxample.com/source',
    'https://256.0.0.1/source',
    'https://127.0.0.01/source',
    'https://127.1/source',
    'https://example.127/source',
    'https://0x7f000001/source',
    'https://0x7f.0.0.1/source',
    'https://2001:db8::1/source',
    'https://[2001:db8::1/source',
    'https://[2001:db8::1]extra/source',
    'https://[2001:::1]/source',
    'https://[2001:db8::1::2]/source',
    'https://[gggg::1]/source',
    'https://[1:2:3:4:5:6:7]/source',
    'https://[1:2:3:4:5:6:7:8:9]/source',
  ])('rejects an unsafe or malformed URL: %s', (value) => {
    expect(normalizeHttpUrl(value)).toBeNull();
  });
});

describe('normalizeOptionalHttpUrl', () => {
  it('treats an empty or whitespace-only optional value as omitted', () => {
    expect(normalizeOptionalHttpUrl('')).toBeUndefined();
    expect(normalizeOptionalHttpUrl('   ')).toBeUndefined();
  });

  it('does not treat control-character whitespace as an empty value', () => {
    expect(normalizeOptionalHttpUrl('\n')).toBeNull();
    expect(normalizeOptionalHttpUrl('\t')).toBeNull();
  });
});
