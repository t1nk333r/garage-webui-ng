import { describe, expect, it } from "vitest";
import { migrateAppState } from "./app-store";

describe("migrateAppState", () => {
  it("moves the old default theme to dark-pastel", () => {
    expect(migrateAppState({ theme: "pastel" }, 0)).toEqual({
      theme: "dark-pastel",
      uiStyle: "modern",
    });
  });

  it("keeps a theme that was picked by hand", () => {
    expect(migrateAppState({ theme: "dracula" }, 0)).toEqual({
      theme: "dracula",
      uiStyle: "modern",
    });
  });

  it("keeps pastel once the user chooses it under the new schema", () => {
    expect(
      migrateAppState({ theme: "pastel", uiStyle: "classic" }, 1)
    ).toEqual({ theme: "pastel", uiStyle: "classic" });
  });

  it("falls back to the defaults for unknown or missing values", () => {
    expect(migrateAppState({ theme: "no-such-theme", uiStyle: "x" }, 0)).toEqual({
      theme: "dark-pastel",
      uiStyle: "modern",
    });
    expect(migrateAppState(undefined, 0)).toEqual({
      theme: "dark-pastel",
      uiStyle: "modern",
    });
  });
});
