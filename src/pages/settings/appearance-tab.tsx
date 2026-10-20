import { themeLabel, themes, UiStyle } from "@/app/themes";
import { cn } from "@/lib/utils";
import appStore from "@/stores/app-store";
import { Check, LayoutDashboard, PanelLeft } from "lucide-react";
import { Card } from "react-daisyui";
import { useStore } from "zustand";

const uiStyleOptions: {
  value: UiStyle;
  title: string;
  description: string;
  icon: typeof LayoutDashboard;
}[] = [
  {
    value: "modern",
    title: "Modern",
    description:
      "Grouped sidebar, breadcrumbs, a storage dashboard and a sortable bucket table.",
    icon: LayoutDashboard,
  },
  {
    value: "classic",
    title: "Classic",
    description: "The original layout: stat tiles and bucket cards.",
    icon: PanelLeft,
  },
];

/**
 * Theme and layout, stored in this browser only (localStorage) — they are
 * per-device preferences, not account settings.
 */
const AppearanceTab = () => {
  const theme = useStore(appStore, (s) => s.theme);
  const uiStyle = useStore(appStore, (s) => s.uiStyle);

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="bg-base-100" bordered>
        <Card.Body>
          <Card.Title tag="h2">Interface</Card.Title>
          <div
            role="radiogroup"
            aria-label="Interface layout"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {uiStyleOptions.map((option) => {
              const selected = uiStyle === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => appStore.setUiStyle(option.value)}
                  className={cn(
                    "flex items-start gap-3 rounded-box border p-4 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-base-300 hover:bg-base-200"
                  )}
                >
                  <option.icon size={20} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">
                      {option.title}
                      {selected ? <Check size={16} /> : null}
                    </span>
                    <span className="mt-1 block text-sm text-base-content/60">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card.Body>
      </Card>

      <Card className="bg-base-100" bordered>
        <Card.Body>
          <Card.Title tag="h2">Theme</Card.Title>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {themes.map((name) => {
              const selected = theme === name;
              return (
                // data-theme scopes daisyUI's colors to the swatch, so each
                // one previews its own theme whatever the page is using.
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-theme={name}
                  onClick={() => appStore.setTheme(name)}
                  className={cn(
                    "rounded-box border bg-base-100 p-3 text-left text-base-content",
                    selected
                      ? "border-transparent ring-2 ring-primary ring-offset-2 ring-offset-base-100"
                      : "border-base-300"
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {themeLabel(name)}
                    {selected ? <Check size={16} /> : null}
                  </span>
                  <span className="mt-2 flex gap-1" aria-hidden="true">
                    <span className="h-4 flex-1 rounded-badge bg-primary" />
                    <span className="h-4 flex-1 rounded-badge bg-secondary" />
                    <span className="h-4 flex-1 rounded-badge bg-accent" />
                    <span className="h-4 flex-1 rounded-badge bg-neutral" />
                  </span>
                </button>
              );
            })}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default AppearanceTab;
