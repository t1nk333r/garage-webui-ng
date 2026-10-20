// Layout adapted from Noooste/garage-ui (MIT, © 2025 Noste),
// frontend/src/components/buckets/BucketListView.tsx.
import IconTile from "@/components/modern/icon-tile";
import { useConfig } from "@/hooks/useConfig";
import { cn, dayjs, formatCount, readableBytes } from "@/lib/utils";
import { getBucketWebsiteBaseUrl } from "@/lib/website";
import {
  ArchiveIcon,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  FolderSearch,
  Globe,
  Settings2,
} from "lucide-react";
import { MouseEvent, ReactNode, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BucketSort,
  BucketSortColumn,
  defaultDirection,
  sortBuckets,
} from "../bucket-sort";
import { Bucket } from "../types";

type Item = Bucket & { aliases: string[] };

type Props = {
  items: Item[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  isFiltered: boolean;
};

const stop = (e: MouseEvent) => e.stopPropagation();

const BucketTable = ({ items, isLoading, error, onRetry, isFiltered }: Props) => {
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const [sort, setSort] = useState<BucketSort>({
    column: "name",
    direction: "asc",
  });

  const sorted = useMemo(() => sortBuckets(items, sort), [items, sort]);

  const toggleSort = (column: BucketSortColumn) =>
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: defaultDirection(column) }
    );

  const header = (column: BucketSortColumn, label: string, className?: string) => (
    <SortHeader column={column} sort={sort} onSort={toggleSort} className={className}>
      {label}
    </SortHeader>
  );

  return (
    <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
      <table className="table">
        <thead>
          <tr className="border-base-300">
            {header("name", "Name")}
            {header("objects", "Objects", "hidden sm:table-cell")}
            {header("size", "Size")}
            {header("created", "Created", "hidden lg:table-cell")}
            <th className="w-px">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={5} className="py-12 text-center text-base-content/60">
                <span className="loading loading-spinner loading-sm mr-2 align-middle" />
                Loading buckets…
              </td>
            </tr>
          ) : error && items.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-12 text-center">
                <p className="text-error">Couldn&apos;t load buckets</p>
                <p className="mt-1 text-xs text-base-content/60">{error.message}</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-3 border border-base-300"
                  onClick={onRetry}
                >
                  Retry
                </button>
              </td>
            </tr>
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-12 text-center text-base-content/60">
                {isFiltered ? "No buckets match your search" : "No buckets yet"}
              </td>
            </tr>
          ) : (
            sorted.map((bucket) => {
              const manageUrl = `/buckets/${bucket.id}`;
              const canBrowse = (bucket.globalAliases?.length ?? 0) > 0;
              const websiteUrl = bucket.websiteAccess
                ? getBucketWebsiteBaseUrl(bucket.globalAliases?.[0] ?? "", config)
                : null;

              return (
                <tr
                  key={bucket.id}
                  className="hover cursor-pointer border-base-300"
                  onClick={() => navigate(manageUrl)}
                >
                  <td className="max-w-0 w-full">
                    <div className="flex items-center gap-3">
                      <IconTile icon={ArchiveIcon} size="sm" />
                      <div className="min-w-0">
                        <Link
                          to={manageUrl}
                          onClick={stop}
                          className={cn(
                            "block truncate font-medium hover:underline",
                            bucket.aliases.length === 0 &&
                              "italic text-base-content/60"
                          )}
                        >
                          {bucket.aliases.length
                            ? bucket.aliases.join(", ")
                            : "(no alias)"}
                        </Link>
                        <p
                          className="truncate font-mono text-xs text-base-content/50"
                          title={bucket.id}
                        >
                          {bucket.id.slice(0, 16)}…
                        </p>
                      </div>
                      {bucket.websiteAccess ? (
                        websiteUrl ? (
                          <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={stop}
                            className="badge badge-ghost badge-sm shrink-0 gap-1 hover:underline"
                          >
                            <Globe size={12} />
                            Website
                          </a>
                        ) : (
                          <span className="badge badge-ghost badge-sm shrink-0 gap-1">
                            <Globe size={12} />
                            Website
                          </span>
                        )
                      ) : null}
                    </div>
                  </td>
                  <td
                    className="hidden whitespace-nowrap tabular-nums sm:table-cell"
                    title={bucket.objects?.toLocaleString()}
                  >
                    {formatCount(bucket.objects)}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {readableBytes(bucket.bytes)}
                  </td>
                  <td className="hidden whitespace-nowrap lg:table-cell">
                    {bucket.created
                      ? dayjs(bucket.created).format("YYYY-MM-DD")
                      : "—"}
                  </td>
                  <td onClick={stop}>
                    {/* w-max: daisyUI's .btn wraps its content, which would
                        otherwise let the table squeeze this column until the
                        buttons overflow into the one before. */}
                    <div className="ml-auto flex w-max gap-1">
                      {canBrowse ? (
                        <Link
                          to={`${manageUrl}?tab=browse`}
                          className="btn btn-ghost btn-sm"
                          aria-label={`Browse ${bucket.aliases[0]}`}
                        >
                          <FolderSearch size={16} />
                          <span className="hidden md:inline">Browse</span>
                        </Link>
                      ) : null}
                      <Link
                        to={manageUrl}
                        className="btn btn-ghost btn-sm"
                        aria-label={`Manage ${bucket.aliases[0] ?? bucket.id}`}
                      >
                        <Settings2 size={16} />
                        <span className="hidden md:inline">Manage</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

type SortHeaderProps = {
  column: BucketSortColumn;
  sort: BucketSort;
  onSort: (column: BucketSortColumn) => void;
  className?: string;
  children: ReactNode;
};

const SortHeader = ({ column, sort, onSort, className, children }: SortHeaderProps) => {
  const active = sort.column === column;
  const Icon = !active ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={className}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap hover:text-base-content",
          active && "text-base-content"
        )}
      >
        {children}
        <Icon size={14} className={active ? undefined : "opacity-40"} />
      </button>
    </th>
  );
};

export default BucketTable;
