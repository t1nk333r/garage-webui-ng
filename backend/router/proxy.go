package router

import (
	"fmt"
	"github.com/d7eeem/garage-webui-ng/utils"
	"net/http"
	"net/http/httputil"
	"net/url"
)

func ProxyHandler(w http.ResponseWriter, r *http.Request) {
	target, err := url.Parse(utils.Garage.GetAdminEndpoint())
	if err != nil {
		utils.ResponseError(w, err)
		return
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			// main.go has already stripped /api, so the path forwarded is the
			// one AuthMiddleware judged. Stripping again here would let a
			// viewer reach /v1/... by asking for /api/v1/...
			r.SetURL(target)
			r.Out.Header.Set("Authorization", fmt.Sprintf("Bearer %s", utils.Garage.GetAdminKey()))
		},
	}

	proxy.ServeHTTP(w, r)
}
