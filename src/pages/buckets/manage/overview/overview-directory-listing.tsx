import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStore } from "zustand";
import { RefreshCw, Trash2 } from "lucide-react";
import { themeLabel, themes, Themes } from "@/app/themes";
import Button from "@/components/ui/button";
import Toggle from "@/components/ui/toggle";
import { useAuth } from "@/hooks/useAuth";
import { dayjs, handleError } from "@/lib/utils";
import appStore from "@/stores/app-store";
import { DirectoryListingStatus, DirectoryListingTheme } from "../../types";
import { useBucketContext } from "../context";
import {
  useDisableDirectoryListing,
  useEnableDirectoryListing,
} from "../hooks";
import DirectoryListingConfirm from "./directory-listing-confirm";
import { readListingTheme } from "./listing-theme";
import SaveStatus from "./save-status";

type Props = {
  status?: DirectoryListingStatus;
  /** Website access as the form shows it, which leads the server's answer. */
  websiteAccess: boolean;
};

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** Page theme option for the built-in palette. */
const AUTOMATIC = "";

/**
 * The theme as the API takes it, or null (with an error shown) when its
 * colors cannot be read.
 */
const listingTheme = (name: string): DirectoryListingTheme | null => {
  if (name === AUTOMATIC) {
    return { name: AUTOMATIC };
  }
  const theme = readListingTheme(name as Themes);
  if (!theme) {
    toast.error(`Cannot read the colors of the ${themeLabel(name as Themes)} theme`);
  }
  return theme;
};

/**
 * Generated directory-listing pages for a website bucket. Garage's website
 * endpoint never lists a folder itself, so the backend writes one index page
 * per folder and refreshes them (backend/router/listing.go). Turning the
 * listing off deletes only those pages; it never touches website access.
 *
 * The pages take their colors from a web UI theme: the one this browser uses
 * when the listing is published, and any other picked afterwards. The choice
 * is stored with the pages, so a refresh keeps it.
 */
const DirectoryListingSection = ({ status, websiteAccess }: Props) => {
  const { canWrite } = useAuth();
  const { bucketName } = useBucketContext();
  const queryClient = useQueryClient();
  const appTheme = useStore(appStore, (s) => s.theme);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Every page is an object: the browser and the index-document probe both
  // see them come and go.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["listing", bucketName] });
    queryClient.invalidateQueries({ queryKey: ["object-exists", bucketName] });
    queryClient.invalidateQueries({ queryKey: ["browse", bucketName] });
  };
  const onError = (err: Error) => {
    handleError(err);
    invalidate();
  };

  const enable = useEnableDirectoryListing(bucketName, {
    onSuccess: (sync) => {
      toast.success(
        status?.enabled
          ? "Directory listing updated"
          : `Directory listing published (${plural(sync.folders, "folder")})`
      );
      invalidate();
    },
    onError,
  });
  const disable = useDisableDirectoryListing(bucketName, {
    onSuccess: (res) => {
      toast.success(`Removed ${plural(res.deleted, "listing page")}`);
      invalidate();
    },
    onError,
  });

  if (!status) {
    return null;
  }

  const busy = enable.isPending || disable.isPending;
  const indexDocument = status.indexDocument || "index.html";

  // With website access off nobody can see the pages, but they are still in
  // the bucket — say so, and offer to clear them out.
  if (!websiteAccess) {
    if (!status.enabled) {
      return null;
    }
    return (
      <div className="mt-4 text-sm">
        <p className="text-xs text-base-content/60">
          Directory listing pages are still in this bucket. Visitors can see
          them again as soon as website access is turned back on.
        </p>
        {canWrite ? (
          <Button
            className="mt-2"
            size="sm"
            icon={Trash2}
            loading={disable.isPending}
            disabled={busy}
            onClick={() => disable.mutate()}
          >
            Remove listing pages
          </Button>
        ) : null}
      </div>
    );
  }

  const onToggle = (next: boolean) => {
    if (next) {
      // Publishing every object name needs a confirmation; the toggle stays
      // off until it is given.
      setConfirmOpen(true);
      return;
    }
    // Turning it off is the safe direction: no confirmation.
    disable.mutate();
  };

  const onConfirm = () => {
    setConfirmOpen(false);
    const theme = listingTheme(appTheme);
    if (theme) {
      enable.mutate(theme);
    }
  };

  const onThemeChange = (name: string) => {
    const theme = listingTheme(name);
    if (theme) {
      enable.mutate(theme);
    }
  };

  // A theme the pages carry that this version of the UI no longer offers
  // still shows as selected.
  const themeOptions: string[] =
    status.theme && !themes.includes(status.theme as Themes)
      ? [...themes, status.theme]
      : [...themes];

  const sync = status.lastSync;

  return (
    <div className="mt-6">
      <div className="flex flex-row items-center gap-2">
        <p className="label label-text py-0 grow-0">Directory listing</p>
        <SaveStatus
          isPending={busy}
          isSuccess={enable.isSuccess || disable.isSuccess}
          isError={enable.isError || disable.isError}
        />
      </div>

      <Toggle
        label="Enabled"
        disabled={!canWrite || busy || status.conflict || !status.available}
        color={status.enabled ? "primary" : undefined}
        checked={status.enabled}
        onChange={(e) => onToggle(e.target.checked)}
      />

      <p className="text-xs text-base-content/60 mt-1">
        Garage does not list folders by itself. This writes an{" "}
        <code>{indexDocument}</code> into every folder that lists its files and
        subfolders, and keeps it current after uploads and deletions.
      </p>

      {status.conflict ? (
        <div className="mt-2">
          <p className="text-xs text-warning">
            This bucket has its own <code>{indexDocument}</code> — Garage
            WebUI-NG will not replace or delete it.
          </p>
          {canWrite ? (
            <Button
              className="mt-2"
              size="sm"
              color="ghost"
              icon={Trash2}
              loading={disable.isPending}
              disabled={busy}
              onClick={() => disable.mutate()}
            >
              Remove generated pages in subfolders
            </Button>
          ) : null}
        </div>
      ) : null}

      {!status.available && status.reason ? (
        <p className="text-xs text-warning mt-2">{status.reason}</p>
      ) : null}

      {status.enabled ? (
        <label className="mt-3 flex flex-row flex-wrap items-center gap-2 text-sm">
          <span>Page theme</span>
          <select
            className="select select-bordered select-sm"
            value={status.theme}
            disabled={!canWrite || busy}
            onChange={(e) => onThemeChange(e.target.value)}
          >
            <option value={AUTOMATIC}>Automatic (visitor's light or dark)</option>
            {themeOptions.map((name) => (
              <option key={name} value={name}>
                {themes.includes(name as Themes)
                  ? themeLabel(name as Themes)
                  : name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {status.enabled ? (
        <div className="mt-2 flex flex-row flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">
          {status.pending ? (
            <span>Updating…</span>
          ) : sync ? (
            <span>
              {plural(sync.folders, "folder")} · {plural(sync.objects, "file")}{" "}
              · updated {dayjs(sync.at).fromNow()}
            </span>
          ) : (
            <span>Not updated since the web UI started.</span>
          )}
          {canWrite ? (
            <Button
              size="sm"
              color="ghost"
              icon={RefreshCw}
              loading={enable.isPending}
              disabled={busy}
              onClick={() => enable.mutate()}
            >
              Refresh now
            </Button>
          ) : null}
        </div>
      ) : null}

      {status.enabled && sync && !status.pending ? (
        <div className="text-xs mt-1 space-y-0.5">
          {sync.error ? (
            <p className="text-error">Last update failed: {sync.error}</p>
          ) : null}
          {sync.partial ? (
            <p className="text-warning">
              Some folders are not updated yet; the next refresh continues.
            </p>
          ) : null}
          {sync.userPages > 0 ? (
            <p className="text-base-content/60">
              {plural(sync.userPages, "folder")}{" "}
              {sync.userPages === 1 ? "has its" : "have their"} own{" "}
              <code>{indexDocument}</code>, left as it is.
            </p>
          ) : null}
          {sync.unlisted > 0 ? (
            <p className="text-base-content/60">
              {plural(sync.unlisted, "object")} not listed: the name has an
              empty, <code>.</code> or <code>..</code> path segment.
            </p>
          ) : null}
        </div>
      ) : null}

      <DirectoryListingConfirm
        bucketName={bucketName}
        indexDocument={indexDocument}
        themeName={themeLabel(appTheme)}
        isOpen={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
      />
    </div>
  );
};

export default DirectoryListingSection;
