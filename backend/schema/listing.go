package schema

import "time"

// DirectoryListingStatus is the answer to GET /listing/{bucket}.
//
// Enabled is read from the bucket itself, not from local state: listing is on
// exactly when the bucket's root index document exists and carries the
// generated-page marker. It is reported whether or not website access is on,
// so the UI can offer to remove pages left behind after access was switched
// off. Conflict means the root index exists but someone else wrote it.
type DirectoryListingStatus struct {
	Enabled       bool                  `json:"enabled"`
	Conflict      bool                  `json:"conflict"`
	WebsiteAccess bool                  `json:"websiteAccess"`
	IndexDocument string                `json:"indexDocument"`
	Available     bool                  `json:"available"`
	Reason        string                `json:"reason,omitempty"`
	Pending       bool                  `json:"pending"`
	LastSync      *DirectoryListingSync `json:"lastSync"`
	// Theme names the web UI theme the pages use; "" is the built-in palette,
	// which follows the visitor's light or dark preference.
	Theme string `json:"theme"`
}

// DirectoryListingTheme gives the generated pages the colors of one of the
// web UI's themes. Colors holds daisyUI's resolved theme variables b1, b2
// and b3 (base surfaces), bc (base content) and p (primary), each an OKLCH
// triple "L% C H" exactly as the compiled stylesheet declares it. An empty
// Name is the built-in palette and carries no colors.
type DirectoryListingTheme struct {
	Name   string            `json:"name" toml:"name"`
	Scheme string            `json:"scheme,omitempty" toml:"scheme"`
	Colors map[string]string `json:"colors,omitempty" toml:"colors"`
}

// DirectoryListingRequest is the optional body of PUT /listing/{bucket}. A
// nil Theme keeps the theme the pages already use.
type DirectoryListingRequest struct {
	Theme *DirectoryListingTheme `json:"theme" toml:"theme"`
}

// DirectoryListingSync describes one run that generated or refreshed the
// listing pages. Folders counts every folder that has a page (the root
// included); Unchanged pages were already up to date and were not rewritten;
// UserPages are folders skipped because they hold an index document this
// tool did not write; Unlisted counts keys whose names cannot be linked
// (empty, "." or ".." path segments). Partial is true when the run stopped
// at the per-run write cap, so a later run has more to do.
type DirectoryListingSync struct {
	At        time.Time `json:"at"`
	Folders   int       `json:"folders"`
	Objects   int       `json:"objects"`
	Written   int       `json:"written"`
	Unchanged int       `json:"unchanged"`
	Deleted   int       `json:"deleted"`
	UserPages int       `json:"userPages"`
	Unlisted  int       `json:"unlisted"`
	Partial   bool      `json:"partial"`
	Error     string    `json:"error,omitempty"`
}

// DirectoryListingRemoval is the answer to DELETE /listing/{bucket}.
type DirectoryListingRemoval struct {
	Deleted int `json:"deleted"`
}
