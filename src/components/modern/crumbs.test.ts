import { describe, expect, it } from "vitest";
import { buildCrumbs } from "./crumbs";

describe("buildCrumbs", () => {
  it("shows a top-level page as a single crumb", () => {
    expect(buildCrumbs("Buckets", null)).toEqual([{ label: "Buckets" }]);
  });

  it("falls back to Dashboard before a page has set its title", () => {
    expect(buildCrumbs(null, null)).toEqual([{ label: "Dashboard" }]);
  });

  it("links a nested page back to its section", () => {
    expect(buildCrumbs("photos", "/buckets")).toEqual([
      { label: "Buckets", to: "/buckets" },
      { label: "photos" },
    ]);
  });

  it("derives a label for a parent path it does not know", () => {
    expect(buildCrumbs("Detail", "/some/where")).toEqual([
      { label: "where", to: "/some/where" },
      { label: "Detail" },
    ]);
  });
});
