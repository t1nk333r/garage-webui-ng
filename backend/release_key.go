package main

// releasePublicKey is the hex-encoded ed25519 public key that release
// artifacts are signed with. The matching private key lives only in the
// Jenkins secret-text credential relsign-key (bound to RELEASE_SIGNING_KEY by
// the Jenkinsfile) and must never appear here or anywhere else in this tree.
//
// EMPTY MEANS UNCONFIGURED, AND UNCONFIGURED MUST FAIL CLOSED: any feature that
// installs a downloaded artifact has to refuse to run when this is empty,
// rather than falling back to "no verification". See plan 050.
//
// To configure: run `go run ./cmd/relsign keygen`, put the private key in the
// relsign-key credential, and paste the public key here.
//
// ROTATING THIS BREAKS SELF-UPDATE ACROSS THE ROTATION: an installed binary
// verifies downloads against the key compiled into it, so builds carrying the
// previous key will refuse a release signed with this one. That refusal is
// correct — see the rotation note in README.md.
var releasePublicKey = "5f1bc748088ce26f8b75bcf4a9b28724397a0a1006963b8c5733b452ce948f31"

// ReleasePublicKey returns the configured release-signing public key, or "" if
// this build has none.
func ReleasePublicKey() string { return releasePublicKey }
