import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import appStore from "@/stores/app-store";
import AppearanceTab from "./appearance-tab";

// Node 26 defines an experimental global `localStorage` that is undefined
// unless --localstorage-file is given, and it shadows jsdom's. The persisted
// store captures its storage when the module loads, so a working one has to
// exist before the imports run — hence vi.hoisted.
vi.hoisted(() => {
  if (globalThis.localStorage) return;
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, String(value)),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
});

describe("AppearanceTab", () => {
  beforeEach(() => {
    appStore.setState({ theme: "dark-pastel" });
  });

  it("marks the current theme as checked", () => {
    render(<AppearanceTab />);

    expect(screen.getByRole("radio", { name: /^dark pastel/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("switches theme", async () => {
    render(<AppearanceTab />);

    await userEvent.setup().click(screen.getByRole("radio", { name: /^nord/i }));

    expect(appStore.getState().theme).toBe("nord");
  });
});
