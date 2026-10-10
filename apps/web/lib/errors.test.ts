import { describe, expect, it } from "vitest";
import { ApiRequestError, describeError } from "./errors";

describe("describeError", () => {
  it("explains a reached limit without internal details", () => {
    const text = describeError(new ApiRequestError(409, "limit_reached", "documents: 200"));
    expect(text).toContain("limit");
    expect(text).not.toContain("200");
  });

  it("never shows unknown server text", () => {
    expect(describeError(new ApiRequestError(500, "boom", "secret detail"))).not.toContain("secret");
    expect(describeError(new Error("secret detail"))).not.toContain("secret");
  });
});
