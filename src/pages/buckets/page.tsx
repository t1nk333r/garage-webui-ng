import Page from "@/context/page-context";
import { useBuckets } from "./hooks";
import CreateBucketDialog from "./components/create-bucket-dialog";
import BucketTable from "./components/bucket-table";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

export const compareByFirstAlias = (
  a: { aliases: string[] },
  b: { aliases: string[] }
) => (a.aliases[0] ?? "").localeCompare(b.aliases[0] ?? "");

export const matchesBucketSearch = (
  bucket: { id: string; aliases: string[] },
  query: string
) => {
  const q = query.toLowerCase();
  return (
    bucket.id.toLowerCase().includes(q) ||
    bucket.aliases.some((alias) => alias.toLowerCase().includes(q))
  );
};

const BucketsPage = () => {
  const { data, isLoading, error, refetch } = useBuckets();
  const [search, setSearch] = useState("");

  const items = useMemo(() => {
    let buckets =
      data?.map((bucket) => {
        return {
          ...bucket,
          aliases: [
            ...(bucket.globalAliases || []),
            ...(bucket.localAliases?.map((l) => l.alias) || []),
          ],
        };
      }) || [];

    if (search?.length > 0) {
      buckets = buckets.filter((bucket) => matchesBucketSearch(bucket, search));
    }

    buckets = buckets.sort(compareByFirstAlias);

    return buckets;
  }, [data, search]);

  return (
    <div className="space-y-4">
      <Page
        title="Buckets"
        subtitle={
          data
            ? `${data.length} bucket${data.length === 1 ? "" : "s"}`
            : error
              ? "Couldn't load buckets"
              : "Loading…"
        }
      />

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <label className="input input-bordered flex w-full items-center gap-2 sm:max-w-xs">
          <Search size={16} className="shrink-0 opacity-60" />
          <input
            type="search"
            className="grow"
            placeholder="Search buckets…"
            aria-label="Search buckets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex-1" />
        <CreateBucketDialog />
      </div>

      <BucketTable
        items={items}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        isFiltered={search.length > 0}
      />
    </div>
  );
};

export default BucketsPage;
