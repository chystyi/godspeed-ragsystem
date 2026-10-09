import type { ChatStreamEvent } from "@kb/shared";

/**
 * Reads a server-sent events body and yields the chat events in it. Chunks can end anywhere
 * (even inside a multi-byte character or an event), so text is buffered until a blank line
 * completes an event.
 */
export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseBlock(block);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    const last = buffer.trim() ? parseBlock(buffer) : null;
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): ChatStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null; // comment or keep-alive
  return JSON.parse(data) as ChatStreamEvent;
}
