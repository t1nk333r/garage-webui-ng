import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SearchResults from "./search-results";
import { SearchObjectsResult } from "./types";

// `vi.mock` is hoisted above the imports, so the mutable state it closes
// over has to be hoisted with it. Modeled on object-list.test.tsx.
const mockSearch = vi.hoisted(() => ({
  data: undefined as SearchObjectsResult | undefined,
  error: null as Error | null,
  isLoading: false,
}));

vi.mock("./hooks", () => ({
  useSearchObjects: () => ({
    data: mockSearch.data,
    error: mockSearch.error,
    isLoading: mockSearch.isLoading,
  }),
}));

const resultWith = (
  objects: SearchObjectsResult["objects"],
  extra: Partial<SearchObjectsResult> = {}
): SearchObjectsResult => ({
  objects,
  prefix: "",
  query: "report",
  scanned: objects.length,
  truncated: false,
  ...extra,
});

const object = (objectKey: string) => ({
  objectKey,
  lastModified: new Date("2026-01-01T00:00:00Z"),
  size: 1234,
  url: `/${objectKey}`,
});

describe("SearchResults", () => {
  it("renders rows for results and navigates to the parent folder on click", () => {
    mockSearch.data = resultWith([object("a/b/report-2.pdf")]);
    mockSearch.error = null;
    mockSearch.isLoading = false;

    const onNavigate = vi.fn();
    render(
      <SearchResults
        bucket="test-bucket"
        prefix=""
        query="report"
        onNavigate={onNavigate}
      />
    );

    const row = screen.getByRole("button", { name: "a/b/report-2.pdf" });
    fireEvent.click(row);

    expect(onNavigate).toHaveBeenCalledWith("a/b/");
  });

  it("navigates relative to a non-root prefix", () => {
    mockSearch.data = resultWith([object("b/report-2.pdf")], {
      prefix: "a/",
    });
    mockSearch.error = null;
    mockSearch.isLoading = false;

    const onNavigate = vi.fn();
    render(
      <SearchResults
        bucket="test-bucket"
        prefix="a/"
        query="report"
        onNavigate={onNavigate}
      />
    );

    const row = screen.getByRole("button", { name: "b/report-2.pdf" });
    fireEvent.click(row);

    expect(onNavigate).toHaveBeenCalledWith("a/b/");
  });

  it("shows the matches-cap banner when truncated for that reason", () => {
    mockSearch.data = resultWith([object("m/file-000.txt")], {
      truncated: true,
      reason: "matches",
      scanned: 1000,
    });
    mockSearch.error = null;
    mockSearch.isLoading = false;

    render(
      <SearchResults
        bucket="test-bucket"
        prefix=""
        query="file"
        onNavigate={vi.fn()}
      />
    );

    expect(
      screen.getByText(/Showing the first 200 matches/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stopped after scanning/)).not.toBeInTheDocument();
  });

  it("shows the scan-cap banner with the scanned count when truncated for that reason", () => {
    mockSearch.data = resultWith([], {
      truncated: true,
      reason: "scan",
      scanned: 20000,
    });
    mockSearch.error = null;
    mockSearch.isLoading = false;

    render(
      <SearchResults
        bucket="test-bucket"
        prefix=""
        query="zzz"
        onNavigate={vi.fn()}
      />
    );

    expect(
      screen.getByText(/Stopped after scanning 20000 objects/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Showing the first 200 matches/)).not.toBeInTheDocument();
  });

  it("shows neither banner when the results are not truncated", () => {
    mockSearch.data = resultWith([object("a/report.pdf")]);
    mockSearch.error = null;
    mockSearch.isLoading = false;

    render(
      <SearchResults
        bucket="test-bucket"
        prefix=""
        query="report"
        onNavigate={vi.fn()}
      />
    );

    expect(screen.queryByText(/Showing the first 200 matches/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stopped after scanning/)).not.toBeInTheDocument();
  });

  it("shows an empty-results message with the query", () => {
    mockSearch.data = resultWith([], { query: "nope" });
    mockSearch.error = null;
    mockSearch.isLoading = false;

    render(
      <SearchResults
        bucket="test-bucket"
        prefix=""
        query="nope"
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText('No objects match "nope"')).toBeInTheDocument();
  });
});
