//

export type GetBucketRes = Bucket[];

export type Bucket = {
  id: string;
  globalAliases: string[];
  localAliases: LocalAlias[];
  websiteAccess: boolean;
  websiteConfig?: WebsiteConfig | null;
  keys: Key[];
  objects: number;
  bytes: number;
  unfinishedUploads: number;
  unfinishedMultipartUploads: number;
  unfinishedMultipartUploadParts: number;
  unfinishedMultipartUploadBytes: number;
  quotas: Quotas;
  /** RFC 3339 creation time, from ListBuckets; treat empty or absent as unknown. */
  created?: string;
};

export type LocalAlias = {
  accessKeyId: string;
  alias: string;
};

export type Key = {
  accessKeyId: string;
  name: string;
  permissions: Permissions;
  bucketLocalAliases: string[];
};

export type Permissions = {
  read: boolean;
  write: boolean;
  owner: boolean;
};

export type WebsiteConfig = {
  indexDocument: string;
  errorDocument: string;
};

export type Quotas = {
  maxSize: null;
  maxObjects: null;
};

/** GET /listing/{bucket}: generated directory-listing pages for a website bucket. */
export type DirectoryListingStatus = {
  /** The bucket's root index document exists and was written by this tool. */
  enabled: boolean;
  /** The root index document exists but someone else wrote it. */
  conflict: boolean;
  websiteAccess: boolean;
  indexDocument: string;
  /** False when listing cannot be checked at all; `reason` says why. */
  available: boolean;
  reason?: string;
  /** A refresh is queued or running. */
  pending: boolean;
  lastSync: DirectoryListingSync | null;
};

export type DirectoryListingSync = {
  at: string;
  folders: number;
  objects: number;
  written: number;
  unchanged: number;
  deleted: number;
  userPages: number;
  unlisted: number;
  partial: boolean;
  error?: string;
};
