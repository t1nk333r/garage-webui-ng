import { Bucket } from "./types";

type Named = Pick<Bucket, "id" | "globalAliases" | "localAliases">;

/** Every alias of a bucket, global ones first. */
export const bucketAliases = (bucket: Named): string[] => [
  ...(bucket.globalAliases || []),
  ...(bucket.localAliases?.map((l) => l.alias) || []),
];

/**
 * The name to show for a bucket: its first alias, or a shortened id for a
 * bucket that has none (such a bucket cannot be browsed — see
 * getBucketCredentials in backend/router/browse.go).
 */
export const bucketDisplayName = (bucket: Named): string =>
  bucketAliases(bucket)[0] ?? `${bucket.id.slice(0, 12)}…`;
