import { Suspense } from "react";
import { Drawer } from "react-daisyui";
import { Outlet } from "react-router-dom";
import UploadCard from "../containers/upload-card";
import PageHeader from "./page-header";
import ModernSidebar from "./sidebar";
import TopBar from "./top-bar";

type Props = {
  sidebar: { isOpen: boolean; onOpen: () => void; onClose: () => void };
};

/**
 * Sidebar, sticky breadcrumb bar and a page header filled from PageContext.
 *
 * The PageContext consumers are leaf components (TopBar, PageHeader) on
 * purpose: if this component read the context itself, every page's
 * `<Page … />` update would re-render the whole layout.
 */
const ModernLayout = ({ sidebar }: Props) => (
  <Drawer
    open={sidebar.isOpen}
    onClickOverlay={sidebar.onClose}
    className="md:drawer-open h-screen max-h-dvh"
    side={<ModernSidebar />}
    contentClassName="flex flex-col overflow-hidden"
  >
    <TopBar onSidebarOpen={sidebar.onOpen} />

    <main className="flex-1 overflow-y-auto">
      <PageHeader />
      <div className="px-4 py-5 md:px-7">
        <Suspense>
          <Outlet />
        </Suspense>
      </div>
    </main>

    <UploadCard />
  </Drawer>
);

export default ModernLayout;
