package router

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"strings"
	"testing"

	"github.com/d7eeem/garage-webui-ng/schema"
)

// nordTheme is what the web UI sends for its nord theme: daisyUI's compiled
// variables, each with the leading space the browser reports.
func nordTheme() schema.DirectoryListingTheme {
	return schema.DirectoryListingTheme{
		Name:   "nord",
		Scheme: "light",
		Colors: map[string]string{
			"b1": " 95.1276% 0.007445 260.731539",
			"b2": " 93.2996% 0.010389 261.788485",
			"b3": " 89.9258% 0.016374 262.749256",
			"bc": " 32.4374% 0.022945 264.182036",
			"p":  " 59.4359% 0.077246 254.027774",
		},
	}
}

func themeBody(t *testing.T, theme schema.DirectoryListingTheme) string {
	t.Helper()
	b, err := json.Marshal(schema.DirectoryListingRequest{Theme: &theme})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestNormalizeListingTheme(t *testing.T) {
	got, err := normalizeListingTheme(nordTheme())
	if err != nil {
		t.Fatalf("nord: %v", err)
	}
	if got.Colors["b1"] != "95.1276% 0.007445 260.731539" {
		t.Errorf("b1 = %q, want it trimmed", got.Colors["b1"])
	}

	// dark-pastel as a production build reports it: the minified stylesheet
	// has no leading zeros.
	minified := nordTheme()
	minified.Colors = maps.Clone(minified.Colors)
	minified.Colors["b1"] = " 27.8808% .035341 276.936817"
	minified.Colors["p"] = " .5% .1 49.637597"
	got, err = normalizeListingTheme(minified)
	if err != nil {
		t.Fatalf("minified: %v", err)
	}
	if got.Colors["b1"] != "27.8808% 0.035341 276.936817" || got.Colors["p"] != "0.5% 0.1 49.637597" {
		t.Errorf("minified colors = %q, %q; want leading zeros restored", got.Colors["b1"], got.Colors["p"])
	}

	got, err = normalizeListingTheme(schema.DirectoryListingTheme{Name: "", Scheme: "dark", Colors: map[string]string{"b1": "x"}})
	if err != nil || got.Name != "" || got.Scheme != "" || got.Colors != nil {
		t.Errorf("empty name = %+v, %v; want the bare built-in palette", got, err)
	}

	bad := map[string]func(*schema.DirectoryListingTheme){
		"upper-case name":      func(t *schema.DirectoryListingTheme) { t.Name = "Nord" },
		"name with a quote":    func(t *schema.DirectoryListingTheme) { t.Name = `nord"x` },
		"unknown scheme":       func(t *schema.DirectoryListingTheme) { t.Scheme = "sepia" },
		"missing color":        func(t *schema.DirectoryListingTheme) { delete(t.Colors, "p") },
		"extra color":          func(t *schema.DirectoryListingTheme) { t.Colors["s"] = "50% 0.1 10" },
		"wrong color replaced": func(t *schema.DirectoryListingTheme) { delete(t.Colors, "p"); t.Colors["s"] = "50% 0.1 10" },
		"rule break-out":       func(t *schema.DirectoryListingTheme) { t.Colors["b1"] = "1% 0 0);}body{display:none" },
		"style end":            func(t *schema.DirectoryListingTheme) { t.Colors["bc"] = "1% 0 0</style>" },
		"css function":         func(t *schema.DirectoryListingTheme) { t.Colors["p"] = "var(--x)" },
		"hex color":            func(t *schema.DirectoryListingTheme) { t.Colors["p"] = "#5e81ac" },
		"bare dot":             func(t *schema.DirectoryListingTheme) { t.Colors["p"] = ".% . ." },
	}
	for name, mutate := range bad {
		theme := nordTheme()
		theme.Colors = maps.Clone(theme.Colors)
		mutate(&theme)
		if _, err := normalizeListingTheme(theme); !errors.Is(err, errListingTheme) {
			t.Errorf("%s: err = %v, want errListingTheme", name, err)
		}
		// listingThemeCSS bypasses html/template's escaping, so it must not
		// trust its input either.
		if css := string(listingThemeCSS(theme)); css != listingDefaultThemeCSS {
			t.Errorf("%s: listingThemeCSS = %q, want the built-in palette", name, css)
		}
	}
}

func TestListingThemeIsAppliedAndKept(t *testing.T) {
	const bucket = "listing-theme"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")

	rec := serveListingBody(t, http.MethodPut, bucket, themeBody(t, nordTheme()))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT with a theme = %d: %s", rec.Code, rec.Body.String())
	}
	root := assertGenerated(t, f, "index.html")
	for _, want := range []string{
		`<html lang="en" data-theme="nord">`,
		`:root{color-scheme:light;--fg:oklch(32.4374% 0.022945 264.182036);`,
		`--bg:oklch(95.1276% 0.007445 260.731539);`,
		`--accent:oklch(59.4359% 0.077246 254.027774)}`,
	} {
		if !strings.Contains(root, want) {
			t.Errorf("themed root page lacks %s", want)
		}
	}
	if strings.Contains(root, "prefers-color-scheme") {
		t.Error("a themed page still follows the visitor's light/dark preference")
	}
	if got := listingStatus(t, bucket).Theme; got != "nord" {
		t.Errorf("status theme = %q, want nord", got)
	}

	// A refresh from the UI sends no theme, and the background refresher
	// never has one: both keep what the root page carries.
	f.PutTestObject("new/b.txt", "b", "text/plain")
	mustListing(t, http.MethodPut, bucket, http.StatusOK)
	f.PutTestObject("later/c.txt", "c", "text/plain")
	client, err := getS3Client(bucket)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := syncListing(context.Background(), client, bucket, "index.html", listingUpdate, nil); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"index.html", "new/index.html", "later/index.html"} {
		page := assertGenerated(t, f, key)
		if !strings.Contains(page, `data-theme="nord"`) {
			t.Errorf("%s lost the theme on refresh", key)
		}
		if obj, _ := f.Object(key); listingThemeFromMeta(obj.metadata).Name != "nord" {
			t.Errorf("%s metadata %v does not carry the theme", key, obj.metadata)
		}
	}
}

func TestListingThemeChangeRewritesEveryPage(t *testing.T) {
	const bucket = "listing-theme-change"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")
	f.PutTestObject("hp/b.txt", "b", "text/plain")

	if rec := serveListingBody(t, http.MethodPut, bucket, themeBody(t, nordTheme())); rec.Code != http.StatusOK {
		t.Fatalf("PUT nord = %d: %s", rec.Code, rec.Body.String())
	}

	rec := serveListingBody(t, http.MethodPut, bucket, `{"theme":{"name":""}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT built-in = %d: %s", rec.Code, rec.Body.String())
	}
	var sync schema.DirectoryListingSync
	if err := json.Unmarshal(rec.Body.Bytes(), &sync); err != nil {
		t.Fatal(err)
	}
	if sync.Written != 2 || sync.Unchanged != 0 {
		t.Errorf("sync = %+v, want both pages rewritten", sync)
	}
	for _, key := range []string{"index.html", "hp/index.html"} {
		page := assertGenerated(t, f, key)
		if strings.Contains(page, "data-theme") || !strings.Contains(page, "prefers-color-scheme") {
			t.Errorf("%s did not go back to the built-in palette", key)
		}
		if obj, _ := f.Object(key); obj.metadata[listingThemeKey] != "" {
			t.Errorf("%s still carries theme metadata %v", key, obj.metadata)
		}
	}
	if got := listingStatus(t, bucket).Theme; got != "" {
		t.Errorf("status theme = %q, want the built-in palette", got)
	}
}

func TestListingRejectsAnInvalidTheme(t *testing.T) {
	const bucket = "listing-theme-invalid"
	f := newListingFixture(t, bucket)
	f.PutTestObject("a.txt", "a", "text/plain")

	theme := nordTheme()
	theme.Colors["b1"] = "1% 0 0);}body{display:none"
	for _, body := range []string{themeBody(t, theme), `{"theme":`, `{"theme":"nord"}`} {
		rec := serveListingBody(t, http.MethodPut, bucket, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("PUT %s = %d, want 400", body, rec.Code)
		}
	}
	if n := countS3(f, http.MethodPut, nil); n != 0 {
		t.Errorf("an invalid theme still wrote %d objects", n)
	}
}
