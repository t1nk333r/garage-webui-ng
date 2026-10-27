import { afterEach, describe, expect, it, vi } from "vitest";
import { readListingTheme } from "./listing-theme";

// jsdom resolves no stylesheet variables, so getComputedStyle reports what a
// browser would for a theme-scoped element: each value with a leading space.
const stubVariables = (values: Record<string, string>) => {
  const seen: Element[] = [];
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
    seen.push(el);
    return {
      getPropertyValue: (prop: string) => values[prop] ?? "",
    } as CSSStyleDeclaration;
  });
  return seen;
};

const nord = {
  "--b1": " 95.1276% 0.007445 260.731539",
  "--b2": " 93.2996% 0.010389 261.788485",
  "--b3": " 89.9258% 0.016374 262.749256",
  "--bc": " 32.4374% 0.022945 264.182036",
  "--p": " 59.4359% 0.077246 254.027774",
};

describe("readListingTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the theme's variables from an element scoped to it", () => {
    const seen = stubVariables(nord);

    expect(readListingTheme("nord")).toEqual({
      name: "nord",
      scheme: "light",
      colors: {
        b1: "95.1276% 0.007445 260.731539",
        b2: "93.2996% 0.010389 261.788485",
        b3: "89.9258% 0.016374 262.749256",
        bc: "32.4374% 0.022945 264.182036",
        p: "59.4359% 0.077246 254.027774",
      },
    });
    expect(seen[0].getAttribute("data-theme")).toBe("nord");
    expect(document.querySelector("[data-theme]")).toBeNull();
  });

  it("marks a dark theme dark", () => {
    stubVariables(nord);
    expect(readListingTheme("dracula")?.scheme).toBe("dark");
  });

  it("returns null when the stylesheet is not loaded", () => {
    stubVariables({ ...nord, "--p": "" });
    expect(readListingTheme("nord")).toBeNull();
    expect(document.querySelector("[data-theme]")).toBeNull();
  });
});
