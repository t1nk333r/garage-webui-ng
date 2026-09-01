import { useSearchParams } from "react-router-dom";
import { Card } from "react-daisyui";
import { Search, X } from "lucide-react";

import ObjectList from "./object-list";
import { useEffect, useState } from "react";
import ObjectListNavigator from "./object-list-navigator";
import Actions from "./actions";
import { useBucketContext } from "../context";
import ShareDialog from "./share-dialog";
import BulkActions from "./bulk-actions";
import MediaViewer from "./media-viewer";
import SearchResults from "./search-results";
import Input from "@/components/ui/input";
import Button from "@/components/ui/button";
import { useDebounce } from "@/hooks/useDebounce";

const MIN_SEARCH_QUERY_LENGTH = 2;

const getInitialPrefixes = (searchParams: URLSearchParams) => {
  const prefix = searchParams.get("prefix");
  if (prefix) {
    const paths = prefix.split("/").filter((p) => p);
    return paths.map((_, i) => paths.slice(0, i + 1).join("/") + "/");
  }
  return [];
};

const BrowseTab = () => {
  const { bucket, bucketName } = useBucketContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefixHistory, setPrefixHistory] = useState<string[]>(
    getInitialPrefixes(searchParams)
  );
  const [curPrefix, setCurPrefix] = useState(prefixHistory.length - 1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debouncedSetSearch = useDebounce(setDebouncedSearch, 300);

  const onSearchChange = (value: string) => {
    setSearch(value);
    debouncedSetSearch(value);
  };

  const clearSearch = () => {
    setSearch("");
    setDebouncedSearch("");
  };

  useEffect(() => {
    const prefix = prefixHistory[curPrefix] || "";
    const newParams = new URLSearchParams(searchParams);
    newParams.set("prefix", prefix);
    setSearchParams(newParams);
  }, [curPrefix]);

  // Selection is scoped to the current prefix by design: navigating clears it.
  useEffect(() => {
    setSelected(new Set());
  }, [curPrefix]);

  // Navigating (breadcrumb, back/forward, or a search result's own click)
  // clears the search — all of those go through setCurPrefix, either
  // directly (ObjectListNavigator) or via gotoPrefix below.
  useEffect(() => {
    setSearch("");
    setDebouncedSearch("");
  }, [curPrefix]);

  const gotoPrefix = (prefix: string) => {
    const history = prefixHistory.slice(0, curPrefix + 1);
    setPrefixHistory([...history, prefix]);
    setCurPrefix(history.length);
  };

  if (!bucket.keys.find((k) => k.permissions.read && k.permissions.write)) {
    return (
      <div className="p-4 min-h-[200px] flex flex-col items-center justify-center">
        <p className="text-center max-w-sm">
          You need to add a key with read & write access to your bucket to be
          able to browse it.
        </p>
      </div>
    );
  }

  const prefix = prefixHistory[curPrefix] || "";
  const isSearching = debouncedSearch.trim().length >= MIN_SEARCH_QUERY_LENGTH;

  return (
    <div>
      <Card className="pb-2">
        <ObjectListNavigator
          curPrefix={curPrefix}
          setCurPrefix={setCurPrefix}
          prefixHistory={prefixHistory}
          actions={
            <>
              <div className="flex items-center gap-1">
                <Input
                  aria-label="Search objects"
                  placeholder="Search this folder and below…"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
                {search ? (
                  <Button
                    icon={X}
                    color="ghost"
                    aria-label="Clear search"
                    onClick={clearSearch}
                  />
                ) : (
                  <Search
                    size={18}
                    className="text-base-content/40 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </div>
              <Actions prefix={prefix} />
            </>
          }
        />

        {selected.size > 0 && (
          <BulkActions
            bucketName={bucketName}
            selected={selected}
            setSelected={setSelected}
          />
        )}

        {isSearching ? (
          <SearchResults
            bucket={bucketName}
            prefix={prefix}
            query={debouncedSearch}
            onNavigate={(p) => {
              clearSearch();
              gotoPrefix(p);
            }}
          />
        ) : (
          <ObjectList
            prefix={prefix}
            onPrefixChange={gotoPrefix}
            selected={selected}
            setSelected={setSelected}
          />
        )}

        <ShareDialog />
        <MediaViewer />
      </Card>
    </div>
  );
};

export default BrowseTab;
