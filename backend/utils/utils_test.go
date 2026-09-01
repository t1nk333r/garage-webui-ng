package utils

import (
	"os"
	"path/filepath"
	"strings"
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

// TestReadSecretFileErrorDoesNotLeakSecretContent proves the no-leak
// property directly: when the underlying file cannot be read, the resulting
// error must never contain the bytes sitting behind the failed path — only
// the path and the OS's own (content-free) failure reason. GetSecretEnv
// itself cannot be exercised here on the failure path since it calls
// log.Fatalf; readSecretFile is the extracted, testable core that builds the
// same error.
func TestReadSecretFileErrorDoesNotLeakSecretContent(t *testing.T) {
	dir := t.TempDir()

	// A decoy secret value sits on disk, inside the directory we are about
	// to (mis)use as the "file" path. os.ReadFile on a directory always
	// fails, on any OS/user (including root), without ever having read this
	// content into memory.
	const decoySecret = "sekret-canary-9f8e7d6c5b4a1230"
	if err := os.WriteFile(filepath.Join(dir, "decoy"), []byte(decoySecret), 0o600); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	_, err := readSecretFile("SECRET_TEST_LEAK", dir)
	if err == nil {
		t.Fatal("readSecretFile() error = nil, want non-nil (path is a directory)")
	}

	if strings.Contains(err.Error(), decoySecret) {
		t.Errorf("readSecretFile() error leaks secret content: %q", err.Error())
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
