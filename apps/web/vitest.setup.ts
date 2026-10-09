import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without vitest globals Testing Library does not unmount rendered components by itself.
afterEach(() => cleanup());
