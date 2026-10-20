import { describe, expect, it } from "vitest";
import { formatShare, toUsageSlices } from "./usage";

const bucket = (name: string, size: number) => ({ id: `id-${name}`, name, size });

describe("toUsageSlices", () => {
  it("orders slices largest first and drops empty buckets", () => {
    const slices = toUsageSlices(
      [bucket("small", 10), bucket("empty", 0), bucket("big", 90)],
      8
    );

    expect(slices.map((s) => s.name)).toEqual(["big", "small"]);
    expect(slices[0].share).toBeCloseTo(0.9);
  });

  it("returns no slices when every bucket is empty", () => {
    expect(toUsageSlices([bucket("a", 0), bucket("b", 0)], 8)).toEqual([]);
  });

  it("folds buckets under the minimum share into one Other slice", () => {
    const slices = toUsageSlices(
      [bucket("big", 970), bucket("tiny-a", 10), bucket("tiny-b", 10), bucket("tiny-c", 10)],
      8
    );

    expect(slices.map((s) => s.name)).toEqual(["big", "Other"]);
    const other = slices[1];
    expect(other).toMatchObject({ isOther: true, id: null, bucketCount: 3, size: 30 });
  });

  it("names a lone small bucket instead of hiding it in Other", () => {
    const slices = toUsageSlices([bucket("big", 990), bucket("tiny", 10)], 8);

    expect(slices.map((s) => s.name)).toEqual(["big", "tiny"]);
    expect(slices.some((s) => s.isOther)).toBe(false);
  });

  it("never names more buckets than the palette has hues", () => {
    const many = Array.from({ length: 12 }, (_, i) => bucket(`b${i}`, 100));
    const slices = toUsageSlices(many, 8);

    expect(slices.filter((s) => !s.isOther)).toHaveLength(8);
    expect(slices.at(-1)).toMatchObject({ isOther: true, bucketCount: 4 });
  });

  it("has shares that sum to one", () => {
    const slices = toUsageSlices(
      [bucket("a", 1), bucket("b", 2), bucket("c", 3), bucket("d", 500)],
      8
    );
    const total = slices.reduce((sum, s) => sum + s.share, 0);

    expect(total).toBeCloseTo(1);
  });
});

describe("formatShare", () => {
  it("formats a share as a one-decimal percentage", () => {
    expect(formatShare(0.4751)).toBe("47.5%");
  });

  it("says <0.1% rather than 0.0% for a visible sliver", () => {
    expect(formatShare(0.0004)).toBe("<0.1%");
  });

  it("formats zero as 0.0%", () => {
    expect(formatShare(0)).toBe("0.0%");
  });
});
