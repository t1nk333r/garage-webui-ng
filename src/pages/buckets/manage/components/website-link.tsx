import { useConfig } from "@/hooks/useConfig";
import { getBucketWebsiteBaseUrl } from "@/lib/website";
import { ExternalLink, Globe } from "lucide-react";
import { Bucket } from "../../types";

/**
 * Opens the bucket's public website in a new browser tab. It sits at the end
 * of the bucket's tab row and looks like a tab, but it is a plain link: it
 * leaves the page rather than switching panels, so it lives outside the
 * tablist. Shown only while website access is on and a public URL is known.
 */
const BucketWebsiteLink = ({ bucket }: { bucket: Bucket }) => {
  const { data: config } = useConfig();
  const name = bucket.globalAliases?.[0];
  const url =
    bucket.websiteAccess && name ? getBucketWebsiteBaseUrl(name, config) : null;

  if (!url) {
    return null;
  }

  return (
    <div role="none" className="tabs tabs-bordered">
      <a
        href={`${url}/`}
        target="_blank"
        rel="noreferrer"
        title={`${url}/`}
        className="tab flex flex-row items-center gap-x-2 h-auto shrink-0"
      >
        <Globe size={20} aria-hidden="true" />
        <span>Website</span>
        <ExternalLink size={14} aria-hidden="true" className="opacity-60" />
      </a>
    </div>
  );
};

export default BucketWebsiteLink;
