/**
 * Cuts text to at most `maxChars` UTF-16 units without leaving half of a surrogate pair at
 * the end (an emoji would otherwise become an invalid lone surrogate that providers or the
 * database may reject).
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let end = maxChars;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // a high surrogate: its pair would be cut off
  return text.slice(0, Math.max(end, 0));
}

/** Text the database can store: no NUL character and no unpaired surrogates. */
export function isStorableText(text: string): boolean {
  return !text.includes('\u0000') && text.isWellFormed();
}
