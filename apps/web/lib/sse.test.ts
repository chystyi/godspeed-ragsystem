import type { ChatStreamEvent } from "@kb/shared";
import { describe, expect, it } from "vitest";
import { readChatEvents } from "./sse";

const encode = (text: string) => new TextEncoder().encode(text);

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const frame = (event: ChatStreamEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of readChatEvents(stream)) events.push(event);
  return events;
}

const events: ChatStreamEvent[] = [
  { type: "start", sources: [] },
  { type: "delta", text: "Hello " },
  { type: "delta", text: "wörld" },
  { type: "error", code: "ai_unavailable", message: "the AI provider is unavailable" },
];

describe("readChatEvents", () => {
  it("reads events delivered in one chunk", async () => {
    const all = encode(events.map(frame).join(""));
    expect(await collect(streamOf([all]))).toEqual(events);
  });

  it("reads events when every byte arrives separately, even inside a multi-byte character", async () => {
    const bytes = encode(events.map(frame).join(""));
    const single = Array.from(bytes, (byte) => new Uint8Array([byte]));
    expect(await collect(streamOf(single))).toEqual(events);
  });

  it("handles chunks that cut an event in the middle", async () => {
    const text = events.map(frame).join("");
    const cut = Math.floor(text.length / 3);
    const chunks = [encode(text.slice(0, cut)), encode(text.slice(cut, cut * 2)), encode(text.slice(cut * 2))];
    expect(await collect(streamOf(chunks))).toEqual(events);
  });

  it("accepts CRLF line endings", async () => {
    const text = events.map(frame).join("").replaceAll("\n", "\r\n");
    expect(await collect(streamOf([encode(text)]))).toEqual(events);
  });

  it("accepts a bare carriage return as the line ending (valid in server-sent events)", async () => {
    const text = events.map(frame).join("").replaceAll("\n", "\r");
    expect(await collect(streamOf([encode(text)]))).toEqual(events);
  });

  it("handles a CRLF pair split between two chunks", async () => {
    const text = events.map(frame).join("").replaceAll("\n", "\r\n");
    const bytes = encode(text);
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte])); // every \r and \n alone
    expect(await collect(streamOf(chunks))).toEqual(events);
  });

  it("closes the connection when the reader stops early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(frame(events[0])));
        controller.enqueue(encode(frame(events[1])));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of readChatEvents(stream)) {
      expect(event).toEqual(events[0]);
      break; // e.g. the chat view stopped listening after the final event
    }
    expect(cancelled).toBe(true);
  });

  it("does not report a cancel after the stream ended normally", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(frame(events[0])));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await collect(stream);
    expect(cancelled).toBe(false);
  });

  it("ignores comments and keep-alive lines", async () => {
    const text = `: keep-alive\n\n${frame(events[0])}: ping\n\n`;
    expect(await collect(streamOf([encode(text)]))).toEqual([events[0]]);
  });

  it("yields a final event even without the closing blank line", async () => {
    const text = frame(events[0]).trimEnd();
    expect(await collect(streamOf([encode(text)]))).toEqual([events[0]]);
  });

  it("rejects malformed data instead of silently dropping it", async () => {
    await expect(collect(streamOf([encode("event: delta\ndata: {not json\n\n")]))).rejects.toThrow();
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });
});
