import { themeLabel, themes, UiStyle } from "@/app/themes";
import Menu, { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import appStore from "@/stores/app-store";
import { Check, Palette } from "lucide-react";
import { useStore } from "zustand";

const uiStyleLabels: Record<UiStyle, string> = {
  modern: "Modern layout",
  classic: "Classic layout",
};

const CheckSlot = ({ checked }: { checked: boolean }) => (
  <Check size={16} className={cn(!checked && "invisible")} />
);

/**
 * The "Interface" section of an appearance menu. Shared with the classic
 * sidebar so that either layout can always reach the other one.
 */
export const UiStyleMenuItems = () => {
  const uiStyle = useStore(appStore, (s) => s.uiStyle);

  return (
    <>
      <li role="none" className="menu-title">
        Interface
      </li>
      {(Object.keys(uiStyleLabels) as UiStyle[]).map((style) => (
        <MenuItem key={style} onClick={() => appStore.setUiStyle(style)}>
          <CheckSlot checked={uiStyle === style} />
          {uiStyleLabels[style]}
        </MenuItem>
      ))}
    </>
  );
};

/** Theme and interface-style picker for the modern top bar. */
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
        <MenuItem key={name} onClick={() => appStore.setTheme(name)}>
          <CheckSlot checked={theme === name} />
          {themeLabel(name)}
        </MenuItem>
      ))}
      <UiStyleMenuItems />
    </Menu>
  );
};

export default AppearanceMenu;
