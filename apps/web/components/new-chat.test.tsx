// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { Activity, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/chat/new",
  props: null as null | { conversationId: string | null; onConversationCreated?: (id: string) => void },
  mounted: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
}));
vi.mock("@/components/chat-view", () => ({
  ChatView: (props: { conversationId: string | null; onConversationCreated?: (id: string) => void }) => {
    mocks.props = props;
    useState(() => ++mocks.mounted); // counts created views; hiding and showing keeps state
    return <div data-testid="chat" />;
  },
}));

import { NewChat } from "./new-chat";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.pathname = "/chat/new";
  mocks.props = null;
  mocks.mounted = 0;
});

describe("NewChat", () => {
  it("shows an empty conversation", () => {
    render(<NewChat />);
    expect(mocks.props?.conversationId).toBeNull();
  });

  it("opens the conversation at its own address once the first answer is saved", () => {
    render(<NewChat />);
    act(() => mocks.props?.onConversationCreated?.("abc"));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/chat/abc");
  });

  it.each(["/documents", "/documents/new", "/"])(
    "does not pull the person back to the chat when they have moved on to %s",
    (path) => {
      const { rerender } = render(<NewChat />);
      mocks.pathname = path; // they left while the answer was still being written
      rerender(<NewChat />);
      act(() => mocks.props?.onConversationCreated?.("abc"));
      expect(mocks.replace).not.toHaveBeenCalled();
    },
  );

  it("starts from a blank page the next time it is shown after a conversation was created", () => {
    // Next.js keeps a page you navigated away from (hidden); it would come back with the old conversation.
    const { rerender } = render(
      <Activity mode="visible">
        <NewChat />
      </Activity>,
    );
    expect(mocks.mounted).toBe(1);
    act(() => mocks.props?.onConversationCreated?.("abc"));
    rerender(
      <Activity mode="hidden">
        <NewChat />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <NewChat />
      </Activity>,
    );
    expect(mocks.mounted).toBe(2); // a fresh conversation view
  });

  it("keeps a half-typed question when the page was hidden and shown without anything being created", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <NewChat />
      </Activity>,
    );
    rerender(
      <Activity mode="hidden">
        <NewChat />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <NewChat />
      </Activity>,
    );
    expect(mocks.mounted).toBe(1); // same view, draft intact
  });
});
