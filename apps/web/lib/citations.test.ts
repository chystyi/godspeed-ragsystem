import { describe, expect, it } from "vitest";
import { splitCitations } from "./citations";

describe("splitCitations", () => {
  it("returns plain text as one part", () => {
    expect(splitCitations("No citations here.", 3)).toEqual([{ kind: "text", text: "No citations here." }]);
  });

  it("finds a citation between text", () => {
    expect(splitCitations("Use WPA3 [1] always.", 2)).toEqual([
      { kind: "text", text: "Use WPA3 " },
      { kind: "citation", numbers: [1], raw: "[1]" },
      { kind: "text", text: " always." },
    ]);
  });

  it("finds adjacent and grouped citations", () => {
    const parts = splitCitations("Both [2][3] and [1, 3].", 3);
    expect(parts.filter((p) => p.kind === "citation").map((p) => (p as { numbers: number[] }).numbers)).toEqual([
      [2],
      [3],
      [1, 3],
    ]);
  });

  it("leaves numbers outside the source range as text", () => {
    expect(splitCitations("Item a[0] and [9] and [1].", 2)).toEqual([
      { kind: "text", text: "Item a[0] and [9] and " },
      { kind: "citation", numbers: [1], raw: "[1]" },
      { kind: "text", text: "." },
    ]);
  });

  it("does not treat links or words in brackets as citations", () => {
    expect(splitCitations("See [docs](http://x) and [note].", 3)).toEqual([
      { kind: "text", text: "See [docs](http://x) and [note]." },
    ]);
  });

  it("keeps every character: joined parts equal the input", () => {
    const text = "A [1] b [2][3] c a[0] [9] d.";
    expect(splitCitations(text, 3).map((p) => (p.kind === "text" ? p.text : p.raw)).join("")).toBe(text);
  });

  it("handles an unfinished marker while the answer is still streaming", () => {
    expect(splitCitations("Use WPA3 [", 3)).toEqual([{ kind: "text", text: "Use WPA3 [" }]);
    expect(splitCitations("Use WPA3 [1", 3)).toEqual([{ kind: "text", text: "Use WPA3 [1" }]);
  });

  it("handles empty text", () => {
    expect(splitCitations("", 3)).toEqual([]);
  });
});
