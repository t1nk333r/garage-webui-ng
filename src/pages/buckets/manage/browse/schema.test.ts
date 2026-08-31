import { describe, expect, it } from "vitest";
import { createFolderSchema } from "./schema";

const parse = (name: string) => createFolderSchema.safeParse({ name });

describe("createFolderSchema", () => {
  // The regression this replaces: the old /^[a-zA-Z0-9_-]+$/ rejected every
  // one of these. Upstream khairul169/garage-webui#52.
  it.each([
    ["a hive-style partition", "year=2026"],
    ["a partition value with a dash", "region=eu-west-1"],
    ["a dot in the name", "v1.2.0"],
    ["a space", "my folder"],
    ["non-ascii", "ドキュメント"],
    ["accented latin", "résumé"],
    ["parentheses and plus", "photos (2026)+raw"],
    ["a leading dot", ".hidden"],
    ["plain ascii, as before", "documents_v2-final"],
  ])("accepts %s", (_label, name) => {
    expect(parse(name).success).toBe(true);
  });

  it.each([
    ["an empty name", ""],
    ["a path separator", "a/b"],
    ["a trailing separator", "docs/"],
    ["the current directory", "."],
    ["the parent directory", ".."],
    ["a control character", "bad\u0007name"],
    ["a newline", "two\nlines"],
    ["a NUL", "nul\u0000byte"],
  ])("rejects %s", (_label, name) => {
    expect(parse(name).success).toBe(false);
  });
});
