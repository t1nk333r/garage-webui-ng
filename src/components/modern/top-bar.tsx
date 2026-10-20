import { PageContext } from "@/context/page-context";
import { MenuIcon } from "lucide-react";
import { useContext } from "react";
import { Link } from "react-router-dom";
import AccountButton from "../containers/account-button";
import AppearanceMenu from "./appearance-menu";
import { buildCrumbs } from "./crumbs";

type Props = {
  onSidebarOpen: () => void;
};

const TopBar = ({ onSidebarOpen }: Props) => {
  const page = useContext(PageContext);
  const crumbs = buildCrumbs(page?.title ?? null, page?.prev ?? null);

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-base-300 bg-base-200 px-3 md:px-5">
      <button
        type="button"
        aria-label="Open navigation"
        className="btn btn-ghost btn-sm btn-circle md:hidden"
        onClick={onSidebarOpen}
      >
        <MenuIcon size={18} />
      </button>

      <nav aria-label="Breadcrumb" className="breadcrumbs min-w-0 flex-1 text-sm">
        <ul>
          {crumbs.map((crumb, index) => (
            <li key={index} className="min-w-0">
              {crumb.to ? (
                <Link to={crumb.to} className="text-base-content/60">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate font-medium">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <AppearanceMenu />
      <AccountButton />
    </div>
  );
};

export default TopBar;
