// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer, MAX_QUESTION } from "./composer";

const setup = (props: Partial<React.ComponentProps<typeof Composer>> = {}) => {
  const onSend = vi.fn<(text: string) => Promise<boolean>>(async () => true);
  const onStop = vi.fn();
  render(<Composer busy={false} onSend={onSend} onStop={onStop} {...props} />);
  return { onSend, onStop, field: screen.getByLabelText("Your question") as HTMLTextAreaElement };
};

describe("Composer", () => {
  it("sends the trimmed question on Enter and clears the field", async () => {
    const user = userEvent.setup();
    const { onSend, field } = setup();
    await user.type(field, "  How do I reset it?  {Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("How do I reset it?");
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("adds a new line on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    const { onSend, field } = setup();
    await user.type(field, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue("line one\nline two");
  });

  it("does not send an empty or blank question", async () => {
    const user = userEvent.setup();
    const { onSend, field } = setup();
    await user.type(field, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("puts the text back when the question could not be sent", async () => {
    const user = userEvent.setup();
    const { field } = setup({ onSend: vi.fn(async () => false) });
    await user.type(field, "Try this{Enter}");
    await waitFor(() => expect(field).toHaveValue("Try this"));
  });

  it("does not overwrite what the person typed meanwhile when restoring", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const onSend = vi.fn(
      () => new Promise<boolean>((resolve) => (release = () => resolve(false))),
    );
    const { field } = setup({ onSend });
    await user.type(field, "first{Enter}");
    await user.type(field, "second");
    release();
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(field).toHaveValue("second");
  });

  it("shows Stop instead of Send while an answer is being written, and stops on click", async () => {
    const user = userEvent.setup();
    const { onStop } = setup({ busy: true });
    expect(screen.queryByRole("button", { name: "Send question" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop answering" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("ignores Enter while busy", async () => {
    const user = userEvent.setup();
    const { onSend, field } = setup({ busy: true });
    await user.type(field, "another{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("refuses a question over the limit and says so", async () => {
    const user = userEvent.setup();
    const { onSend, field } = setup();
    await user.click(field);
    await user.paste("x".repeat(MAX_QUESTION + 1));
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${(MAX_QUESTION + 1).toLocaleString("en-US")} / ${MAX_QUESTION.toLocaleString("en-US")}`);
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("is disabled as a whole when asked to be", async () => {
    const { field } = setup({ disabled: true });
    expect(field).toBeDisabled();
  });
});
