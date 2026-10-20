import {
  DEFAULT_THEME,
  DEFAULT_UI_STYLE,
  Themes,
  themes,
  UiStyle,
  uiStyles,
} from "@/app/themes";
import { createStore } from "zustand";
import { persist } from "zustand/middleware";

type AppState = {
  theme: Themes;
  uiStyle: UiStyle;
};

const initialState: AppState = {
  theme: DEFAULT_THEME,
  uiStyle: DEFAULT_UI_STYLE,
};

/**
 * Upgrades a persisted state from an older schema version.
 *
 * Version 0 stored only `theme`, and persist writes the initial state on first
 * load — so a stored "pastel" (the old default) cannot be told apart from a
 * deliberate choice. It is moved to the new default; any other stored theme
 * was picked by hand and is kept. Unknown values fall back to the defaults.
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

  const uiStyle = uiStyles.includes(state.uiStyle as UiStyle)
    ? (state.uiStyle as UiStyle)
    : DEFAULT_UI_STYLE;

  return { theme, uiStyle };
};

const store = createStore(
  persist<AppState>(() => initialState, {
    name: "appdata",
    version: 1,
    migrate: migrateAppState,
  })
);

const appStore = {
  ...store,
  setTheme: (theme: AppState["theme"]) => store.setState({ theme }),
  setUiStyle: (uiStyle: AppState["uiStyle"]) => store.setState({ uiStyle }),
};

export default appStore;
