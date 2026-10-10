import { describe, expect, it } from 'vitest';
import { chunkText } from './chunker.js';

/** Small deterministic PRNG so "random" tests are reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'.split(' ');

function sentence(rand: () => number, words = 8): string {
  const parts = Array.from({ length: words }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  return `${parts.join(' ')}.`;
}

function paragraph(rand: () => number, sentences = 5): string {
  return Array.from({ length: sentences }, () => sentence(rand)).join(' ');
}

function document(rand: () => number, paragraphs: number): string {
  return Array.from({ length: paragraphs }, () => paragraph(rand)).join('\n\n');
}

const opts = { maxChars: 1000, overlapChars: 150 };

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('  Hello world.  ', opts);
    expect(chunks).toEqual([{ index: 0, content: 'Hello world.', tokenCount: 3 }]);
  });

  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkText('', opts)).toEqual([]);
    expect(chunkText(' \n\t ', opts)).toEqual([]);
  });

  it('never exceeds the maximum size, whatever the text looks like', () => {
    const rand = rng(1);
    const samples = [
      document(rand, 40),
      'x'.repeat(5000), // no separator at all
      Array.from({ length: 800 }, () => WORDS[Math.floor(rand() * 12)]).join(' '), // no punctuation
      '日本語のテキスト。'.repeat(400), // no spaces
      '😀'.repeat(3000),
      'line\n'.repeat(900),
      `# Title\n\n${document(rand, 10)}\n\n## Section\n\n${document(rand, 10)}`,
    ];
    for (const text of samples) {
      for (const chunk of chunkText(text, opts)) {
        expect(chunk.content.length).toBeLessThanOrEqual(opts.maxChars);
        expect(chunk.content.trim()).not.toBe('');
      }
    }
  });

  it('keeps every word of the input in at least one chunk', () => {
    const rand = rng(2);
    const text = document(rand, 60);
    const chunks = chunkText(text, opts);
    const covered = new Set(chunks.flatMap((c) => c.content.split(/\s+/)));
    for (const word of text.split(/\s+/)) {
      expect(covered.has(word)).toBe(true);
    }
  });

  it('starts every chunk after the first with text repeated from the previous one', () => {
    const rand = rng(3);
    const chunks = chunkText(document(rand, 30), opts);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const lead = chunks[i].content.split(/\s+/).slice(0, 4).join(' ');
      expect(chunks[i - 1].content).toContain(lead);
    }
  });

  it('breaks at paragraph boundaries when it can', () => {
    const para = (letter: string) => `${letter} `.repeat(200).trim(); // ~400 chars
    const [a, b, c] = ['a', 'b', 'c'].map(para);
    const chunks = chunkText(`${a}\n\n${b}\n\n${c}`, opts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe(`${a}\n\n${b}`);
    expect(chunks[1].content.endsWith(c)).toBe(true);
    expect(chunks[1].content).not.toContain(`${a}`);
  });

  it('starts a new chunk at a markdown heading', () => {
    const body = (w: string) => `${w} `.repeat(220).trim(); // ~440 chars
    const text = `# One\n${body('a')}\n# Two\n${body('b')}\n# Three\n${body('c')}`;
    const chunks = chunkText(text, opts);
    const withHeading = chunks.filter((c) => /(^|\n)# (One|Two|Three)\n/.test(c.content));
    expect(withHeading.length).toBeGreaterThanOrEqual(2);
    // No chunk begins in the middle of a section body (after the overlap prefix) while a
    // heading is still pending: the second chunk must open with the overlap and then "# Three".
    expect(chunks[0].content.startsWith('# One')).toBe(true);
    // A heading must stay with its text, never end a chunk on its own.
    for (const chunk of chunks) {
      expect(chunk.content).not.toMatch(/(^|\n)#{1,6} [^\n]*\s*$/);
    }
  });

  it('is deterministic', () => {
    const text = document(rng(4), 25);
    expect(chunkText(text, opts)).toEqual(chunkText(text, opts));
  });

  it('numbers chunks from zero and estimates tokens', () => {
    const chunks = chunkText(document(rng(5), 20), opts);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      expect(chunk.tokenCount).toBe(Math.ceil(chunk.content.length / 4));
    });
  });

  it('never splits a surrogate pair or produces invalid text', () => {
    for (const chunk of chunkText('😀🎉'.repeat(1500), opts)) {
      expect(chunk.content.isWellFormed()).toBe(true);
    }
  });

  it('cuts text without any separator by force, never inside an emoji', () => {
    for (const text of ['😀'.repeat(900), 'x'.repeat(900), `${'a'.repeat(849)}😀b`]) {
      const chunks = chunkText(text, { maxChars: 1000, overlapChars: 150 });
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(1000);
        expect(chunk.content.isWellFormed()).toBe(true);
      }
    }
  });

  it('handles the smallest useful budget with emoji without crashing', () => {
    const chunks = chunkText('a😀b😀c', { maxChars: 4, overlapChars: 1 }); // budget 2 per chunk
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(4);
      expect(chunk.content.isWellFormed()).toBe(true);
    }
    expect(chunks.map((c) => c.content).join('')).toContain('😀');
  });

  it('stays fast for the largest allowed document, even of the worst shape', () => {
    // 200 000 characters is the documented limit; one request must not stall the server.
    for (const text of ['.'.repeat(200000), 'a '.repeat(100000), '# '.repeat(100000), '😀'.repeat(100000)]) {
      const started = performance.now();
      chunkText(text, { maxChars: 1000, overlapChars: 150 });
      expect(performance.now() - started).toBeLessThan(4000); // measured ~0.1-0.3 s; generous for busy machines
    }
  });

  it('works without overlap', () => {
    const chunks = chunkText(document(rng(6), 20), { maxChars: 500, overlapChars: 0 });
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(500);
  });

  it.each([
    { maxChars: 1, overlapChars: 0 }, // room for one unit: not enough for an emoji
    { maxChars: 3, overlapChars: 1 },
    { maxChars: 0, overlapChars: 0 },
    { maxChars: 100, overlapChars: 100 },
    { maxChars: 100, overlapChars: -1 },
  ])('rejects invalid options %j', (bad) => {
    expect(() => chunkText('text', bad)).toThrow(RangeError);
  });
});
