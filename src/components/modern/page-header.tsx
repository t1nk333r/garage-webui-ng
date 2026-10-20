import { PageContext } from "@/context/page-context";
import { useContext } from "react";
import IconTile from "./icon-tile";

/**
 * The title block under the top bar, filled from PageContext so every page —
 * redesigned or not — gets the same header without knowing which layout it
 * is rendered in.
 */
const PageHeader = () => {
  const page = useContext(PageContext);
  if (!page?.title) return null;

  const { title, subtitle, icon, actions } = page;

  return (
    <header className="flex flex-col gap-4 border-b border-base-300 px-4 py-5 sm:flex-row sm:items-start sm:justify-between md:px-7">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <IconTile icon={icon} size="lg" /> : null}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <div className="mt-1 text-sm text-base-content/60">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
};

export default PageHeader;
