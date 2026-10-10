import type { ChatStreamEvent } from "@kb/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, configureApi, streamAnswer } from "./api";
import { ApiRequestError, describeError } from "./errors";

const ID = "7d1f0b9e-6c1e-4a54-9c43-0d9a8f6c1111";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  configureApi({ baseUrl: "http://api.test", getToken: async () => "token-123" });
});
afterEach(() => vi.unstubAllGlobals());

describe("requests", () => {
  it("sends the user's token and a JSON body", async () => {
    fetchMock.mockResolvedValue(json(201, { id: "d1" }));
    await api.createDocument({ title: "T", content: "C" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/documents");
    expect(new Headers(init!.headers).get("Authorization")).toBe("Bearer token-123");
    expect(new Headers(init!.headers).get("Content-Type")).toBe("application/json");
    expect(init!.body).toBe(JSON.stringify({ title: "T", content: "C" }));
  });

  it("sends no Authorization header when signed out", async () => {
    configureApi({ getToken: async () => null });
    fetchMock.mockResolvedValue(json(200, []));
    await api.listDocuments();
    expect(new Headers(fetchMock.mock.calls[0][1]!.headers).has("Authorization")).toBe(false);
  });

  it("treats 204 as success without a body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteDocument(ID)).resolves.toBeUndefined();
  });

  it("turns an API error into ApiRequestError with its code and retry time", async () => {
    fetchMock.mockResolvedValue(
      json(429, { code: "too_many_requests", message: "slow" }, { "Retry-After": "30" }),
    );
    const error = (await api.listDocuments().catch((e: unknown) => e)) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect([error.status, error.code, error.retryAfterSeconds]).toEqual([429, "too_many_requests", 30]);
  });

  it("copes with an error response that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await api.listDocuments().catch((e: unknown) => e)) as ApiRequestError;
    expect([error.status, error.code]).toEqual([502, "http_error"]);
  });

  it("reports an unreachable server as a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = (await api.listDocuments().catch((e: unknown) => e)) as ApiRequestError;
    expect(error.code).toBe("network");
  });
});

function sse(events: ChatStreamEvent[]): Response {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("identifiers in paths", () => {
  it("uses valid ids as they are", async () => {
    fetchMock.mockImplementation(async () => json(200, { id: ID })); // a fresh response per call
    await api.getDocument(ID);
    await api.getConversation(ID);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `http://api.test/api/documents/${ID}`,
      `http://api.test/api/conversations/${ID}`,
    ]);
  });

  it.each(["../conversations", "..%2Fconversations", "a/b", "id?x=1", "", " ", "not-a-uuid", "1;drop table"])(
    "refuses %j without sending any request, as a not-found",
    async (bad) => {
      for (const call of [
        () => api.getDocument(bad),
        () => api.updateDocument(bad, { title: "x" }),
        () => api.deleteDocument(bad),
        () => api.reindexDocument(bad),
        () => api.getConversation(bad),
        () => api.deleteConversation(bad),
      ]) {
        const error = (await call().catch((e: unknown) => e)) as ApiRequestError;
        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error.status).toBe(404);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a malformed conversation id for a streamed answer too", async () => {
    const error = await (async () => {
      for await (const _ of streamAnswer("../documents", "q")) void _;
    })().catch((e: unknown) => e);
    expect((error as ApiRequestError).code).toBe("conversation_not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can cancel the creation of a conversation", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, init) => {
      expect(init!.signal).toBe(controller.signal);
      return json(201, { id: ID });
    });
    await api.createConversation(undefined, controller.signal);
  });
});

describe("streamAnswer", () => {
  const events: ChatStreamEvent[] = [
    { type: "start", sources: [] },
    { type: "delta", text: "Hi" },
    { type: "delta", text: "!" },
  ];

  it("posts the question and yields the events", async () => {
    fetchMock.mockResolvedValue(sse(events));
    const received: ChatStreamEvent[] = [];
    for await (const event of streamAnswer(ID, "Hello?")) received.push(event);
    expect(received).toEqual(events);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://api.test/api/conversations/${ID}/messages/stream`);
    expect(init!.body).toBe(JSON.stringify({ content: "Hello?" }));
    expect(new Headers(init!.headers).get("Accept")).toBe("text/event-stream");
  });

  it("throws a normal error when the answer cannot start", async () => {
    fetchMock.mockResolvedValue(json(503, { code: "ai_unavailable", message: "down" }));
    const error = await (async () => {
      for await (const _ of streamAnswer(ID, "q")) void _;
    })().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("ai_unavailable");
  });

  it("passes cancellation to fetch and does not disguise it as a network error", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const error = await (async () => {
      for await (const _ of streamAnswer(ID, "q", controller.signal)) void _;
    })().catch((e: unknown) => e);
    expect((error as Error).name).toBe("AbortError");
  });
});

describe("describeError", () => {
  it.each([
    ["network", /connection/i],
    ["unauthorized", /sign in again/i],
    ["ai_rate_limited", /busy/i],
    ["ai_unavailable", /not available/i],
    ["internal_error", /something went wrong/i],
  ])("explains %s in plain words", (code, pattern) => {
    expect(describeError(new ApiRequestError(500, code, "internal detail sk-secret"))).toMatch(pattern);
  });

  it("names the wait for a rate limit and never repeats server details", () => {
    const text = describeError(new ApiRequestError(429, "too_many_requests", "raw server text", 17));
    expect(text).toContain("17 seconds");
    expect(text).not.toContain("raw server text");
  });

  it("copes with errors that did not come from the API", () => {
    expect(describeError(new Error("boom"))).toMatch(/something went wrong/i);
    expect(describeError(undefined)).toMatch(/something went wrong/i);
  });
});
