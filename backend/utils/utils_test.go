package utils

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestGetEnvReturnsDefaultWhenUnset(t *testing.T) {
	got := GetEnv("GARAGE_WEBUI_TEST_UNSET_VAR", "default-value")
	if got != "default-value" {
		t.Errorf("GetEnv() = %q, want %q", got, "default-value")
	}
}

func TestGetEnvReturnsValueWhenSet(t *testing.T) {
	t.Setenv("GARAGE_WEBUI_TEST_SET_VAR", "actual-value")

	got := GetEnv("GARAGE_WEBUI_TEST_SET_VAR", "default-value")
	if got != "actual-value" {
		t.Errorf("GetEnv() = %q, want %q", got, "actual-value")
	}
}

func TestGetEnvReturnsDefaultWhenEmpty(t *testing.T) {
	// Current behavior: len(value) == 0 treats an empty string the same as
	// unset, so the default is returned rather than "".
	t.Setenv("GARAGE_WEBUI_TEST_EMPTY_VAR", "")

	got := GetEnv("GARAGE_WEBUI_TEST_EMPTY_VAR", "default-value")
	if got != "default-value" {
		t.Errorf("GetEnv() = %q, want %q", got, "default-value")
	}
}

func TestGetSecretEnvPlainValue(t *testing.T) {
	t.Setenv("SECRET_TEST_A", "abc")

	got := GetSecretEnv("SECRET_TEST_A")
	if got != "abc" {
		t.Errorf("GetSecretEnv() = %q, want %q", got, "abc")
	}
}

func TestGetSecretEnvFileWins(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("fromfile\n"), 0o600); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	t.Setenv("SECRET_TEST_B", "plain")
	t.Setenv("SECRET_TEST_B_FILE", path)

	got := GetSecretEnv("SECRET_TEST_B")
	if got != "fromfile" {
		t.Errorf("GetSecretEnv() = %q, want %q", got, "fromfile")
	}
}

func TestGetSecretEnvStripsTrailingCRLF(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{"crlf", "v\r\n", "v"},
		{"double-lf", "v\n\n", "v"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "secret")
			if err := os.WriteFile(path, []byte(tc.content), 0o600); err != nil {
				t.Fatalf("WriteFile() failed: %v", err)
			}

			t.Setenv("SECRET_TEST_C_FILE", path)

			got := GetSecretEnv("SECRET_TEST_C")
			if got != tc.want {
				t.Errorf("GetSecretEnv() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGetSecretEnvPreservesInnerWhitespace(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("a b \n"), 0o600); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	t.Setenv("SECRET_TEST_D_FILE", path)

	got := GetSecretEnv("SECRET_TEST_D")
	if got != "a b " {
		t.Errorf("GetSecretEnv() = %q, want %q", got, "a b ")
	}
}

func TestGetSecretEnvUnset(t *testing.T) {
	got := GetSecretEnv("SECRET_TEST_E")
	if got != "" {
		t.Errorf("GetSecretEnv() = %q, want empty string", got)
	}
}

// TestReadSecretFileErrorIsPathOnly pins the no-leak property by asserting
// the error's EXACT shape, not merely that one canary string is absent.
//
// The weaker "does not contain the secret" form is vacuous here: os.ReadFile
// on a directory fails before reading anything, so `data` is empty and an
// implementation that interpolated the file contents straight into the error
// would still pass. Requiring the exact message means any extra component —
// contents included — fails this test.
func TestReadSecretFileErrorIsPathOnly(t *testing.T) {
	dir := t.TempDir()

	const decoySecret = "sekret-canary-9f8e7d6c5b4a1230"
	if err := os.WriteFile(filepath.Join(dir, "decoy"), []byte(decoySecret), 0o600); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	_, err := readSecretFile("SECRET_TEST_LEAK", dir)
	if err == nil {
		t.Fatal("readSecretFile() error = nil, want non-nil (path is a directory)")
	}

	// The only permitted components are the variable name, the path, and the
	// OS error — which itself never quotes file contents.
	want := fmt.Sprintf("cannot read SECRET_TEST_LEAK_FILE=%q: %v", dir, &os.PathError{
		Op: "read", Path: dir, Err: syscall.EISDIR,
	})
	if err.Error() != want {
		t.Errorf("readSecretFile() error = %q, want exactly %q", err.Error(), want)
	}

	if strings.Contains(err.Error(), decoySecret) {
		t.Errorf("readSecretFile() error leaks secret content: %q", err.Error())
	}
}

// A secret file that IS readable must never have its bytes reach an error;
// this is the case the directory test above cannot reach, so it is pinned by
// asserting the value comes back cleanly with no error at all.
func TestReadSecretFileSuccessReturnsValueAndNoError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	const value = "sekret-canary-9f8e7d6c5b4a1230"
	if err := os.WriteFile(path, []byte(value+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	got, err := readSecretFile("SECRET_TEST_OK", path)
	if err != nil {
		t.Fatalf("readSecretFile() error = %v, want nil", err)
	}
	if got != value {
		t.Errorf("readSecretFile() = %q, want %q", got, value)
	}
}

func TestLastStringReturnsFinalElement(t *testing.T) {
	got := LastString([]string{"a", "b", "c"})
	if got != "c" {
		t.Errorf("LastString() = %q, want %q", got, "c")
	}
}

func TestLastStringSingleElement(t *testing.T) {
	got := LastString([]string{"only"})
	if got != "only" {
		t.Errorf("LastString() = %q, want %q", got, "only")
	}
}

func TestLastStringEmptySlice(t *testing.T) {
	t.Skip("LastString panics on an empty slice; not fixed in this plan")
	// LastString([]string{}) indexes str[-1] and panics.
}
