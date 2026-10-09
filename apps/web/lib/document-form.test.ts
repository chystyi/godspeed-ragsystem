import { describe, expect, it } from "vitest";
import { isDirty, LIMITS, parseTags, validateDocumentForm } from "./document-form";

describe("parseTags", () => {
  it("trims, lower-cases, drops empties and duplicates, keeps order", () => {
    expect(parseTags(" AI, rag ,, ai ,Search")).toEqual(["ai", "rag", "search"]);
  });
  it("returns nothing for blank input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(" , ,")).toEqual([]);
  });
});

const valid = { title: "Guide", tags: "a, b", content: "Text" };

describe("validateDocumentForm", () => {
  it("accepts a valid form", () => {
    expect(validateDocumentForm(valid)).toEqual({});
  });

  it("requires a title and content, ignoring whitespace", () => {
    const errors = validateDocumentForm({ title: "  ", tags: "", content: " \n " });
    expect(errors.title).toMatch(/title/i);
    expect(errors.content).toMatch(/write something/i);
  });

  it("enforces the same limits as the API", () => {
    expect(validateDocumentForm({ ...valid, title: "x".repeat(LIMITS.title + 1) }).title).toBeDefined();
    expect(validateDocumentForm({ ...valid, title: "x".repeat(LIMITS.title) }).title).toBeUndefined();
    expect(validateDocumentForm({ ...valid, content: "x".repeat(LIMITS.content + 1) }).content).toMatch(/1 characters over/);
    const manyTags = Array.from({ length: LIMITS.tags + 1 }, (_, i) => `t${i}`).join(",");
    expect(validateDocumentForm({ ...valid, tags: manyTags }).tags).toBeDefined();
    expect(validateDocumentForm({ ...valid, tags: "x".repeat(LIMITS.tag + 1) }).tags).toBeDefined();
  });

  it("counts duplicate tags once", () => {
    const duplicates = Array.from({ length: 30 }, () => "same").join(",");
    expect(validateDocumentForm({ ...valid, tags: duplicates }).tags).toBeUndefined();
  });
});

describe("isDirty", () => {
  const saved = { title: "Guide", tags: ["a", "b"], content: "Text" };
  it("is false for an untouched or only re-formatted form", () => {
    expect(isDirty({ title: "Guide", tags: "a,b", content: "Text" }, saved)).toBe(false);
    expect(isDirty({ title: " Guide ", tags: " A , b ", content: "Text" }, saved)).toBe(false);
  });
  it("is true when any field changes", () => {
    expect(isDirty({ title: "Guide 2", tags: "a,b", content: "Text" }, saved)).toBe(true);
    expect(isDirty({ title: "Guide", tags: "a", content: "Text" }, saved)).toBe(true);
    expect(isDirty({ title: "Guide", tags: "a,b", content: "Text." }, saved)).toBe(true);
  });
});
