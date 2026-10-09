export interface ChunkOptions {
  /** Hard upper limit for a chunk, overlap included. */
  maxChars: number;
  /** Text repeated from the end of the previous chunk, so a sentence cut by a boundary
   *  is still found in context. 0 disables it. */
  overlapChars: number;
}

export interface TextChunk {
  index: number;
  content: string;
  /** Rough estimate (characters / 4); only used for bookkeeping, never for limits. */
  tokenCount: number;
}

/**
 * ~1000 characters is about 250 tokens: small enough that a vector stays about one topic
 * (precise retrieval), large enough to carry a full thought. Five retrieved chunks cost
 * roughly 1.3k prompt tokens. 150 characters (15%) of overlap rescues sentences that
 * straddle a boundary without storing much duplicate text.
 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1000, overlapChars: 150 };

/** A splitter must be lossless: joining its pieces gives back the input. */
type Splitter = (text: string) => string[];

/** Strongest boundary first, weakest last. */
const SPLITTERS: Splitter[] = [
  (text) => text.split(/(?=^#{1,6} )/m), // before a markdown heading
  (text) => text.split(/(?<=\n\n)/), // paragraphs
  (text) => text.split(/(?<=\n)/), // lines
  (text) => text.match(/[^.!?。！？]*[.!?。！？]+\s*|[^.!?。！？]+$/g) ?? [text], // sentences
  (text) => text.split(/(?<=\s)/), // words
  (text) => Array.from(text), // code points: last resort, never splits a surrogate pair
];

/** Greedily glue neighbouring pieces together while they still fit. */
function merge(pieces: string[], budget: number): string[] {
  const merged: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current.length + piece.length <= budget) {
      current += piece;
    } else {
      if (current) merged.push(current);
      current = piece;
    }
  }
  if (current) merged.push(current);
  return merged;
}

function split(text: string, level: number, budget: number): string[] {
  if (text.length <= budget) return [text];
  const units: string[] = [];
  for (const piece of SPLITTERS[level](text)) {
    if (piece.length <= budget) units.push(piece);
    else units.push(...split(piece, level + 1, budget));
  }
  return merge(units, budget);
}

/** The end of the previous chunk, starting at a word boundary. */
function overlapPrefix(previous: string, overlapChars: number): string {
  if (overlapChars === 0) return '';
  let tail = previous.slice(-overlapChars);
  if (previous.length > overlapChars) {
    const firstSpace = tail.search(/\s/);
    if (firstSpace >= 0) tail = tail.slice(firstSpace + 1);
  }
  // Do not start in the middle of a surrogate pair.
  if (tail && tail.charCodeAt(0) >= 0xdc00 && tail.charCodeAt(0) <= 0xdfff) tail = tail.slice(1);
  return tail.trim();
}

/**
 * Split text into overlapping chunks along its natural structure: markdown headings,
 * then paragraphs, lines, sentences, words and finally characters.
 */
export function chunkText(
  text: string,
  { maxChars, overlapChars }: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TextChunk[] {
  // One character is reserved for the newline between overlap and chunk body.
  const budget = maxChars - overlapChars - (overlapChars > 0 ? 1 : 0);
  if (!Number.isInteger(maxChars) || !Number.isInteger(overlapChars) || overlapChars < 0 || budget < 1) {
    throw new RangeError(
      `invalid chunk options: maxChars=${maxChars}, overlapChars=${overlapChars} ` +
        '(overlap must leave room for text)',
    );
  }
  const trimmed = text.trim();
  if (!trimmed) return [];

  const bodies = split(trimmed, 0, budget)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  return bodies.map((body, index) => {
    const prefix = index === 0 ? '' : overlapPrefix(bodies[index - 1], overlapChars);
    const content = prefix ? `${prefix}\n${body}` : body;
    return { index, content, tokenCount: Math.ceil(content.length / 4) };
  });
}
