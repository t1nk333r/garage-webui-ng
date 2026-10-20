import { Bucket } from "./types";

export type BucketSortColumn = "name" | "objects" | "size" | "created";

export type BucketSort = {
  column: BucketSortColumn;
  direction: "asc" | "desc";
};

type SortableBucket = Pick<Bucket, "objects" | "bytes" | "created"> & {
  aliases: string[];
};

// undefined means "unknown" — a missing creation time or a bucket without an
// alias — and always sorts last, in either direction. (A bucket whose details
// failed to load reports 0 objects and 0 bytes; the backend cannot tell that
// apart from an empty bucket, so neither can this.)
const accessors: Record<
  BucketSortColumn,
  (bucket: SortableBucket) => string | number | undefined
> = {
  name: (b) => b.aliases[0],
  objects: (b) => b.objects,
  size: (b) => b.bytes,
  created: (b) => (b.created ? Date.parse(b.created) : undefined),
};

/** The direction a column sorts in when first selected. */
export const defaultDirection = (column: BucketSortColumn) =>
  column === "name" ? "asc" : "desc";

/** Returns a sorted copy; the input is not modified. */
export const sortBuckets = <T extends SortableBucket>(
  buckets: T[],
  { column, direction }: BucketSort
): T[] => {
  const get = accessors[column];
  const sign = direction === "asc" ? 1 : -1;

  return [...buckets].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === undefined || vb === undefined) {
      return va === vb ? 0 : va === undefined ? 1 : -1;
    }
    const order =
      typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb)
        : (va as number) - (vb as number);
    return sign * order;
  });
};
