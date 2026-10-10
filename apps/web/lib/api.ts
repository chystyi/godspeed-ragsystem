import type {
  ApiError,
  ChatStreamEvent,
  Conversation,
  ConversationWithMessages,
  CreateDocumentInput,
  KbDocument,
  KbDocumentSummary,
  UpdateDocumentInput,
} from "@kb/shared";
import { ApiRequestError } from "./errors";
import { readChatEvents } from "./sse";

type TokenProvider = () => Promise<string | null>;

let getToken: TokenProvider = async () => null;
let baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Wires the client to the signed-in user (and, in tests, to a fake server). */
export function configureApi(options: { getToken?: TokenProvider; baseUrl?: string }): void {
  if (options.getToken) getToken = options.getToken;
  if (options.baseUrl) baseUrl = options.baseUrl;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An id as a path segment. Anything that is not a uuid (such as "../conversations" typed into the
 * address bar) is answered as "not found" without a request: it could otherwise be read as a
 * different path and its answer shown as if it were a document.
 */
function idSegment(kind: "document" | "conversation", id: string): string {
  if (!UUID.test(id)) throw new ApiRequestError(404, `${kind}_not_found`, "not found");
  return encodeURIComponent(id);
}

async function send(path: string, init: RequestInit & { json?: unknown }): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error; // cancelled on purpose
    throw new ApiRequestError(0, "network", "network error");
  }
  if (!response.ok) throw await toError(response);
  return response;
}

async function toError(response: Response): Promise<ApiRequestError> {
  const retryAfter = Number(response.headers.get("Retry-After"));
  try {
    const body = (await response.json()) as Partial<ApiError>;
    return new ApiRequestError(
      response.status,
      body.code ?? "http_error",
      body.message ?? response.statusText,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  } catch {
    return new ApiRequestError(response.status, "http_error", response.statusText);
  }
}

async function request<T>(method: string, path: string, json?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await send(path, { method, json, signal });
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  listDocuments: () => request<KbDocumentSummary[]>("GET", "/api/documents"),
  getDocument: async (id: string) => request<KbDocument>("GET", `/api/documents/${idSegment("document", id)}`),
  createDocument: (input: CreateDocumentInput) => request<KbDocument>("POST", "/api/documents", input),
  updateDocument: async (id: string, input: UpdateDocumentInput) =>
    request<KbDocument>("PATCH", `/api/documents/${idSegment("document", id)}`, input),
  deleteDocument: async (id: string) => request<void>("DELETE", `/api/documents/${idSegment("document", id)}`),
  reindexDocument: async (id: string) =>
    request<KbDocument>("POST", `/api/documents/${idSegment("document", id)}/reindex`),

  listConversations: () => request<Conversation[]>("GET", "/api/conversations"),
  getConversation: async (id: string) =>
    request<ConversationWithMessages>("GET", `/api/conversations/${idSegment("conversation", id)}`),
  createConversation: (title?: string, signal?: AbortSignal) =>
    request<Conversation>("POST", "/api/conversations", title ? { title } : {}, signal),
  deleteConversation: async (id: string) =>
    request<void>("DELETE", `/api/conversations/${idSegment("conversation", id)}`),
};

/**
 * Asks a question and yields the answer as it is written. Problems found before the answer
 * starts (rate limit, provider rejecting the request, unknown conversation) are thrown as
 * ApiRequestError; a failure in the middle arrives as an `error` event.
 */
export async function* streamAnswer(
  conversationId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const response = await send(`/api/conversations/${idSegment("conversation", conversationId)}/messages/stream`, {
    method: "POST",
    json: { content },
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.body) throw new ApiRequestError(response.status, "http_error", "empty response");
  yield* readChatEvents(response.body);
}
