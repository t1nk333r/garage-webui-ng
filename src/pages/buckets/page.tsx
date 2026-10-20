import Page from "@/context/page-context";
import { useBuckets } from "./hooks";
import { Input } from "react-daisyui";
import BucketCard from "./components/bucket-card";
import CreateBucketDialog from "./components/create-bucket-dialog";
import BucketTable from "./components/bucket-table";
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import appStore from "@/stores/app-store";
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
  const uiStyle = useStore(appStore, (s) => s.uiStyle);
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

  if (uiStyle === "modern") {
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
  }

  return (
    <div className="container">
      <Page title="Buckets" />

      <div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex-1" />
          <CreateBucketDialog />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 items-stretch mt-4 md:mt-8">
          {items?.map((bucket) => (
            <BucketCard
              key={bucket.id}
              data={{
                ...bucket,
                aliases: bucket.aliases.length
                  ? bucket.aliases
                  : ["(no alias)"],
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default BucketsPage;
