// Jenkins port of .github/workflows/ci.yml + docker-publish.yml.
// Release (signed binaries + versioned image tags) runs on v* tags — see the Release: stages.
// Toolchain versions (Node 20, Go 1.25.13) are baked into the agent image;
// pnpm resolves from package.json's "packageManager" via corepack.
// Publish runs only on main: multi-arch (amd64+arm64) buildx push to GHCR
// using the `github-pat` credential. The Dockerfile's build stages
// cross-compile and never run under emulation; binfmt is installed only for
// the tiny per-platform runtime stage, on demand.
pipeline {
  agent { label 'docker' }

  options {
    disableConcurrentBuilds(abortPrevious: true)
  }

  stages {
    stage('Frontend: install') {
      steps {
        sh 'pnpm install --frozen-lockfile'
      }
    }

    // Non-blocking: a pre-existing lint backlog (mostly @typescript-eslint/
    // no-explicit-any) is tracked separately. Lint still runs so violations
    // stay visible; drop catchError once `pnpm run lint` exits 0.
    stage('Frontend: lint (non-blocking)') {
      steps {
        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
          sh 'pnpm run lint'
        }
      }
    }

    stage('Frontend: typecheck · test · build') {
      steps {
        sh 'pnpm run typecheck'
        sh 'pnpm run test'
        sh 'pnpm run build'
      }
    }

    stage('Backend: build · vet · fmt · test') {
      steps {
        dir('backend') {
          sh 'go build ./...'
          sh 'go vet ./...'
          sh 'test -z "$(gofmt -l .)"'
          sh 'go test -race ./...'
        }
      }
    }

    // govulncheck reports stdlib advisories against the toolchain it runs
    // under — the agent image pins the same Go patch the backend builds with.
    stage('Security: govulncheck') {
      steps {
        dir('backend') {
          sh '''
            go install golang.org/x/vuln/cmd/govulncheck@latest
            "$(go env GOPATH)/bin/govulncheck" ./...
          '''
        }
      }
    }

    stage('Security: pnpm audit (advisory)') {
      steps {
        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
          sh 'pnpm audit --prod'
        }
      }
    }

    stage('Build & push multi-arch image') {
      when { branch 'main' }
      environment {
        IMAGE = 'ghcr.io/t1nk333r/garage-webui-ng'
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'ghcr-pat',
            usernameVariable: 'REG_USER', passwordVariable: 'REG_TOKEN')]) {
          sh 'echo "$REG_TOKEN" | docker login ghcr.io -u "$REG_USER" --password-stdin'
        }
        sh '''
          set -eu
          # QEMU user-mode emulation for the arm64 half of the build; idempotent.
          docker run --privileged --rm tonistiigi/binfmt --install arm64
          docker buildx create --name jenkins-multiarch --driver docker-container --use 2>/dev/null \
            || docker buildx use jenkins-multiarch
          SHORT=$(git rev-parse --short HEAD)
          docker buildx build \
            --platform linux/amd64,linux/arm64 \
            -t "$IMAGE:main" \
            -t "$IMAGE:latest" \
            -t "$IMAGE:sha-$SHORT" \
            --build-arg VERSION=main \
            --label org.opencontainers.image.title="Garage WebUI-NG" \
            --label org.opencontainers.image.description="Modern admin dashboard for Garage S3-compatible object storage." \
            --label org.opencontainers.image.licenses=MIT \
            --label org.opencontainers.image.vendor=garage-webui-ng \
            --cache-from type=registry,ref="$IMAGE:buildcache" \
            --cache-to type=registry,ref="$IMAGE:buildcache",mode=max \
            --push .
        '''
      }
      post {
        always {
          sh 'docker logout ghcr.io || true'
        }
      }
    }

    // Signed-binary release on v* tags — the port of the retired GitHub
    // Actions release workflow. Runs only for tag builds (tag discovery must be
    // enabled on the multibranch source). Assets and their names are a
    // contract with `relsign verify` and the in-app updater: do not rename.
    stage('Release: verify tag') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      steps {
        sh '''
          set -eu
          TAG="${TAG_NAME#v}"
          PKG=$(node -p "require('./package.json').version")
          if [ "$TAG" != "$PKG" ]; then
            echo "tag v$TAG but package.json says $PKG" >&2
            exit 1
          fi
        '''
      }
    }

    stage('Release: binaries + checksums + signature') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      steps {
        sh '''
          set -eu
          rm -rf release-artifacts && mkdir release-artifacts
          # dist/ is already built by the "Frontend: typecheck · test · build" stage.
          cd backend
          rm -rf ui/dist && cp -r ../dist ui/dist
          for ARCH in amd64 arm64; do
            CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
              go build -tags=prod -trimpath -ldflags="-s -w -X main.version=${TAG_NAME}" \
              -o "../release-artifacts/garage-webui-ng-linux-$ARCH" .
          done
          cd ../release-artifacts
          sha256sum garage-webui-ng-linux-* > SHA256SUMS
          cat SHA256SUMS
        '''
        withCredentials([string(credentialsId: 'relsign-key', variable: 'RELEASE_SIGNING_KEY')]) {
          sh '''
            set -eu
            cd backend
            go run ./cmd/relsign sign \
              -key-env RELEASE_SIGNING_KEY \
              -in ../release-artifacts/SHA256SUMS \
              -out ../release-artifacts/SHA256SUMS.sig
          '''
        }
        archiveArtifacts artifacts: 'release-artifacts/*', fingerprint: true
      }
    }

    stage('Release: publish to GitHub') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      environment {
        GH_REPO = 't1nk333r/garage-webui-ng'
      }
      steps {
        withCredentials([string(credentialsId: 'github-release-token', variable: 'GH_TOKEN')]) {
          sh '''
            set -eu
            API="https://api.github.com/repos/$GH_REPO"
            AUTH="Authorization: Bearer $GH_TOKEN"
            # Create (or reuse) the release. generate_release_notes mirrors the old workflow.
            BODY=$(node -e 'console.log(JSON.stringify({tag_name:process.argv[1],name:process.argv[1],generate_release_notes:true}))' "$TAG_NAME")
            RESP=$(curl -sS -f -H "$AUTH" -H "Accept: application/vnd.github+json" \
                     -X POST "$API/releases" -d "$BODY" 2>/dev/null \
                   || curl -sS -f -H "$AUTH" -H "Accept: application/vnd.github+json" \
                     "$API/releases/tags/$TAG_NAME")
            RELEASE_ID=$(printf '%s' "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
            UPLOAD="https://uploads.github.com/repos/$GH_REPO/releases/$RELEASE_ID/assets"
            cd release-artifacts
            for F in garage-webui-ng-linux-amd64 garage-webui-ng-linux-arm64 SHA256SUMS SHA256SUMS.sig; do
              curl -sS -f -H "$AUTH" -H "Content-Type: application/octet-stream" \
                --data-binary "@$F" "$UPLOAD?name=$F" > /dev/null
              echo "uploaded $F"
            done
          '''
        }
      }
    }

    stage('Release: versioned image tags') {
      when { tag pattern: 'v*', comparator: 'GLOB' }
      environment {
        IMAGE = 'ghcr.io/t1nk333r/garage-webui-ng'
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'ghcr-pat',
            usernameVariable: 'REG_USER', passwordVariable: 'REG_TOKEN')]) {
          sh 'echo "$REG_TOKEN" | docker login ghcr.io -u "$REG_USER" --password-stdin'
        }
        sh '''
          set -eu
          VER="${TAG_NAME#v}"            # 3.9.0
          MINOR="${VER%.*}"              # 3.9
          docker run --privileged --rm tonistiigi/binfmt --install arm64
          docker buildx create --name jenkins-multiarch --driver docker-container --use 2>/dev/null \
            || docker buildx use jenkins-multiarch
          docker buildx build \
            --platform linux/amd64,linux/arm64 \
            -t "$IMAGE:$VER" -t "$IMAGE:$MINOR" \
            --build-arg VERSION="${TAG_NAME}" \
            --label org.opencontainers.image.title="Garage WebUI-NG" \
            --label org.opencontainers.image.version="$VER" \
            --label org.opencontainers.image.licenses=MIT \
            --cache-from type=registry,ref="$IMAGE:buildcache" \
            --push .
        '''
      }
      post { always { sh 'docker logout ghcr.io || true' } }
    }
  }
}
