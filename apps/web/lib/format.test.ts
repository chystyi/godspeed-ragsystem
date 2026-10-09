import { describe, expect, it } from "vitest";
import { formatWhen } from "./format";

const now = new Date(2026, 9, 9, 15, 30); // 9 Oct 2026, local time

describe("formatWhen", () => {
  it("shows the time for today", () => {
    expect(formatWhen(new Date(2026, 9, 9, 8, 5).toISOString(), now)).toBe("08:05");
  });
  it("shows month and day for earlier this year", () => {
    expect(formatWhen(new Date(2026, 2, 3, 8, 5).toISOString(), now)).toBe("Mar 3");
  });
  it("adds the year for earlier years", () => {
    expect(formatWhen(new Date(2025, 11, 31, 8, 5).toISOString(), now)).toBe("Dec 31, 2025");
  });
  it("returns an empty string for an invalid date instead of crashing", () => {
    expect(formatWhen("not a date", now)).toBe("");
  });
});
