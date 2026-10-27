import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useAuth } from "@/hooks/useAuth";
import ModernLayout from "../modern/modern-layout";

const MainLayout = () => {
  const sidebar = useDisclosure();
  const { pathname } = useLocation();
  const auth = useAuth();

  useEffect(() => {
    if (sidebar.isOpen) {
      sidebar.onClose();
    }
  }, [pathname]);

  if (auth.isLoading) {
    return null;
  }

  // Before the login check: on an instance with no users there is nobody to
  // log in as, so a login form would be a dead end.
  if (auth.needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/auth/login" />;
  }

  return <ModernLayout sidebar={sidebar} />;
};

export default MainLayout;
