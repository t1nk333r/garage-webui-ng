// Categorical palette in fixed order, one step per surface: the light set for
// light themes, the dark set for dark ones. Validated (lightness band, chroma,
// adjacent-pair CVD and normal-vision separation) against a white card and the
// dark-pastel card (#24273a). A few hues fall under 3:1 against their surface,
// which is why the usage chart always shows a labelled legend beside it.
export const categoricalPalette = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

// Neutral for the aggregate "Other" slice, so it never reads as a ninth series.
export const otherColor = {
  light: "#b8b2a7",
  dark: "#5d6378",
} as const;
