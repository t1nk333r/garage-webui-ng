#!/usr/bin/env bash
# Decides how much of CI a change reaches, so CI runs only the tests it can
# affect. Writes to $GITHUB_OUTPUT (stdout when unset):
#
#   frontend, backend               skip | affected | full
#   frontend_files, backend_files   JSON arrays of the changed paths handed to
#                                   `vitest related` and go-affected.sh
#
# A pull request is compared with the branch it merges into, a push with the
# commit the branch was at before it. A release tag, the nightly run and a
# manual run test everything, as does a push whose previous commit cannot be
# found (a new branch, a force push).
#
# Each path is classified by the first rule that matches. A path no rule
# knows runs everything: running too much is slow, running too little is a
# green build that proves nothing. Only the tests are narrowed; a side that
# runs at all still builds, typechecks, vets and lints in full.
set -euo pipefail

out=${GITHUB_OUTPUT:-/dev/stdout}
frontend=skip backend=skip
frontend_files=() backend_files=()

finish() {
  # A full run takes no list.
  [[ $frontend != full ]] || frontend_files=()
  [[ $backend != full ]] || backend_files=()
  {
    echo "frontend=$frontend"
    echo "backend=$backend"
    echo "frontend_files=$(jq -nc '$ARGS.positional' --args ${frontend_files[@]+"${frontend_files[@]}"})"
    echo "backend_files=$(jq -nc '$ARGS.positional' --args ${backend_files[@]+"${backend_files[@]}"})"
  } >>"$out"
  echo "frontend: $frontend (${#frontend_files[@]} paths)  backend: $backend (${#backend_files[@]} paths)"
  exit 0
}

everything() {
  echo "Testing everything: $1"
  frontend=full backend=full
  finish
}

# Raises a side's scope; never lowers it.
raise() {
  local -n side=$1
  [[ $side == full ]] || side=$2
}

base=""
case ${GITHUB_EVENT_NAME:-} in
  # The checkout is the merge commit; its first parent is the target branch.
  pull_request) base=$(git rev-parse HEAD^1) ;;
  push) [[ ${GITHUB_REF:-} == refs/heads/* ]] && base=${BEFORE:-} ;;
esac
if [[ -z $base ]]; then
  everything "${GITHUB_EVENT_NAME:-local} run on ${GITHUB_REF:-HEAD}"
fi
if [[ $base =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  everything "the previous commit $base is not in the history"
fi

# --no-renames lists a moved file at both paths, so both sides are classified.
while IFS=$'\t' read -r status path; do
  case $path in
    # CI itself.
    .github/*) everything "$path changed" ;;

    # Read by nothing CI tests.
    *.md | docs/* | plans/* | LICENSE | .env.example | docker-compose.yml | \
      .dockerignore | .gitignore) ;;

    # The Go toolchain pin (the backend job checks it against GO_VERSION) and
    # the module graph.
    Dockerfile | backend/go.mod | backend/go.sum) raise backend full ;;
    backend/*)
      raise backend affected
      backend_files+=("$path")
      ;;
    # backend/release_key_test.go reads the updater's copy of the release key.
    contrib/garage-update/*)
      raise backend affected
      backend_files+=("$path")
      ;;

    # Every frontend test loads these.
    package.json | pnpm-lock.yaml | tsconfig*.json | vite.config.* | src/test/*)
      raise frontend full
      ;;
    src/*)
      if [[ $status == D ]]; then
        # vitest related cannot see what imported a file that is gone.
        raise frontend full
      else
        raise frontend affected
        frontend_files+=("$path")
      fi
      ;;
    # Typechecked, linted or built, but imported by no test.
    index.html | public/* | eslint.config.* | tailwind.config.* | postcss.config.*)
      raise frontend affected
      ;;

    *) everything "no rule for $path" ;;
  esac
done < <(git diff --name-status --no-renames "$base" HEAD)

finish
