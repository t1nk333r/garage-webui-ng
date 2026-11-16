package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The proxy must forward exactly the path the auth middleware judged. main.go
// has already stripped the /api prefix by the time either sees the request, so
// a second strip in the proxy would let /api/v1/key (allowed for a viewer, as
// it is not under /v1/) reach Garage as /v1/key (which a viewer is refused).
func TestProxyForwardsThePathTheMiddlewareSaw(t *testing.T) {
	var got string
	adminServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Path
	}))
	defer adminServer.Close()
	t.Setenv("API_BASE_URL", adminServer.URL)

	for _, path := range []string{"/v2/GetClusterStatus", "/api/v1/key", "/api/v2/GetKeyInfo"} {
		got = ""
		ProxyHandler(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
		if got != path {
			t.Errorf("request for %q reached Garage as %q", path, got)
		}
	}
}
