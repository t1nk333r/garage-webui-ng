import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export type IconTileTone =
  | "primary"
  | "secondary"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "error"
  | "neutral";

// Solid fills with their paired content color, so the glyph keeps its
// contrast on every theme — a translucent tint over a dark base would leave
// a dark glyph on a dark tile.
const tones: Record<IconTileTone, string> = {
  primary: "bg-primary text-primary-content",
  secondary: "bg-secondary text-secondary-content",
  accent: "bg-accent text-accent-content",
  info: "bg-info text-info-content",
  success: "bg-success text-success-content",
  warning: "bg-warning text-warning-content",
  error: "bg-error text-error-content",
  neutral: "bg-base-300 text-base-content/70",
};

const sizes = {
  sm: { box: "size-8 rounded-lg", icon: 16 },
  md: { box: "size-9 rounded-xl", icon: 18 },
  lg: { box: "size-12 rounded-2xl", icon: 22 },
};

type Props = {
  icon: LucideIcon;
  tone?: IconTileTone;
  size?: keyof typeof sizes;
  className?: string;
};

/** A decorative icon on a rounded tile. Hidden from assistive technology. */
const IconTile = ({ icon: Icon, tone = "primary", size = "md", className }: Props) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex shrink-0 items-center justify-center",
      sizes[size].box,
      tones[tone],
      className
    )}
  >
    <Icon size={sizes[size].icon} />
  </span>
);

export default IconTile;
