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
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // A line may end in \n, \r\n or a lone \r. A trailing \r might be half of \r\n, so it waits.
      const holdBack = buffer.endsWith("\r") ? "\r" : "";
      const ready = holdBack ? buffer.slice(0, -1) : buffer;
      const blocks = ready.replace(/\r\n?/g, "\n").split("\n\n");
      buffer = (blocks.pop() ?? "") + holdBack;
      for (const block of blocks) {
        const event = parseBlock(block);
        if (event) yield event;
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n?/g, "\n");
    // The connection may have ended in the middle of the last event. That is an interrupted
    // stream (the caller notices the missing final event), not a damaged one.
    let last: ChatStreamEvent | null = null;
    try {
      last = buffer.trim() ? parseBlock(buffer) : null;
    } catch {
      last = null;
    }
    if (last) yield last;
  } finally {
    // Reading stopped early (the caller left, or failed): close the connection instead of leaving it open.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseBlock(block: string): ChatStreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null; // comment or keep-alive
  return JSON.parse(data) as ChatStreamEvent;
}
