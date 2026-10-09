export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "citation"; numbers: number[]; raw: string };

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Splits an answer into plain text and citation markers like "[1]", "[2][3]" or "[1, 3]".
 * A number outside 1..sourceCount (for example an array index such as a[0]) stays plain text.
 */
export function splitCitations(text: string, sourceCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.kind === "text") previous.text += value;
    else parts.push({ kind: "text", text: value });
  };
  for (const match of text.matchAll(CITATION)) {
    const numbers = match[1].split(",").map((part) => Number(part.trim()));
    const index = match.index ?? 0;
    if (numbers.some((n) => n < 1 || n > sourceCount)) continue;
    pushText(text.slice(last, index));
    parts.push({ kind: "citation", numbers, raw: match[0] });
    last = index + match[0].length;
  }
  pushText(text.slice(last));
  return parts;
}
