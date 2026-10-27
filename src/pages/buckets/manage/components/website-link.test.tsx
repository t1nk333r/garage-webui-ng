import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Bucket } from "../../types";
import BucketWebsiteLink from "./website-link";

vi.mock("@/hooks/useConfig", () => ({
  useConfig: () => ({ data: { s3_web: { root_domain: ".web.example.com" } } }),
}));

const bucket = (overrides: Partial<Bucket>) =>
  ({ globalAliases: ["assets"], websiteAccess: true, ...overrides }) as Bucket;

describe("BucketWebsiteLink", () => {
  it("opens the bucket's public site in a new tab", () => {
    render(<BucketWebsiteLink bucket={bucket({})} />);

    const link = screen.getByRole("link", { name: /website/i });
    expect(link).toHaveAttribute("href", "http://assets.web.example.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    // It leaves the page, so it is a link, not one of the tabs.
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("is hidden while website access is off", () => {
    render(<BucketWebsiteLink bucket={bucket({ websiteAccess: false })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is hidden for a bucket without a global alias", () => {
    render(<BucketWebsiteLink bucket={bucket({ globalAliases: [] })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
