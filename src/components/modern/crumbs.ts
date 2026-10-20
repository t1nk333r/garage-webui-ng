export type Crumb = { label: string; to?: string };

const sectionLabels: Record<string, string> = {
  "/": "Dashboard",
  "/buckets": "Buckets",
  "/keys": "Access Keys",
  "/cluster": "Cluster",
  "/settings": "Settings",
};

/**
 * Breadcrumbs from what the page told PageContext: a page with `prev` sits
 * one level below that section, every other page is a top-level section.
 */
export const buildCrumbs = (
  title: string | null,
  prev: string | null
): Crumb[] => {
  const current: Crumb = { label: title || "Dashboard" };
  if (!prev) return [current];

  const parentLabel =
    sectionLabels[prev] ??
    prev.split("/").filter(Boolean).pop() ??
    "Back";
  return [{ label: parentLabel, to: prev }, current];
};
