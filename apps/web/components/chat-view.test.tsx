// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  pathname: "/chat/c1",
  replace: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(async () => true),
  deleteConversation: vi.fn(),
  chat: { conversationId: "c1" as string | null, pending: null as unknown, error: null as string | null, busy: false },
  conversation: { data: undefined as unknown, error: undefined as unknown, isLoading: false },
  documents: { data: [{ id: "d" }] as unknown },
  saved: undefined as undefined | ((id: string) => Promise<void> | void),
  mutate: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock("@/lib/api", () => ({ api: { deleteConversation: mocks.deleteConversation } }));
vi.mock("@/lib/hooks", () => ({
  useConversation: () => mocks.conversation,
  useDocuments: () => mocks.documents,
}));
vi.mock("@/lib/use-chat", () => ({
  useChat: (options: { onExchangeSaved: (id: string) => Promise<void> | void }) => {
    mocks.saved = options.onExchangeSaved;
    return { ...mocks.chat, send: mocks.send, stop: mocks.stop };
  },
}));

import { ChatView } from "./chat-view";

const stored = {
  id: "c1",
  title: "Router questions",
  createdAt: "2026-10-09T10:00:00Z",
  updatedAt: "2026-10-09T10:00:00Z",
  messages: [],
};

beforeEach(() => {
  mocks.pathname = "/chat/c1";
  mocks.replace.mockReset();
  mocks.stop.mockReset();
  mocks.deleteConversation.mockReset();
  mocks.mutate.mockClear();
  mocks.chat = { conversationId: "c1", pending: null, error: null, busy: false };
  mocks.conversation = { data: stored, error: undefined, isLoading: false };
  mocks.documents = { data: [{ id: "d" }] };
});

describe("ChatView", () => {
  it("stops an answer that is still being written when the person leaves the chat", () => {
    mocks.chat.busy = true;
    const { rerender } = render(<ChatView conversationId="c1" />);
    expect(mocks.stop).not.toHaveBeenCalled();
    mocks.pathname = "/documents";
    rerender(<ChatView conversationId="c1" />);
    expect(mocks.stop).toHaveBeenCalled();
  });

  it("does not stop anything while the person stays in the chat section", () => {
    mocks.chat.busy = true;
    render(<ChatView conversationId="c1" />);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("refreshes the conversation and the list when an exchange is saved", async () => {
    render(<ChatView conversationId="c1" />);
    await act(async () => {
      await mocks.saved?.("c1");
    });
    expect(mocks.mutate).toHaveBeenCalledWith(["conversation", "c1"]);
    expect(mocks.mutate).toHaveBeenCalledWith("conversations");
  });

  it("tells its parent when the first answer of a new conversation is saved", async () => {
    const onConversationCreated = vi.fn();
    mocks.chat.conversationId = null;
    mocks.conversation = { data: undefined, error: undefined, isLoading: false };
    render(<ChatView conversationId={null} onConversationCreated={onConversationCreated} />);
    await act(async () => {
      await mocks.saved?.("new-id");
    });
    expect(onConversationCreated).toHaveBeenCalledExactlyOnceWith("new-id");
  });

  it("does not announce a conversation that already existed", async () => {
    const onConversationCreated = vi.fn();
    render(<ChatView conversationId="c1" onConversationCreated={onConversationCreated} />);
    await act(async () => {
      await mocks.saved?.("c1");
    });
    expect(onConversationCreated).not.toHaveBeenCalled();
  });

  it("explains a conversation that no longer exists and blocks asking", () => {
    mocks.conversation = { data: undefined, error: new ApiRequestError(404, "conversation_not_found", ""), isLoading: false };
    render(<ChatView conversationId="c1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/no longer exists/i);
    expect(screen.getByLabelText("Your question")).toBeDisabled();
  });

  it("offers to write a document first when there are none", () => {
    mocks.chat.conversationId = null;
    mocks.conversation = { data: undefined, error: undefined, isLoading: false };
    mocks.documents = { data: [] };
    render(<ChatView conversationId={null} />);
    expect(screen.getByRole("link", { name: /Write a document/ })).toHaveAttribute("href", "/documents/new");
  });

  describe("deleting", () => {
    async function openDeleteDialog() {
      await userEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
    }

    it("removes the conversation and goes back to the chat start", async () => {
      mocks.deleteConversation.mockResolvedValue(undefined);
      render(<ChatView conversationId="c1" />);
      await openDeleteDialog();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/chat"));
      expect(mocks.deleteConversation).toHaveBeenCalledWith("c1");
    });

    it("shows why deleting failed, and clears that message when the person tries again", async () => {
      mocks.deleteConversation.mockRejectedValue(new ApiRequestError(0, "network", "x"));
      render(<ChatView conversationId="c1" />);
      await openDeleteDialog();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/cannot reach the server/i);
      await openDeleteDialog(); // trying again: the old message must not stay
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("cannot be started while an answer is being written", () => {
      mocks.chat.busy = true;
      render(<ChatView conversationId="c1" />);
      expect(screen.getByRole("button", { name: "Delete conversation" })).toBeDisabled();
    });
  });
});
