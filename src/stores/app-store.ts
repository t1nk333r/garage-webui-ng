import { DEFAULT_THEME, Themes, themes } from "@/app/themes";
import { createStore } from "zustand";
import { persist } from "zustand/middleware";

type AppState = {
  theme: Themes;
};

const initialState: AppState = {
  theme: DEFAULT_THEME,
};

/**
 * Upgrades a persisted state from an older schema version.
 *
 * Version 0 stored only `theme`, and persist writes the initial state on first
 * load — so a stored "pastel" (the old default) cannot be told apart from a
 * deliberate choice. It is moved to the new default; any other stored theme
 * was picked by hand and is kept. Version 1 also stored `uiStyle`, the choice
 * between the modern and classic layouts; the classic layout is gone, so it is
 * dropped. Unknown values fall back to the defaults.
 */
export const migrateAppState = (
  persisted: unknown,
  version: number
): AppState => {
  const state = (persisted ?? {}) as Partial<Record<keyof AppState, unknown>>;

  let theme = themes.includes(state.theme as Themes)
    ? (state.theme as Themes)
    : DEFAULT_THEME;
  if (version < 1 && theme === "pastel") {
    theme = DEFAULT_THEME;
  }

  return { theme };
};

const store = createStore(
  persist<AppState>(() => initialState, {
    name: "appdata",
    version: 2,
    migrate: migrateAppState,
  })
);

const appStore = {
  ...store,
  setTheme: (theme: AppState["theme"]) => store.setState({ theme }),
};

export default appStore;
