// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useSWR from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/documents",
  auth: {
    user: { id: "alice", email: "alice@example.test" } as { id: string; email: string } | null,
    loading: false,
    signOut: vi.fn(async () => undefined),
  },
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
vi.mock("@/components/auth-provider", () => ({ useAuth: () => mocks.auth }));

import { AppShell } from "./app-shell";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.pathname = "/documents";
  mocks.auth.user = { id: "alice", email: "alice@example.test" };
  mocks.auth.loading = false;
  mocks.auth.signOut.mockClear();
});

/** Shows what the current user's data fetch returns, through the shared "documents" cache key. */
function Probe() {
  const { data } = useSWR("documents", async () => `documents of ${mocks.auth.user?.id}`);
  return <p data-testid="probe">{data ?? "nothing yet"}</p>;
}

describe("AppShell", () => {
  it("sends a visitor who is not signed in to the sign-in page", () => {
    mocks.auth.user = null;
    render(<AppShell>content</AppShell>);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("shows only a placeholder while the stored session is being read", () => {
    mocks.auth.loading = true;
    mocks.auth.user = null;
    render(<AppShell>content</AppShell>);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("shows the person, the page and marks the current section", () => {
    mocks.pathname = "/chat/abc";
    render(<AppShell>content</AppShell>);
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.getByText("alice@example.test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chat/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Documents/ })).not.toHaveAttribute("aria-current");
  });

  it("signs out and returns to the sign-in page", async () => {
    render(<AppShell>content</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("never shows one person's cached data to the next person who signs in", async () => {
    const { rerender } = render(
      <AppShell>
        <Probe />
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("documents of alice"));

    // Another account signs in, in the same tab.
    mocks.auth.user = { id: "bob", email: "bob@example.test" };
    rerender(
      <AppShell>
        <Probe />
      </AppShell>,
    );
    // Already on the first paint, Alice's data must be gone.
    expect(screen.getByTestId("probe")).not.toHaveTextContent("alice");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("documents of bob"));
  });

  it("keeps the cache while the same person stays signed in", async () => {
    const { rerender } = render(
      <AppShell>
        <Probe />
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("documents of alice"));
    mocks.auth.user = { id: "alice", email: "alice@example.test" }; // same id, new object
    rerender(
      <AppShell>
        <Probe />
      </AppShell>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("documents of alice");
  });
});
