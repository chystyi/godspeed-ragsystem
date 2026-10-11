// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetUseModelForTests, useChosenModel } from "./use-model";

const choices = { default: "a/model", models: ["a/model", "b/model", "c/model"] };

beforeEach(() => {
  localStorage.clear();
  resetUseModelForTests();
});

describe("useChosenModel", () => {
  it("starts with the default model", () => {
    const { result } = renderHook(() => useChosenModel(choices));
    expect(result.current[0]).toBe("a/model");
  });

  it("remembers a choice for the next visit", () => {
    const first = renderHook(() => useChosenModel(choices));
    act(() => first.result.current[1]("b/model"));
    expect(first.result.current[0]).toBe("b/model");
    first.unmount();
    expect(renderHook(() => useChosenModel(choices)).result.current[0]).toBe("b/model");
  });

  it("ignores a remembered model that is no longer offered", () => {
    localStorage.setItem("kb-chat-model", "removed/model");
    expect(renderHook(() => useChosenModel(choices)).result.current[0]).toBe("a/model");
  });

  it("has no model before the list is known, and refuses one that is not offered", () => {
    const { result } = renderHook(() => useChosenModel(undefined));
    expect(result.current[0]).toBeUndefined();
    const offered = renderHook(() => useChosenModel(choices));
    act(() => offered.result.current[1]("evil/model"));
    expect(offered.result.current[0]).toBe("a/model");
  });

  it("works when storage is unavailable", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(renderHook(() => useChosenModel(choices)).result.current[0]).toBe("a/model");
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("useChosenModel with blocked storage", () => {
  it("still uses the choice during the visit", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      const { result } = renderHook(() => useChosenModel(choices));
      act(() => result.current[1]("c/model"));
      expect(result.current[0]).toBe("c/model");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
