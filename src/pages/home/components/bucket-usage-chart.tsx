// Adapted from Noooste/garage-ui (MIT, © 2025 Noste),
// frontend/src/components/charts/BucketUsageChart.tsx.
import { darkThemes } from "@/app/themes";
import { cn, readableBytes } from "@/lib/utils";
import appStore from "@/stores/app-store";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { useStore } from "zustand";
import { categoricalPalette, otherColor } from "../chart-colors";
import { BucketUsage, formatShare, toUsageSlices, UsageSlice } from "../usage";

const SIZE = 200;

const bucketCount = (n: number) => `${n} ${n === 1 ? "bucket" : "buckets"}`;

type Props = {
  data: BucketUsage[];
};

const BucketUsageChart = ({ data }: Props) => {
  const theme = useStore(appStore, (s) => s.theme);
  const mode = darkThemes.has(theme) ? "dark" : "light";
  const palette = categoricalPalette[mode];
  const [active, setActive] = useState<number | null>(null);

  const slices = useMemo(
    () => toUsageSlices(data, palette.length),
    [data, palette.length]
  );

  if (slices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-base-content/60">
        All buckets are empty
      </p>
    );
  }

  // Colors follow a slice's rank in size order, which is stable for a given
  // dataset; "Other" always takes the neutral.
  const colorOf = (slice: UsageSlice, index: number) =>
    slice.isOther ? otherColor[mode] : palette[index];
  const total = slices.reduce((sum, s) => sum + s.size, 0);
  const focus = active === null ? null : slices[active];
  const dimmed = (index: number) => active !== null && active !== index;

  return (
    <div
      className="flex flex-col items-center gap-6 sm:flex-row"
      onMouseLeave={() => setActive(null)}
    >
      {/* The legend carries the same data as text, so the drawing is hidden
          from screen readers. */}
      <div
        className="relative shrink-0"
        style={{ width: SIZE, height: SIZE }}
        aria-hidden="true"
      >
        <PieChart width={SIZE} height={SIZE} accessibilityLayer={false}>
          <Pie
            data={slices}
            dataKey="size"
            nameKey="name"
            innerRadius={68}
            outerRadius={96}
            paddingAngle={slices.length > 1 ? 1.5 : 0}
            cornerRadius={3}
            stroke="none"
            startAngle={90}
            endAngle={-270}
            rootTabIndex={-1}
            onMouseEnter={(_, index) => setActive(index)}
            isAnimationActive={false}
          >
            {slices.map((slice, index) => (
              <Cell
                key={slice.id ?? " other"}
                fill={colorOf(slice, index)}
                fillOpacity={dimmed(index) ? 0.25 : 1}
                style={{ transition: "fill-opacity 150ms ease-out", outline: "none" }}
              />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[17px] font-semibold tabular-nums">
            {readableBytes(focus ? focus.size : total)}
          </span>
          <span className="mt-0.5 max-w-[112px] truncate text-xs text-base-content/60">
            {focus
              ? focus.isOther
                ? `Other, ${bucketCount(focus.bucketCount)}`
                : focus.name
              : "total stored"}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-0.5" aria-label="Storage by bucket">
        {slices.map((slice, index) => (
          <li
            key={slice.id ?? " other"}
            onMouseEnter={() => setActive(index)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1 text-[13px] transition-opacity duration-150",
              dimmed(index) && "opacity-45"
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: colorOf(slice, index) }}
            />
            <span className="min-w-0 flex-1 truncate">
              {slice.isOther ? (
                <>
                  Other{" "}
                  <span className="text-base-content/60">
                    ({bucketCount(slice.bucketCount)})
                  </span>
                </>
              ) : (
                slice.name
              )}
            </span>
            <span className="tabular-nums text-base-content/60">
              {formatShare(slice.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BucketUsageChart;
