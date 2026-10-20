// Layout adapted from Noooste/garage-ui (MIT, © 2025 Noste),
// frontend/src/pages/Dashboard.tsx.
import Page from "@/context/page-context";
import IconTile, { IconTileTone } from "@/components/modern/icon-tile";
import SectionCard, { SectionCardLink } from "@/components/modern/section-card";
import { dayjs, formatCount, readableBytes } from "@/lib/utils";
import {
  Activity,
  ArchiveIcon,
  CircleAlert,
  CircleCheck,
  CircleX,
  FolderOpen,
  HardDrive,
  LucideIcon,
  TriangleAlert,
} from "lucide-react";
import { ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useBuckets } from "../../buckets/hooks";
import { bucketAliases, bucketDisplayName } from "../../buckets/bucket-name";
import { useNodesHealth } from "../hooks";
import { formatShare } from "../usage";
import BucketUsageChart from "./bucket-usage-chart";
import MetricsPanel from "./metrics-panel";

// Breakdown rows shown before "Show all".
const BREAKDOWN_ROWS = 5;
const RECENT_BUCKETS = 5;

const objectLabel = (n: number) =>
  `${formatCount(n)} ${n === 1 ? "object" : "objects"}`;

type ClusterState = {
  label: string;
  tone: IconTileTone;
  icon: LucideIcon;
};

// Garage reports "healthy", "degraded" or "unavailable" (GetClusterHealth).
const clusterState = (status?: string): ClusterState => {
  switch (status) {
    case "healthy":
      return { label: "Healthy", tone: "success", icon: CircleCheck };
    case "degraded":
      return { label: "Degraded", tone: "warning", icon: TriangleAlert };
    case "unavailable":
      return { label: "Unavailable", tone: "error", icon: CircleX };
    default:
      return {
        label: status ? status.charAt(0).toUpperCase() + status.slice(1) : "…",
        tone: "neutral",
        icon: Activity,
      };
  }
};

type UsageRow = {
  id: string;
  name: string;
  size: number;
  objects: number;
  share: number;
};

const ModernDashboard = () => {
  const healthQuery = useNodesHealth();
  const bucketsQuery = useBuckets();
  const health = healthQuery.data;
  const buckets = bucketsQuery.data;
  // A failed health request is not Garage's own "unavailable" status, so it
  // gets a label of its own.
  const state: ClusterState = healthQuery.isError
    ? { label: "Unknown", tone: "neutral", icon: Activity }
    : clusterState(health?.status);

  const totals = useMemo(() => {
    if (!buckets) return null;
    return {
      bytes: buckets.reduce((sum, b) => sum + (b.bytes ?? 0), 0),
      objects: buckets.reduce((sum, b) => sum + (b.objects ?? 0), 0),
      count: buckets.length,
    };
  }, [buckets]);

  // Largest first, so the breakdown reads as a ranking of storage use.
  const usage = useMemo<UsageRow[]>(() => {
    const rows = (buckets ?? []).map((b) => ({
      id: b.id,
      name: bucketDisplayName(b),
      size: b.bytes ?? 0,
      objects: b.objects ?? 0,
    }));
    const total = rows.reduce((sum, r) => sum + r.size, 0);
    return rows
      .map((r) => ({ ...r, share: total > 0 ? r.size / total : 0 }))
      .sort((a, b) => b.size - a.size);
  }, [buckets]);

  // Garage lists buckets in id order, so pick the newest ones explicitly. A
  // bucket whose details failed to load has no creation time and sorts last.
  const recent = useMemo(
    () =>
      [...(buckets ?? [])]
        .sort(
          (a, b) =>
            (b.created ? Date.parse(b.created) : -Infinity) -
            (a.created ? Date.parse(a.created) : -Infinity)
        )
        .slice(0, RECENT_BUCKETS),
    [buckets]
  );

  const pending = bucketsQuery.isError ? "—" : "…";

  return (
    <div className="space-y-6">
      <Page
        title="Dashboard"
        subtitle={
          health
            ? `${health.connectedNodes}/${health.knownNodes} nodes connected`
            : healthQuery.isError
              ? "Cluster status unavailable"
              : "Loading cluster status…"
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total storage"
          value={totals ? readableBytes(totals.bytes) : pending}
          sub={
            totals
              ? `across ${totals.count} bucket${totals.count === 1 ? "" : "s"}`
              : undefined
          }
          icon={HardDrive}
          tone="primary"
        />
        <StatCard
          label="Objects"
          value={totals ? formatCount(totals.objects) : pending}
          valueTitle={totals?.objects.toLocaleString()}
          sub="stored objects"
          icon={FolderOpen}
          tone="secondary"
        />
        <StatCard
          label="Buckets"
          value={totals ? formatCount(totals.count) : pending}
          sub="storage buckets"
          icon={ArchiveIcon}
          tone="accent"
        />
        <StatCard
          label="Cluster"
          value={state.label}
          sub={
            health
              ? `${health.storageNodesUp}/${health.storageNodes} storage nodes up`
              : undefined
          }
          icon={state.icon}
          tone={state.tone}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {/* Storage: where the space goes */}
        <div className="space-y-4">
          <SectionCard
            title="Storage usage by bucket"
            description="Distribution of storage across buckets"
          >
            {!buckets ? (
              <Unavailable query={bucketsQuery} what="buckets" />
            ) : usage.length > 0 ? (
              <BucketUsageChart data={usage} />
            ) : (
              <Placeholder>No buckets yet</Placeholder>
            )}
          </SectionCard>

          <SectionCard
            title="Breakdown"
            description="Size and object count per bucket, largest first"
          >
            {!buckets ? (
              <Unavailable query={bucketsQuery} what="buckets" />
            ) : usage.length > 0 ? (
              <Breakdown rows={usage} />
            ) : (
              <Placeholder>No buckets yet</Placeholder>
            )}
          </SectionCard>
        </div>

        {/* Cluster state and recent activity */}
        <div className="space-y-4">
          <SectionCard
            title="Cluster"
            description="Node and partition health"
            action={<SectionCardLink to="/cluster">Details</SectionCardLink>}
          >
            {health ? (
              <ul className="divide-y divide-base-300">
                <HealthRow
                  label="Storage nodes"
                  up={health.storageNodesUp}
                  total={health.storageNodes}
                  note="up"
                />
                <HealthRow
                  label="Partitions"
                  up={health.partitionsAllOk}
                  total={health.partitions}
                  note="fully replicated"
                />
                <HealthRow
                  label="Partition quorum"
                  up={health.partitionsQuorum}
                  total={health.partitions}
                  note="have quorum"
                />
                <HealthRow
                  label="Connected nodes"
                  up={health.connectedNodes}
                  total={health.knownNodes}
                  note="reachable"
                />
              </ul>
            ) : (
              <Unavailable query={healthQuery} what="cluster status" />
            )}
          </SectionCard>

          <SectionCard
            title="Recent buckets"
            description="Your most recently created buckets"
            action={
              recent.length > 0 ? (
                <SectionCardLink to="/buckets">View all</SectionCardLink>
              ) : undefined
            }
          >
            {!buckets ? (
              <Unavailable query={bucketsQuery} what="buckets" />
            ) : recent.length === 0 ? (
              <Placeholder>
                No buckets yet —{" "}
                <Link to="/buckets" className="link">
                  create one
                </Link>
              </Placeholder>
            ) : (
              <ul className="-my-2 divide-y divide-base-300">
                {recent.map((bucket) => (
                  <li key={bucket.id}>
                    <Link
                      to={`/buckets/${bucket.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-base-200"
                    >
                      <IconTile icon={ArchiveIcon} tone="primary" size="md" />
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            bucketAliases(bucket).length
                              ? "truncate text-sm font-medium"
                              : "truncate text-sm font-medium italic text-base-content/60"
                          }
                        >
                          {bucketDisplayName(bucket)}
                        </p>
                        <p className="truncate text-xs text-base-content/60">
                          {bucket.created
                            ? `Created ${dayjs(bucket.created).format("YYYY-MM-DD")}`
                            : "Creation date unavailable"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className="text-sm font-medium tabular-nums"
                          title={bucket.objects?.toLocaleString()}
                        >
                          {objectLabel(bucket.objects ?? 0)}
                        </p>
                        <p className="text-xs tabular-nums text-base-content/60">
                          {readableBytes(bucket.bytes)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <MetricsPanel className="mt-0 md:mt-0 border border-base-300 p-5 md:p-5" />
    </div>
  );
};

const Placeholder = ({ children }: { children: ReactNode }) => (
  <p className="py-8 text-center text-sm text-base-content/60">{children}</p>
);

type QueryState = {
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
};

/** "Loading…" while a query is pending; the error and a retry once it fails. */
const Unavailable = ({ query, what }: { query: QueryState; what: string }) =>
  query.isError ? (
    <div className="py-8 text-center text-sm">
      <p className="text-error">Couldn&apos;t load {what}</p>
      {query.error?.message ? (
        <p className="mt-1 text-xs text-base-content/60">{query.error.message}</p>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost btn-sm mt-3 border border-base-300"
        onClick={() => query.refetch()}
      >
        Retry
      </button>
    </div>
  ) : (
    <Placeholder>Loading…</Placeholder>
  );

type StatCardProps = {
  label: string;
  value: string;
  valueTitle?: string;
  sub?: string;
  icon: LucideIcon;
  tone: IconTileTone;
};

const StatCard = ({ label, value, valueTitle, sub, icon, tone }: StatCardProps) => (
  <div className="rounded-box border border-base-300 bg-base-100 p-4">
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-base-content/60">
        {label}
      </span>
      <IconTile icon={icon} tone={tone} size="sm" />
    </div>
    <p
      title={valueTitle}
      className="mt-2 truncate text-[26px] font-semibold leading-none tracking-tight"
    >
      {value}
    </p>
    {sub ? <p className="mt-1.5 text-[13px] text-base-content/60">{sub}</p> : null}
  </div>
);

type HealthRowProps = {
  label: string;
  up: number;
  total: number;
  note: string;
};

const HealthRow = ({ label, up, total, note }: HealthRowProps) => {
  const ok = up === total;
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon
        size={16}
        aria-hidden="true"
        className={ok ? "shrink-0 text-success" : "shrink-0 text-warning"}
      />
      <span className="flex-1 text-sm">
        {label}
        <span className="sr-only">{ok ? " (OK)" : " (needs attention)"}</span>
      </span>
      <span className="text-xs text-base-content/60">{note}</span>
      <span className="w-16 text-right text-sm font-semibold tabular-nums">
        {up}/{total}
      </span>
    </li>
  );
};

const Breakdown = ({ rows }: { rows: UsageRow[] }) => {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, BREAKDOWN_ROWS);

  return (
    <div>
      <ul className="-my-1.5">
        {shown.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_4.5rem_3.5rem] items-center gap-x-3 py-1.5 text-[13px] md:grid-cols-[minmax(0,1fr)_6rem_6rem_4.5rem_3.5rem]"
          >
            <Link
              to={`/buckets/${row.id}`}
              className="truncate font-medium hover:underline"
            >
              {row.name}
            </Link>
            <div className="hidden h-1.5 overflow-hidden rounded-full bg-base-content/10 md:block">
              {row.share > 0 ? (
                <div
                  className="h-full min-w-0.5 rounded-full bg-primary"
                  style={{ width: `${row.share * 100}%` }}
                />
              ) : null}
            </div>
            <span
              className="hidden whitespace-nowrap text-right tabular-nums text-base-content/60 md:block"
              title={row.objects.toLocaleString()}
            >
              {objectLabel(row.objects)}
            </span>
            <span className="text-right font-medium tabular-nums">
              {readableBytes(row.size)}
            </span>
            <span className="text-right tabular-nums text-base-content/60">
              {formatShare(row.share)}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > BREAKDOWN_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="btn btn-ghost btn-sm mt-3 w-full border border-base-300 font-medium text-base-content/70"
        >
          {expanded ? "Show fewer" : `Show all ${rows.length} buckets`}
        </button>
      ) : null}
    </div>
  );
};

export default ModernDashboard;
