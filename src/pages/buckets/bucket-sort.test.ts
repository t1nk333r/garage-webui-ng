import { describe, expect, it } from "vitest";
import { defaultDirection, sortBuckets } from "./bucket-sort";

const bucket = (
  name: string | null,
  objects?: number,
  bytes?: number,
  created?: string
) => ({
  aliases: name ? [name] : [],
  objects: objects as number,
  bytes: bytes as number,
  created,
});

const names = (items: { aliases: string[] }[]) =>
  items.map((b) => b.aliases[0] ?? null);

describe("sortBuckets", () => {
  const items = [
    bucket("beta", 5, 500, "2026-02-01T00:00:00Z"),
    bucket("alpha", 50, 100, "2026-03-01T00:00:00Z"),
    bucket("gamma", 1, 900, "2026-01-01T00:00:00Z"),
  ];

  it("sorts by name ascending", () => {
    expect(names(sortBuckets(items, { column: "name", direction: "asc" }))).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("sorts by size descending", () => {
    expect(names(sortBuckets(items, { column: "size", direction: "desc" }))).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  it("sorts by object count ascending", () => {
    expect(names(sortBuckets(items, { column: "objects", direction: "asc" }))).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  it("sorts by creation time, newest first", () => {
    expect(names(sortBuckets(items, { column: "created", direction: "desc" }))).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("puts unknown values last in both directions", () => {
    const withUnknown = [...items, bucket("delta")];

    for (const direction of ["asc", "desc"] as const) {
      const sorted = sortBuckets(withUnknown, { column: "created", direction });
      expect(names(sorted).at(-1)).toBe("delta");
    }
  });

  it("puts a bucket without an alias last when sorting by name", () => {
    const sorted = sortBuckets([bucket(null, 1, 1), ...items], {
      column: "name",
      direction: "asc",
    });

    expect(names(sorted).at(-1)).toBeNull();
  });

  it("does not modify the input", () => {
    const copy = [...items];
    sortBuckets(items, { column: "size", direction: "asc" });

    expect(items).toEqual(copy);
  });
});

describe("defaultDirection", () => {
  it("starts names A→Z and quantities largest first", () => {
    expect(defaultDirection("name")).toBe("asc");
    expect(defaultDirection("size")).toBe("desc");
    expect(defaultDirection("objects")).toBe("desc");
    expect(defaultDirection("created")).toBe("desc");
  });
});
