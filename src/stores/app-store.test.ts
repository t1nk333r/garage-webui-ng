import { describe, expect, it } from "vitest";
import { migrateAppState } from "./app-store";

describe("migrateAppState", () => {
  it("moves the old default theme to dark-pastel", () => {
    expect(migrateAppState({ theme: "pastel" }, 0)).toEqual({
      theme: "dark-pastel",
    });
  });

  it("keeps a theme that was picked by hand", () => {
    expect(migrateAppState({ theme: "dracula" }, 0)).toEqual({
      theme: "dracula",
    });
  });

  it("keeps pastel once the user chooses it under the new schema", () => {
    expect(migrateAppState({ theme: "pastel" }, 1)).toEqual({
      theme: "pastel",
    });
  });

  it("drops the removed layout choice and keeps the theme", () => {
    expect(
      migrateAppState({ theme: "nord", uiStyle: "classic" }, 1)
    ).toEqual({ theme: "nord" });
  });

  it("falls back to the default for unknown or missing values", () => {
    expect(migrateAppState({ theme: "no-such-theme" }, 0)).toEqual({
      theme: "dark-pastel",
    });
    expect(migrateAppState(undefined, 0)).toEqual({ theme: "dark-pastel" });
  });
});
