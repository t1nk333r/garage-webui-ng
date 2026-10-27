// https://daisyui.com/docs/themes/
//
// The first entry is the default. "dark-pastel" is defined locally in
// tailwind.config.js; every other name is a stock daisyUI theme whose shape
// tokens are replaced there with pastel's, so only the colors differ.

export const themes = [
  "dark-pastel",
  "pastel",
  "dark",
  "dracula",
  "cupcake",
  "dim",
  "night",
  "nord",
  "corporate",
  "valentine",
  "winter",
] as const;

export type Themes = (typeof themes)[number];

export const DEFAULT_THEME: Themes = themes[0];

// Themes rendered on a dark surface. Charts pick their palette from this, so a
// new dark theme must be added here or its chart colors will be the light set.
export const darkThemes: ReadonlySet<Themes> = new Set<Themes>([
  "dark-pastel",
  "dark",
  "dracula",
  "dim",
  "night",
]);

/** Display name for a theme: "dark-pastel" → "Dark Pastel". */
export const themeLabel = (theme: Themes) =>
  theme
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
