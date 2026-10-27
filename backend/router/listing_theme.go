package router

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"regexp"
	"strings"

	"github.com/d7eeem/garage-webui-ng/schema"
)

// Directory-listing pages can take their colors from one of the web UI's
// themes. The backend does not know the themes: daisyUI derives most of a
// theme's surfaces when the stylesheet is built, so the browser reads the
// theme's resolved CSS variables and sends them with PUT /listing. They are
// checked against a strict shape here, rendered into each page's stylesheet,
// and stored with every page as S3 metadata. A refresh that is not given a
// theme reads it back off the root page, so background runs keep it.

// listingThemeKey is the S3 user-metadata key holding a page's theme.
const listingThemeKey = "garage-webui-ng-theme"

// listingThemeColors are the daisyUI variables a page uses: the three base
// surfaces, the text on them, and the primary accent.
var listingThemeColors = []string{"b1", "b2", "b3", "bc", "p"}

var (
	listingThemeName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	// daisyUI 4 declares each theme color as an OKLCH triple, "L% C H".
	// Nothing else may reach the stylesheet.
	listingThemeOKLCH = regexp.MustCompile(`^\d{1,3}(\.\d{1,8})?% \d{1,3}(\.\d{1,8})? \d{1,3}(\.\d{1,8})?$`)
)

var errListingTheme = errors.New("invalid listing theme")

// normalizeListingTheme validates t and returns it in canonical form. An
// empty name is the built-in palette, which carries no colors.
func normalizeListingTheme(t schema.DirectoryListingTheme) (schema.DirectoryListingTheme, error) {
	if t.Name == "" {
		return schema.DirectoryListingTheme{}, nil
	}
	if !listingThemeName.MatchString(t.Name) {
		return schema.DirectoryListingTheme{}, fmt.Errorf("%w: name %q", errListingTheme, t.Name)
	}
	if t.Scheme != "light" && t.Scheme != "dark" {
		return schema.DirectoryListingTheme{}, fmt.Errorf("%w: scheme must be light or dark", errListingTheme)
	}
	if len(t.Colors) != len(listingThemeColors) {
		return schema.DirectoryListingTheme{}, fmt.Errorf("%w: want colors %s", errListingTheme, strings.Join(listingThemeColors, ", "))
	}
	colors := make(map[string]string, len(listingThemeColors))
	for _, k := range listingThemeColors {
		// The browser reports a custom property with its leading space.
		v := strings.Join(strings.Fields(t.Colors[k]), " ")
		if !listingThemeOKLCH.MatchString(v) {
			return schema.DirectoryListingTheme{}, fmt.Errorf("%w: color %s is not an OKLCH triple", errListingTheme, k)
		}
		colors[k] = v
	}
	return schema.DirectoryListingTheme{Name: t.Name, Scheme: t.Scheme, Colors: colors}, nil
}

// encodeListingTheme is the metadata value for t, or "" for the built-in
// palette. json.Marshal sorts map keys, so a theme always encodes the same.
func encodeListingTheme(t schema.DirectoryListingTheme) string {
	if t.Name == "" {
		return ""
	}
	b, err := json.Marshal(t)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// listingThemeFromMeta reads a page's theme from its metadata. A missing or
// unreadable one is the built-in palette: pages written before themes
// existed carry none.
func listingThemeFromMeta(meta map[string]string) schema.DirectoryListingTheme {
	for k, v := range meta {
		if !strings.EqualFold(k, listingThemeKey) {
			continue
		}
		raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(v))
		if err != nil {
			break
		}
		var t schema.DirectoryListingTheme
		if json.Unmarshal(raw, &t) != nil {
			break
		}
		if t, err = normalizeListingTheme(t); err == nil {
			return t
		}
		break
	}
	return schema.DirectoryListingTheme{}
}

// listingDefaultThemeCSS is the built-in palette. It follows the visitor's
// own light or dark preference.
const listingDefaultThemeCSS = `:root{color-scheme:light dark;--fg:#1f2328;--muted:#59636e;--bg:#fff;--line:#d1d9e0;--link:#0969da;--hover:#f6f8fa;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#9198a1;--bg:#0d1117;--line:#30363d;--link:#4493f8;--hover:#151b23;--accent:#4493f8}}`

// listingThemeCSS is the :root rule for t, the one part of the stylesheet
// that varies. It mirrors how the web UI's object browser looks: names in
// the theme's text color, folders in its primary color. A web UI theme has
// a single fixed scheme. The theme is validated again here because the
// result bypasses html/template's escaping.
func listingThemeCSS(t schema.DirectoryListingTheme) template.CSS {
	t, err := normalizeListingTheme(t)
	if err != nil || t.Name == "" {
		return template.CSS(listingDefaultThemeCSS)
	}
	color := func(k string) string { return "oklch(" + t.Colors[k] + ")" }
	return template.CSS(":root{color-scheme:" + t.Scheme +
		";--fg:" + color("bc") +
		";--muted:oklch(" + t.Colors["bc"] + " / .6)" +
		";--bg:" + color("b1") +
		";--line:" + color("b3") +
		";--link:" + color("bc") +
		";--hover:" + color("b2") +
		";--accent:" + color("p") + "}")
}
