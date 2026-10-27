import { darkThemes, Themes } from "@/app/themes";
import { DirectoryListingTheme } from "../../types";

/** The daisyUI variables a listing page uses (backend/router/listing_theme.go). */
const listingThemeColors = ["b1", "b2", "b3", "bc", "p"] as const;

/**
 * Reads one of the web UI's themes as colors for the generated listing
 * pages. daisyUI derives most of a theme's surfaces when the stylesheet is
 * built, so only the browser knows them: a hidden element scoped with
 * data-theme reports the theme's variables, as the swatches in Settings →
 * Appearance are scoped. Returns null when they cannot be read, which means
 * the stylesheet is not loaded.
 */
export const readListingTheme = (
  name: Themes
): DirectoryListingTheme | null => {
  const probe = document.createElement("div");
  probe.setAttribute("data-theme", name);
  probe.hidden = true;
  document.body.appendChild(probe);
  try {
    const style = getComputedStyle(probe);
    const colors: Record<string, string> = {};
    for (const key of listingThemeColors) {
      const value = style.getPropertyValue(`--${key}`).trim();
      if (!value) {
        return null;
      }
      colors[key] = value;
    }
    return {
      name,
      scheme: darkThemes.has(name) ? "dark" : "light",
      colors,
    };
  } finally {
    probe.remove();
  }
};
