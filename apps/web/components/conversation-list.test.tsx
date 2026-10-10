// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/chat",
  state: { data: undefined as undefined | { id: string; title: string; updatedAt: string }[], error: undefined as unknown, isLoading: false },
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/hooks", () => ({ useConversations: () => ({ ...mocks.state, mutate: vi.fn() }) }));

import { ConversationList } from "./conversation-list";

beforeEach(() => {
  mocks.pathname = "/chat";
  mocks.state = { data: [], error: undefined, isLoading: false };
});

describe("ConversationList", () => {
  it('opens a new conversation on its own address, so it also works on a phone where "/chat" is the list', () => {
    render(<ConversationList />);
    expect(screen.getByRole("link", { name: /New/ })).toHaveAttribute("href", "/chat/new");
  });

  it("lists conversations and marks the open one", () => {
    mocks.pathname = "/chat/b";
    mocks.state = {
      data: [
        { id: "a", title: "First", updatedAt: "2026-10-09T10:00:00Z" },
        { id: "b", title: "Second", updatedAt: "2026-10-09T11:00:00Z" },
      ],
      error: undefined,
      isLoading: false,
    };
    render(<ConversationList />);
    expect(screen.getByRole("link", { name: /Second/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /First/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /First/ })).toHaveAttribute("href", "/chat/a");
  });

  it("explains an empty list and a failure in plain words", () => {
    render(<ConversationList />);
    expect(screen.getByText(/conversations will appear here/i)).toBeInTheDocument();
  });

  it("shows a placeholder while loading", () => {
    mocks.state = { data: undefined, error: undefined, isLoading: true };
    render(<ConversationList />);
    expect(screen.getByLabelText("Loading conversations")).toBeInTheDocument();
  });
});
