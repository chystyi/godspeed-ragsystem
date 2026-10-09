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

async function request<T>(method: string, path: string, json?: unknown): Promise<T> {
  const response = await send(path, { method, json });
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  listDocuments: () => request<KbDocumentSummary[]>("GET", "/api/documents"),
  getDocument: (id: string) => request<KbDocument>("GET", `/api/documents/${id}`),
  createDocument: (input: CreateDocumentInput) => request<KbDocument>("POST", "/api/documents", input),
  updateDocument: (id: string, input: UpdateDocumentInput) =>
    request<KbDocument>("PATCH", `/api/documents/${id}`, input),
  deleteDocument: (id: string) => request<void>("DELETE", `/api/documents/${id}`),
  reindexDocument: (id: string) => request<KbDocument>("POST", `/api/documents/${id}/reindex`),

  listConversations: () => request<Conversation[]>("GET", "/api/conversations"),
  getConversation: (id: string) => request<ConversationWithMessages>("GET", `/api/conversations/${id}`),
  createConversation: (title?: string) => request<Conversation>("POST", "/api/conversations", title ? { title } : {}),
  deleteConversation: (id: string) => request<void>("DELETE", `/api/conversations/${id}`),
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
  const response = await send(`/api/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    json: { content },
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.body) throw new ApiRequestError(response.status, "http_error", "empty response");
  yield* readChatEvents(response.body);
}
