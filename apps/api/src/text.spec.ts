import { describe, expect, it } from 'vitest';
import { isStorableText, truncate } from './text.js';

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('', 3)).toBe('');
  });

  it('cuts at the limit', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
  });

  it('never leaves half of an emoji at the end', () => {
    const text = `${'a'.repeat(59)}😀tail`; // the emoji occupies positions 59-60
    const cut = truncate(text, 60);
    expect(cut.isWellFormed()).toBe(true);
    expect(cut).toBe('a'.repeat(59));
  });

  it('keeps a whole emoji that fits', () => {
    expect(truncate(`${'a'.repeat(58)}😀tail`, 60)).toBe(`${'a'.repeat(58)}😀`);
  });

  it('stays well formed for every cut point of mixed text', () => {
    const text = 'a😀b🎉c日本語😀😀';
    for (let limit = 0; limit <= text.length; limit++) {
      expect(truncate(text, limit).isWellFormed(), `limit ${limit}`).toBe(true);
      expect(truncate(text, limit).length).toBeLessThanOrEqual(limit);
    }
  });
});

describe('isStorableText', () => {
  it.each([
    ['plain text', 'hello world', true],
    ['unicode and emoji', 'Grüße 日本語 😀', true],
    ['newlines and tabs', 'a\n\tb\r\n', true],
    ['a NUL character (the database cannot store it)', 'a\u0000b', false],
    ['a lone high surrogate', 'a\ud83db', false],
    ['a lone low surrogate', 'a\ude00b', false],
    ['an empty string', '', true],
  ])('%s', (_name, text, expected) => {
    expect(isStorableText(text)).toBe(expected);
  });
});
