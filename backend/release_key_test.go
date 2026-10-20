package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"regexp"
	"testing"
)

// TestReleasePublicKey is a trivial accessor test: it catches ReleasePublicKey
// being wired to the wrong variable, or hardcoded, rather than returning
// whatever releasePublicKey currently holds.
func TestReleasePublicKey(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "empty (unconfigured)", value: ""},
		{name: "non-empty value returned verbatim", value: "deadbeef"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := releasePublicKey
			releasePublicKey = tt.value
			t.Cleanup(func() { releasePublicKey = original })

			if got := ReleasePublicKey(); got != tt.value {
				t.Errorf("ReleasePublicKey() = %q, want %q", got, tt.value)
			}
		})
	}
}

// TestReleasePublicKeyShape asserts that IF a real key is committed, it
// decodes as hex to exactly ed25519.PublicKeySize bytes. It is a no-op (via
// t.Skip) for the shipped empty value, and becomes meaningful the moment a
// real public key lands in release_key.go.
func TestReleasePublicKeyShape(t *testing.T) {
	if releasePublicKey == "" {
		t.Skip("releasePublicKey is unconfigured (empty) — nothing to validate yet")
	}

	b, err := hex.DecodeString(releasePublicKey)
	if err != nil {
		t.Fatalf("releasePublicKey is not valid hex: %v", err)
	}
	if len(b) != ed25519.PublicKeySize {
		t.Fatalf("releasePublicKey decodes to %d bytes, want %d (ed25519.PublicKeySize)", len(b), ed25519.PublicKeySize)
	}
}

// TestUpdateScriptPublicKey keeps contrib/garage-update in lockstep with the
// compiled-in key. That script verifies release signatures on its own, with no
// Go binary involved, so a rotated key that is not copied there would make
// every scripted update refuse a genuine release.
func TestUpdateScriptPublicKey(t *testing.T) {
	const path = "../contrib/garage-update/garage-update"
	script, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		t.Skip(path + " is not part of this checkout")
	}
	if err != nil {
		t.Fatal(err)
	}

	m := regexp.MustCompile(`(?m)^WEBUI_PUBKEY=([0-9a-fA-F]*)$`).FindSubmatch(script)
	if m == nil {
		t.Fatalf("%s has no WEBUI_PUBKEY= line", path)
	}
	if got := string(m[1]); got != releasePublicKey {
		t.Errorf("WEBUI_PUBKEY in %s is %q; release_key.go has %q", path, got, releasePublicKey)
	}
}
