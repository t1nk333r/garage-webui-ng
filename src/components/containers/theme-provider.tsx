import appStore from "@/stores/app-store";
import { useEffect } from "react";
import { useStore } from "zustand";

const ThemeProvider = () => {
  const theme = useStore(appStore, (i) => i.theme);
  const uiStyle = useStore(appStore, (i) => i.uiStyle);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-ui", uiStyle);
  }, [uiStyle]);

  return null;
};

export default ThemeProvider;
