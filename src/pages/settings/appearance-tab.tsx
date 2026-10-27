import { themeLabel, themes } from "@/app/themes";
import { cn } from "@/lib/utils";
import appStore from "@/stores/app-store";
import { Check } from "lucide-react";
import { Card } from "react-daisyui";
import { useStore } from "zustand";

/**
 * The theme, stored in this browser only (localStorage) — it is a
 * per-device preference, not an account setting.
 */
const AppearanceTab = () => {
  const theme = useStore(appStore, (s) => s.theme);

  return (
    <div className="space-y-4 max-w-3xl">
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
