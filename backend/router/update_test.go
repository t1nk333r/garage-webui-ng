package router

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/d7eeem/garage-webui-ng/utils"
)

func TestIsNewer(t *testing.T) {
	tests := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "equal", current: "3.3.0", latest: "3.3.0", want: false},
		{name: "patch bump", current: "3.3.0", latest: "3.4.0", want: true},
		{name: "current ahead", current: "3.4.0", latest: "3.3.0", want: false},
		{name: "v prefix on latest", current: "3.3.0", latest: "v3.4.0", want: true},
		{name: "v prefix on current", current: "v3.3.0", latest: "3.4.0", want: true},
		{name: "v prefix on both, equal", current: "v3.3.0", latest: "v3.3.0", want: false},
		{name: "missing patch component", current: "3.3", latest: "3.3.0", want: false},
		{name: "current is dev", current: "dev", latest: "3.3.0", want: false},
		{name: "latest is dev", current: "3.3.0", latest: "dev", want: false},
		{name: "latest has pre-release suffix", current: "3.3.0", latest: "3.3.0-rc1", want: false},
		{name: "empty current", current: "", latest: "3.3.0", want: false},
		{name: "empty latest", current: "3.3.0", latest: "", want: false},
		// The string-compare trap: "3.10.0" < "3.9.0" lexicographically, but
		// numerically 3.10.0 is newer. This is why isNewer must not just
		// string-compare.
		{name: "double-digit minor beats single-digit minor", current: "3.9.0", latest: "3.10.0", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isNewer(tt.current, tt.latest); got != tt.want {
				t.Errorf("isNewer(%q, %q) = %v, want %v", tt.current, tt.latest, got, tt.want)
			}
		})
	}
}

func TestUpdateGetDisabled(t *testing.T) {
	utils.InitCacheManager()
	t.Setenv("UPDATE_CHECK_ENABLED", "")

	originalAppVersion := AppVersion
	AppVersion = "3.3.0"
	t.Cleanup(func() { AppVersion = originalAppVersion })

	req := httptest.NewRequest(http.MethodGet, "/update-check", nil)
	w := httptest.NewRecorder()

	(&Update{}).Get(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var got UpdateCheck
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got.Enabled {
		t.Errorf("expected enabled=false, got true")
	}
	if got.Current != "3.3.0" {
		t.Errorf("current = %q, want %q", got.Current, "3.3.0")
	}
}

func TestUpdateGetEnabledNewerTag(t *testing.T) {
	utils.InitCacheManager()
	t.Setenv("UPDATE_CHECK_ENABLED", "true")

	originalAppVersion := AppVersion
	AppVersion = "3.3.0"
	t.Cleanup(func() { AppVersion = originalAppVersion })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(githubRelease{
			TagName: "v3.4.0",
			HTMLURL: "https://github.com/t1nk333r/garage-webui-ng/releases/tag/v3.4.0",
		})
	}))
	defer server.Close()

	originalURL := releasesURL
	releasesURL = server.URL
	t.Cleanup(func() { releasesURL = originalURL })

	req := httptest.NewRequest(http.MethodGet, "/update-check", nil)
	w := httptest.NewRecorder()

	(&Update{}).Get(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var got UpdateCheck
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !got.Enabled {
		t.Errorf("expected enabled=true, got false")
	}
	if !got.UpdateAvailable {
		t.Errorf("expected updateAvailable=true, got false")
	}
	if got.Latest != "v3.4.0" {
		t.Errorf("latest = %q, want %q", got.Latest, "v3.4.0")
	}
	if got.CheckFailed {
		t.Errorf("expected checkFailed=false, got true")
	}
}

func TestUpdateGetEnabledUpstreamFailure(t *testing.T) {
	utils.InitCacheManager()
	t.Setenv("UPDATE_CHECK_ENABLED", "true")

	originalAppVersion := AppVersion
	AppVersion = "3.3.0"
	t.Cleanup(func() { AppVersion = originalAppVersion })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("upstream is down, sensitive details here"))
	}))
	defer server.Close()

	originalURL := releasesURL
	releasesURL = server.URL
	t.Cleanup(func() { releasesURL = originalURL })

	req := httptest.NewRequest(http.MethodGet, "/update-check", nil)
	w := httptest.NewRecorder()

	(&Update{}).Get(w, req)

	// A failed upstream must never surface as a 5xx to the caller — it
	// degrades quietly.
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	body := w.Body.String()
	if strings.Contains(body, "upstream is down") {
		t.Errorf("response leaked upstream body: %s", body)
	}

	var got UpdateCheck
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !got.CheckFailed {
		t.Errorf("expected checkFailed=true, got false")
	}
	if !got.Enabled {
		t.Errorf("expected enabled=true, got false")
	}
}

func TestClassifyOpenResult(t *testing.T) {
	tests := []struct {
		name          string
		execErr       error
		openErr       error
		systemService bool
		want          DeploymentKind
	}{
		{name: "executable path unknown", execErr: errors.New("boom"), want: deploymentUnknown},
		{name: "executable path unknown under systemd", execErr: errors.New("boom"), systemService: true, want: deploymentUnknown},
		{name: "writable executable", want: deploymentBinary},
		{name: "writable executable under systemd", systemService: true, want: deploymentBinary},
		{name: "permission denied", openErr: fs.ErrPermission, want: deploymentManaged},
		{name: "other open error fails safe to managed", openErr: errors.New("read-only file system"), want: deploymentManaged},
		// ProtectSystem=strict: a root process that still cannot write its
		// binary, started by systemd.
		{name: "read-only executable under systemd", openErr: errors.New("read-only file system"), systemService: true, want: deploymentService},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyOpenResult(tt.execErr, tt.openErr, tt.systemService); got != tt.want {
				t.Errorf("classifyOpenResult(%v, %v, %v) = %v, want %v", tt.execErr, tt.openErr, tt.systemService, got, tt.want)
			}
		})
	}
}

func TestServiceFromCgroup(t *testing.T) {
	tests := []struct {
		name   string
		cgroup string
		want   string
	}{
		{name: "unified system service", cgroup: "0::/system.slice/garage-webui.service\n", want: "garage-webui.service"},
		{name: "service in a custom slice", cgroup: "0::/storage.slice/garage-webui.service\n", want: "garage-webui.service"},
		{name: "delegated subgroup names its unit", cgroup: "0::/system.slice/garage-webui.service/payload\n", want: "garage-webui.service"},
		{name: "legacy hierarchy", cgroup: "12:pids:/system.slice/garage-webui.service\n1:name=systemd:/system.slice/garage-webui.service\n", want: "garage-webui.service"},
		{name: "escaped unit name", cgroup: "0::/system.slice/garage\\x2dwebui.service\n", want: `garage\x2dwebui.service`},
		{name: "container with a cgroup namespace", cgroup: "0::/\n", want: ""},
		{name: "docker scope on the host hierarchy", cgroup: "0::/system.slice/docker-0123abcd.scope\n", want: ""},
		{name: "user manager service", cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/garage-webui.service\n", want: ""},
		{name: "legacy controller line only", cgroup: "12:pids:/system.slice/garage-webui.service\n", want: ""},
		{name: "bare suffix", cgroup: "0::/system.slice/.service\n", want: ""},
		{name: "empty", cgroup: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := serviceFromCgroup(tt.cgroup); got != tt.want {
				t.Errorf("serviceFromCgroup(%q) = %q, want %q", tt.cgroup, got, tt.want)
			}
		})
	}
}

func TestSystemdUnitNeedsInvocationID(t *testing.T) {
	// Whatever this test process's cgroup says, a process systemd did not
	// start has no INVOCATION_ID and must not claim a unit.
	t.Setenv("INVOCATION_ID", "")
	if got := systemdUnit(); got != "" {
		t.Errorf("systemdUnit() = %q without INVOCATION_ID, want \"\"", got)
	}
}

func TestUpdateCommandFor(t *testing.T) {
	tests := []struct {
		name string
		d    deployment
		want string
	}{
		// managed covers a container and anything else we could not
		// identify — setups with no shared update command. Guessing one
		// (e.g. "docker compose pull") would mis-advise the others, so this
		// must be exactly "".
		{name: "managed", d: deployment{Kind: deploymentManaged, Executable: "/app/garage-webui-ng"}, want: ""},
		{name: "unknown", d: deployment{Kind: deploymentUnknown}, want: ""},
		{
			name: "service names its unit and executable",
			d:    deployment{Kind: deploymentService, Unit: "garage-webui.service", Executable: "/usr/local/bin/garage-webui-ng"},
			want: "sudo systemctl stop garage-webui.service && sudo install -m 0755 ./garage-webui-ng /usr/local/bin/garage-webui-ng && sudo systemctl start garage-webui.service",
		},
		{
			name: "service quotes what the shell would alter",
			d:    deployment{Kind: deploymentService, Unit: `garage\x2dwebui.service`, Executable: "/opt/garage webui/garage-webui-ng"},
			want: `sudo systemctl stop 'garage\x2dwebui.service' && sudo install -m 0755 ./garage-webui-ng '/opt/garage webui/garage-webui-ng' && sudo systemctl start 'garage\x2dwebui.service'`,
		},
		{
			name: "binary outside systemd keeps the documented unit",
			d:    deployment{Kind: deploymentBinary, Executable: "/srv/bin/garage-webui-ng"},
			want: "sudo systemctl stop garage-webui && sudo install -m 0755 ./garage-webui-ng /srv/bin/garage-webui-ng && sudo systemctl start garage-webui",
		},
		{
			name: "binary with nothing detected uses the documented defaults",
			d:    deployment{Kind: deploymentBinary},
			want: "sudo systemctl stop garage-webui && sudo install -m 0755 ./garage-webui-ng /usr/local/bin/garage-webui-ng && sudo systemctl start garage-webui",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := updateCommandFor(tt.d)
			if got != tt.want {
				t.Errorf("updateCommandFor(%+v) =\n  %q\nwant\n  %q", tt.d, got, tt.want)
			}
			if strings.Contains(got, "\n") {
				t.Errorf("updateCommandFor(%+v) = %q, contains a newline; the UI copies it as one line", tt.d, got)
			}
		})
	}

	// Regression guard: managed must never carry a container-specific
	// example, even if the equality check above is weakened by a future edit.
	t.Run("managed never suggests docker", func(t *testing.T) {
		got := updateCommandFor(deployment{Kind: deploymentManaged})
		if strings.Contains(got, "docker") {
			t.Errorf("updateCommandFor(managed) = %q, contains %q; managed covers setups with no docker compose file, so this command would mis-advise them", got, "docker")
		}
	})
}

func TestShellQuote(t *testing.T) {
	tests := map[string]string{
		"garage-webui.service":           "garage-webui.service",
		"/usr/local/bin/garage-webui-ng": "/usr/local/bin/garage-webui-ng",
		"a b":                            "'a b'",
		`a\x2db`:                         `'a\x2db'`,
		"it's":                           `'it'\''s'`,
		"$(rm -rf /)":                    "'$(rm -rf /)'",
		"":                               "''",
	}
	for in, want := range tests {
		if got := shellQuote(in); got != want {
			t.Errorf("shellQuote(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDeploymentFieldsAreSetWhenDisabled(t *testing.T) {
	utils.InitCacheManager()
	t.Setenv("UPDATE_CHECK_ENABLED", "")

	originalAppVersion := AppVersion
	AppVersion = "3.3.0"
	t.Cleanup(func() { AppVersion = originalAppVersion })

	req := httptest.NewRequest(http.MethodGet, "/update-check", nil)
	w := httptest.NewRecorder()

	(&Update{}).Get(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var got UpdateCheck
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got.Enabled {
		t.Errorf("expected enabled=false, got true")
	}
	if got.Deployment == "" {
		t.Errorf("expected a non-empty deployment kind even when update checks are disabled, got %q", got.Deployment)
	}
}
