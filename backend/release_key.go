package main

// releasePublicKey is the hex-encoded ed25519 public key that release
// artifacts are signed with. The matching private key lives only in the
// GitHub Actions repository secret RELEASE_SIGNING_KEY (read by the release
// job in .github/workflows/ci.yml) and must never appear here or anywhere else
// in this tree.
//
// EMPTY MEANS UNCONFIGURED, AND UNCONFIGURED MUST FAIL CLOSED: any feature that
// installs a downloaded artifact has to refuse to run when this is empty,
// rather than falling back to "no verification". See plan 050.
//
// To configure: run `go run ./cmd/relsign keygen`, put the private key in the
// RELEASE_SIGNING_KEY secret, and paste the public key here.
//
// ROTATING THIS BREAKS SELF-UPDATE ACROSS THE ROTATION: an installed binary
// verifies downloads against the key compiled into it, so builds carrying the
// previous key will refuse a release signed with this one. That refusal is
// correct — see the rotation note in README.md.
var releasePublicKey = "583b78627fef1679b5844a39aefa9556cf61903f1b45949f54e8b7ff89f7f513"

// ReleasePublicKey returns the configured release-signing public key, or "" if
// this build has none.
func ReleasePublicKey() string { return releasePublicKey }
