import { themeLabel, themes } from "@/app/themes";
import Menu, { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import appStore from "@/stores/app-store";
import { Check, Palette } from "lucide-react";
import { useStore } from "zustand";

// The check mark is visual only; the item's aria-checked carries the state.
const CheckSlot = ({ checked }: { checked: boolean }) => (
  <Check size={16} aria-hidden="true" className={cn(!checked && "invisible")} />
);

/** Theme picker for the top bar. */
const AppearanceMenu = () => {
  const theme = useStore(appStore, (s) => s.theme);

  return (
    <Menu
      placement="bottom-end"
      triggerLabel="Appearance"
      triggerClassName="btn-sm"
      trigger={<Palette size={18} />}
      className="max-h-[500px] flex-nowrap overflow-y-auto"
    >
      <li role="none" className="menu-title">
        Theme
      </li>
      {themes.map((name) => (
        <MenuItem
          key={name}
          checked={theme === name}
          onClick={() => appStore.setTheme(name)}
        >
          <CheckSlot checked={theme === name} />
          {themeLabel(name)}
        </MenuItem>
      ))}
    </Menu>
  );
};

export default AppearanceMenu;
