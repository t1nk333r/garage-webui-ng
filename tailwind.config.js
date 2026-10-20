const stockThemes = require("daisyui/src/theming/themes");
const { themes } = require("./src/app/themes");

// Every theme shares pastel's element shapes (pill buttons, soft tab corners);
// only colors vary between themes. A stock theme's own `--*` shape tokens are
// dropped so corporate or nord cannot reintroduce square corners.
const pastelShape = Object.fromEntries(
  Object.entries(stockThemes.pastel).filter(([key]) => key.startsWith("--"))
);

const colorsOnly = (theme) =>
  Object.fromEntries(
    Object.entries(theme).filter(([key]) => !key.startsWith("--"))
  );

// A dark surface with pastel accents (Catppuccin Macchiato hues). Content
// colors on the accents are the dark base, since pastel fills are light.
const darkPastel = {
  "color-scheme": "dark",
  primary: "#f5a97f",
  "primary-content": "#1e2030",
  secondary: "#f5bde6",
  "secondary-content": "#1e2030",
  accent: "#8bd5ca",
  "accent-content": "#1e2030",
  neutral: "#494d64",
  "neutral-content": "#cad3f5",
  "base-100": "#24273a",
  "base-200": "#1e2030",
  "base-300": "#363a4f",
  "base-content": "#cad3f5",
  info: "#8aadf4",
  "info-content": "#1e2030",
  success: "#a6da95",
  "success-content": "#1e2030",
  warning: "#eed49f",
  "warning-content": "#1e2030",
  error: "#ed8796",
  "error-content": "#1e2030",
};

const themeConfig = themes.map((name) => ({
  [name]: {
    ...(name === "dark-pastel" ? darkPastel : colorsOnly(stockThemes[name])),
    ...pastelShape,
  },
}));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "node_modules/daisyui/dist/**/*.js",
    "node_modules/react-daisyui/dist/**/*.js",
  ],
  theme: {
    extend: {
      // Mirrors src/lib/z-layers.ts — keep the two in lockstep so a class and
      // an inline style never disagree about stacking order.
      zIndex: {
        dropdown: "1000",
        popover: "1100",
        tooltip: "1200",
        toast: "1300",
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: themeConfig,
  },
};
