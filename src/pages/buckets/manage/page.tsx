import { useParams } from "react-router-dom";
import { useBucket } from "./hooks";
import Page from "@/context/page-context";
import TabView, { Tab } from "@/components/containers/tab-view";
import {
  ArchiveIcon,
  ChartLine,
  CircleXIcon,
  Copy,
  FolderSearch,
  Globe,
  LockKeyhole,
} from "lucide-react";
import OverviewTab from "./overview/overview-tab";
import PermissionsTab from "./permissions/permissions-tab";
import MenuButton from "./components/menu-button";
import BrowseTab from "./browse/browse-tab";
import { BucketContext } from "./context";
import { Alert, Loading } from "react-daisyui";
import { copyToClipboard, formatCount, readableBytes } from "@/lib/utils";
import { Bucket } from "../types";

const tabs: Tab[] = [
  {
    name: "overview",
    title: "Overview",
    icon: ChartLine,
    Component: OverviewTab,
  },
  {
    name: "permissions",
    title: "Permissions",
    icon: LockKeyhole,
    Component: PermissionsTab,
  },
  {
    name: "browse",
    title: "Browse",
    icon: FolderSearch,
    Component: BrowseTab,
  },
];

const ManageBucketPage = () => {
  const { id } = useParams();
  const { data, error, isLoading, refetch } = useBucket(id);
  const name = data?.globalAliases?.[0];
  const hasAlias = !!name;

  return (
    <>
      <Page
        title={name || "Manage Bucket"}
        prev="/buckets"
        icon={ArchiveIcon}
        subtitle={data ? <BucketSummary bucket={data} /> : undefined}
        actions={
          data ? (
            name ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => copyToClipboard(`s3://${name}`)}
                >
                  <Copy size={16} />
                  Copy S3 URI
                </button>
                <MenuButton />
              </>
            ) : (
              <MenuButton />
            )
          ) : undefined
        }
      />

      {isLoading && (
        <div className="h-full flex items-center justify-center">
          <Loading size="lg" />
        </div>
      )}

      {error != null && (
        <Alert status="error" icon={<CircleXIcon />}>
          <span>{error.message}</span>
        </Alert>
      )}

      {data && (
        <div className="container">
          {!hasAlias && (
            <Alert
              status="warning"
              icon={<CircleXIcon />}
              className="mb-4 items-start text-sm"
            >
              <span>
                This bucket has no global alias. Object browsing is unavailable
                until one is added — the storage API addresses buckets by alias.
                Add an alias in the Overview tab.
              </span>
            </Alert>
          )}
          <BucketContext.Provider
            value={{ bucket: data, refetch, bucketName: name || "" }}
          >
            <TabView tabs={tabs} variant="bordered" contentClassName="mt-5" />
          </BucketContext.Provider>
        </div>
      )}
    </>
  );
};

/** The page header's line under the bucket name. */
const BucketSummary = ({ bucket }: { bucket: Bucket }) => {
  const name = bucket.globalAliases?.[0];

  return (
    <div className="space-y-2">
      {name ? (
        <p className="truncate font-mono text-[13px]">s3://{name}</p>
      ) : (
        <p className="italic">No global alias</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <span className="badge badge-outline border-base-300" title={bucket.objects?.toLocaleString()}>
          {formatCount(bucket.objects)} {bucket.objects === 1 ? "object" : "objects"}
        </span>
        <span className="badge badge-outline border-base-300">{readableBytes(bucket.bytes)}</span>
        {bucket.websiteAccess ? (
          <span className="badge badge-outline gap-1 border-base-300">
            <Globe size={12} />
            Website
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default ManageBucketPage;
