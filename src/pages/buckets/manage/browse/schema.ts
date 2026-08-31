import { z } from "zod";

/**
 * S3 object keys are near-arbitrary UTF-8, so this validates only what actually
 * breaks rather than an allowlist of "safe" characters. The caller appends its
 * own "/" (see CreateFolderAction in actions.tsx), which is why the separator
 * is rejected here.
 *
 * "=" in particular MUST be accepted: partitioned datasets (Hive-style Parquet,
 * Delta) name every directory `column=value`. Upstream
 * khairul169/garage-webui#52.
 */
export const createFolderSchema = z.object({
  name: z
    .string()
    .min(1, "Folder Name is required")
    .refine((name) => !name.includes("/"), {
      message: 'Folder name cannot contain "/"',
    })
    .refine((name) => name !== "." && name !== "..", {
      message: 'Folder name cannot be "." or ".."',
    })
    // Control characters are legal in an S3 key but corrupt the URLs and XML
    // the key travels through, and cannot be typed back to fix. Matching them
    // is the point here, so the lint rule against it does not apply.
    // eslint-disable-next-line no-control-regex
    .refine((name) => !/[\u0000-\u001F\u007F]/.test(name), {
      message: "Folder name cannot contain control characters",
    }),
});

export type CreateFolderSchema = z.infer<typeof createFolderSchema>;
