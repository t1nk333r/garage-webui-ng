import { Table } from "react-daisyui";
import { useSearchObjects } from "./hooks";
import { dayjs, readableBytes } from "@/lib/utils";

type Props = {
  bucket: string;
  prefix: string;
  query: string;
  onNavigate: (prefix: string) => void;
};

/** The prefix containing rel (relative to prefix), i.e. rel with its final
 * path segment stripped. Used to navigate a search result to its folder. */
const parentPrefixOf = (prefix: string, rel: string) =>
  prefix + rel.slice(0, rel.lastIndexOf("/") + 1);

const SearchResults = ({ bucket, prefix, query, onNavigate }: Props) => {
  const { data, error, isLoading } = useSearchObjects(bucket, query, prefix);

  if (isLoading) {
    return (
      <div className="p-4 text-center text-base-content/60">Loading…</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-error">
        {(error as Error)?.message || "Unknown error"}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // The scan cap can stop the walk before finding any match, so "no
  // results" and "truncated" are independent — a truncated, empty result
  // still gets the banner explaining why, not just the empty message.
  const isEmpty = data.objects.length === 0;

  return (
    <div className="overflow-x-auto">
      {data.truncated && data.reason === "matches" && (
        <p className="text-xs text-warning px-2 pb-1">
          Showing the first 200 matches — narrow the search to see the rest.
        </p>
      )}
      {data.truncated && data.reason === "scan" && (
        <p className="text-xs text-warning px-2 pb-1">
          Stopped after scanning {data.scanned} objects — narrow the search or
          start from a deeper folder.
        </p>
      )}

      {isEmpty ? (
        <div className="p-4 text-center text-base-content/60">
          No objects match &quot;{query}&quot;
        </div>
      ) : (
        <Table>
          <Table.Head>
            <span>Name</span>
            <span>Size</span>
            <span>Last Modified</span>
          </Table.Head>

          <Table.Body>
            {data.objects.map((object) => (
              <tr
                key={object.objectKey}
                className="hover:bg-neutral/60 hover:text-neutral-content"
              >
                <td>
                  <button
                    type="button"
                    className="text-left font-normal hover:underline"
                    onClick={() =>
                      onNavigate(parentPrefixOf(prefix, object.objectKey))
                    }
                  >
                    {object.objectKey}
                  </button>
                </td>
                <td className="whitespace-nowrap">
                  {readableBytes(object.size)}
                </td>
                <td className="whitespace-nowrap">
                  {dayjs(object.lastModified).fromNow()}
                </td>
              </tr>
            ))}
          </Table.Body>
        </Table>
      )}

      <p className="text-xs text-base-content/60 px-2 py-2">
        Scanned {data.scanned} objects
      </p>
    </div>
  );
};

export default SearchResults;
