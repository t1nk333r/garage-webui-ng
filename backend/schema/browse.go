package schema

import "time"

type BrowseObjectResult struct {
	Prefixes  []string        `json:"prefixes"`
	Objects   []BrowserObject `json:"objects"`
	Prefix    string          `json:"prefix"`
	NextToken *string         `json:"nextToken"`
}

type BrowserObject struct {
	ObjectKey    *string    `json:"objectKey"`
	LastModified *time.Time `json:"lastModified"`
	Size         *int64     `json:"size"`
	Url          string     `json:"url"`
}

// SearchObjectsResult is the answer to GET /search/{bucket}. Truncated is true
// when the walk stopped before the end of the listing — either the match cap
// or the scan cap was hit — so the UI can say "there may be more".
type SearchObjectsResult struct {
	Objects   []BrowserObject `json:"objects"`
	Prefix    string          `json:"prefix"`
	Query     string          `json:"query"`
	Scanned   int             `json:"scanned"`
	Truncated bool            `json:"truncated"`
	Reason    string          `json:"reason,omitempty"` // "matches" | "scan" when truncated
}
