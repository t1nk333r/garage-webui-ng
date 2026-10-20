import garageLogo from "@/assets/garage-logo.svg";
import { useConfig } from "@/hooks/useConfig";
import { PROJECT_URL } from "@/lib/consts";
import { cn } from "@/lib/utils";
import { useNodeInfo } from "@/pages/cluster/hooks";
import {
  ArchiveIcon,
  BookOpen,
  Github,
  HardDrive,
  KeySquare,
  LayoutDashboard,
  LucideIcon,
  Settings,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import LogoutButton from "../containers/logout-button";

type NavItem = {
  title: string;
  path: string;
  icon: LucideIcon;
  exact?: boolean;
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    items: [
      { title: "Dashboard", path: "/", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "Storage",
    items: [
      { title: "Buckets", path: "/buckets", icon: ArchiveIcon },
      { title: "Access Keys", path: "/keys", icon: KeySquare },
    ],
  },
  {
    label: "Cluster",
    items: [{ title: "Cluster", path: "/cluster", icon: HardDrive }],
  },
  {
    label: "System",
    items: [{ title: "Settings", path: "/settings", icon: Settings }],
  },
];

const footerLink =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-base-content/60 transition-colors hover:bg-base-300 hover:text-base-content";

const ModernSidebar = () => {
  const { pathname } = useLocation();
  const { data: config } = useConfig();
  const { data: node } = useNodeInfo();

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(item.path + "/");

  return (
    <aside className="flex h-full w-[80%] max-w-72 flex-col border-r border-base-300 bg-base-200 md:w-64">
      <Link
        to="/"
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-base-300 px-4"
      >
        <img src={garageLogo} alt="" className="h-7 w-auto" />
        <span className="text-[17px] font-semibold tracking-tight">
          WebUI-NG
        </span>
      </Link>

      <nav
        aria-label="Main"
        className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
      >
        {navGroups.map((group, index) => (
          <div key={group.label ?? index}>
            {group.label ? (
              <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-base-content/50">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-btn px-3 text-sm transition-colors",
                        active
                          ? "bg-primary font-medium text-primary-content"
                          : "text-base-content/70 hover:bg-base-300 hover:text-base-content"
                      )}
                    >
                      <item.icon size={16} />
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex flex-col items-center gap-1.5 px-3 py-3">
        <div className="flex flex-wrap items-center justify-center gap-1">
          <a
            href="https://garagehq.deuxfleurs.fr/documentation/"
            target="_blank"
            rel="noreferrer"
            className={footerLink}
          >
            <BookOpen size={14} />
            Garage docs
          </a>
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            className={footerLink}
          >
            <Github size={14} />
            Project
          </a>
        </div>

        {config?.version || node?.garageVersion ? (
          <p className="flex w-full items-center justify-center gap-1.5 border-t border-base-300 pt-2 text-xs text-base-content/60">
            {config?.version ? <span>UI {config.version}</span> : null}
            {config?.version && node?.garageVersion ? (
              <span className="opacity-40">•</span>
            ) : null}
            {node?.garageVersion ? (
              <span>Garage {node.garageVersion}</span>
            ) : null}
          </p>
        ) : null}

        <LogoutButton className="btn-ghost w-full" size="sm" />
      </div>
    </aside>
  );
};

export default ModernSidebar;
