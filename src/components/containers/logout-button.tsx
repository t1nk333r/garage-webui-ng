import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import * as utils from "@/lib/utils";
import Button from "../ui/button";

type Props = {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
};

const LogoutButton = ({ className = "flex-1", size }: Props) => {
  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      window.location.href = utils.url("/auth/login");
    },
    onError: (err) => {
      toast.error(err?.message || "Unknown error");
    },
  });

  return (
    <Button
      className={className}
      size={size}
      icon={LogOut}
      onClick={() => logout.mutate()}
    >
      Logout
    </Button>
  );
};

export default LogoutButton;
