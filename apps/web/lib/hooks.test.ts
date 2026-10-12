import type { KbDocument } from "@kb/shared";
import { describe, expect, it } from "vitest";
import { PENDING_POLL_MS, pollWhilePending } from "./hooks";

describe("pollWhilePending", () => {
  it("keeps asking while a document is waiting to be indexed", () => {
    expect(pollWhilePending({ indexingStatus: "pending" } as KbDocument)).toBe(PENDING_POLL_MS);
  });

  it("stops once the outcome is known, or when there is nothing yet", () => {
    expect(pollWhilePending({ indexingStatus: "indexed" } as KbDocument)).toBe(0);
    expect(pollWhilePending({ indexingStatus: "failed" } as KbDocument)).toBe(0);
    expect(pollWhilePending(undefined)).toBe(0);
  });
});
