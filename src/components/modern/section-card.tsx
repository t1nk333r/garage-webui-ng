import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

/** A titled card: a header strip with an optional action, then the body. */
const SectionCard = ({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: Props) => (
  <section
    className={cn(
      "rounded-box border border-base-300 bg-base-100 min-w-0",
      className
    )}
  >
    <header className="flex items-start justify-between gap-3 border-b border-base-300 px-5 py-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-base-content/60">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
    <div className={cn("px-5 py-5", bodyClassName)}>{children}</div>
  </section>
);

/** The small "Details →" style link that sits in a SectionCard header. */
export const SectionCardLink = ({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) => (
  <Link
    to={to}
    className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-base-content/60 transition-colors hover:text-base-content"
  >
    {children}
    <ArrowRight size={14} />
  </Link>
);

export default SectionCard;
