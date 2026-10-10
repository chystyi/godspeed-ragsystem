import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { documentDigest } from './digest.js';

describe('documentDigest', () => {
  it('is the sha256 of title, U+0001 and content, as the database computes it', () => {
    const expected = createHash('sha256').update(Buffer.from('Guide\u0001Body', 'utf8')).digest('hex');
    expect(documentDigest('Guide', 'Body')).toBe(expected);
  });

  it('separates title and content, so moving text between them changes the digest', () => {
    expect(documentDigest('ab', 'c')).not.toBe(documentDigest('a', 'bc'));
  });

  it('handles non-ASCII text as UTF-8', () => {
    const expected = createHash('sha256').update(Buffer.from('Grüße\u0001日本語 😀', 'utf8')).digest('hex');
    expect(documentDigest('Grüße', '日本語 😀')).toBe(expected);
  });

  it('changes with any edit', () => {
    expect(documentDigest('t', 'x')).not.toBe(documentDigest('t', 'x '));
    expect(documentDigest('t', 'x')).not.toBe(documentDigest('T', 'x'));
  });
});
