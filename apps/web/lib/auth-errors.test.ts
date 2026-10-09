import { describe, expect, it } from "vitest";
import { describeAuthError } from "./auth-errors";

describe("describeAuthError", () => {
  it.each([
    ["Invalid login credentials", /incorrect/i],
    ["User already registered", /already exists/i],
    ["Email not confirmed", /confirm your email/i],
    ["Password should be at least 6 characters", /longer password/i],
    ["email rate limit exceeded", /too many/i],
    ["Unable to validate email address: invalid format", /valid email/i],
    ["TypeError: Failed to fetch", /cannot reach/i],
    ["something unexpected inside supabase", /did not work/i],
  ])("%s", (raw, expected) => {
    expect(describeAuthError(raw)).toMatch(expected);
  });

  it("never repeats the raw technical message", () => {
    expect(describeAuthError("db constraint users_pkey violated")).not.toContain("users_pkey");
  });
});
