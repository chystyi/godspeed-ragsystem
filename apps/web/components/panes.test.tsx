// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/chat" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { Panes } from "./panes";

beforeEach(() => {
  mocks.pathname = "/chat";
});

const setup = () =>
  render(
    <Panes root="/chat" list={<p>the list</p>}>
      <p>the detail</p>
    </Panes>,
  );

/** On a phone only one pane is visible: "hidden" without a larger-screen override means gone. */
const hiddenOnPhone = (element: HTMLElement) => /(^|\s)hidden(\s|$)/.test(element.className);

describe("Panes on a phone", () => {
  it("shows the list at the root of the section and hides the detail", () => {
    setup();
    expect(hiddenOnPhone(screen.getByText("the list").closest("aside")!)).toBe(false);
    expect(hiddenOnPhone(screen.getByText("the detail").closest("main")!)).toBe(true);
  });

  it.each(["/chat/new", "/chat/7d1f0b9e-6c1e-4a54-9c43-0d9a8f6c1111"])(
    "shows the detail and hides the list at %s",
    (path) => {
      mocks.pathname = path;
      setup();
      expect(hiddenOnPhone(screen.getByText("the list").closest("aside")!)).toBe(true);
      expect(hiddenOnPhone(screen.getByText("the detail").closest("main")!)).toBe(false);
    },
  );

  it("keeps both visible on larger screens whatever the address", () => {
    setup();
    expect(screen.getByText("the list").closest("aside")!.className).toMatch(/md:flex/);
    expect(screen.getByText("the detail").closest("main")!.className).toMatch(/md:block/);
  });
});
