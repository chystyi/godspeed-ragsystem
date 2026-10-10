// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  auth: { user: null as { id: string } | null, loading: false },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: mocks.signIn, signUp: mocks.signUp } },
}));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => mocks.auth }));

import { LoginForm } from "./login-form";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocks.auth.user = null;
  mocks.auth.loading = false;
});

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  return user;
}

describe("LoginForm", () => {
  it("starts in sign-in mode with the right autofill hints", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("signs in with the entered email and password", async () => {
    render(<LoginForm />);
    const user = await fill("ada@example.test", "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({ email: "ada@example.test", password: "correct horse" });
  });

  it("explains wrong credentials in plain words", async () => {
    mocks.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
    render(<LoginForm />);
    const user = await fill("ada@example.test", "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("does not show raw technical errors", async () => {
    mocks.signIn.mockResolvedValue({ error: new Error("pg: duplicate key value violates users_pkey") });
    render(<LoginForm />);
    const user = await fill("ada@example.test", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("users_pkey");
  });

  it("switches to account creation and asks for a longer password", async () => {
    render(<LoginForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("tells the person to check their inbox when the project needs email confirmation", async () => {
    render(<LoginForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.type(screen.getByLabelText("Password"), "long enough password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("status")).toHaveTextContent("We sent a link to ada@example.test");
    // back in sign-in mode, with the password cleared
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("shows no notice when sign-up already returned a session", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    render(<LoginForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.type(screen.getByLabelText("Password"), "long enough password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("blocks a second click while the request is running", async () => {
    let finish!: () => void;
    mocks.signIn.mockReturnValue(new Promise((resolve) => (finish = () => resolve({ error: null }))));
    render(<LoginForm />);
    const user = await fill("ada@example.test", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("sends a signed-in visitor straight to the documents", () => {
    mocks.auth.user = { id: "u1" };
    render(<LoginForm />);
    expect(mocks.replace).toHaveBeenCalledWith("/documents");
  });

  it("does not redirect while the stored session is still being read", () => {
    mocks.auth.loading = true;
    mocks.auth.user = { id: "u1" };
    render(<LoginForm />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
