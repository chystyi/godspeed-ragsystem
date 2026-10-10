// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

const setup = (props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog open title="Delete this?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} {...props}>
      It cannot be undone.
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel, ...view };
};

describe("ConfirmDialog", () => {
  it("opens when asked to and shows the question", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Delete this?" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("It cannot be undone.")).toBeInTheDocument();
  });

  it("stays closed until asked to open", () => {
    setup({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms and cancels through its buttons", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("treats Escape as cancel and lets the parent close it", () => {
    const { onCancel } = setup();
    const cancelled = fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(cancelled).toBe(false); // default prevented: the dialog is closed through `open`
  });

  it("blocks both buttons while the action runs", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("closes when `open` turns false", () => {
    const { rerender, onConfirm, onCancel } = setup();
    rerender(
      <ConfirmDialog open={false} title="Delete this?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel}>
        It cannot be undone.
      </ConfirmDialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
