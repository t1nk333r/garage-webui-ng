#!/usr/bin/env bash
# Prints the backend packages whose tests a change can reach, one import path
# per line, for `go test`. Reads the changed paths, relative to the repository
# root, on stdin; runs from any directory.
#
#   git diff --name-only --no-renames main | .github/scripts/go-affected.sh
#
# A source file reaches its own package and every package that imports it,
# directly or not, including through a test. A _test.go file reaches only its
# own package. A file outside any package (testdata, an asset) belongs to the
# nearest package above it.
set -euo pipefail

cd "$(dirname "$0")/../../backend"
module=$(go list -m)
declare -A code=() tests=()

# Import path of the package a backend-relative directory belongs to.
package_of() {
  local dir=$1
  until [[ $dir == . ]] || compgen -G "$dir/*.go" >/dev/null; do
    dir=$(dirname "$dir")
  done
  if [[ $dir == . ]]; then echo "$module"; else echo "$module/$dir"; fi
}

while IFS= read -r path; do
  case $path in
    # release_key_test.go checks the updater's copy of the release key.
    contrib/garage-update/*) tests[$module]=1 ;;
    backend/*_test.go) tests[$(package_of "$(dirname "${path#backend/}")")]=1 ;;
    backend/*) code[$(package_of "$(dirname "${path#backend/}")")]=1 ;;
  esac
done

if ((${#code[@]} + ${#tests[@]} == 0)); then
  exit 0
fi

# Each test binary (P.test) lists every package it compiles in Deps, with the
# variants built for that test suffixed " [P.test]".
go list -test -json=ImportPath,Deps ./... | jq -r \
  --argjson code "$(jq -nc '$ARGS.positional' --args ${code[@]+"${!code[@]}"})" \
  --argjson tests "$(jq -nc '$ARGS.positional' --args ${tests[@]+"${!tests[@]}"})" '
  select(.ImportPath | endswith(".test"))
  | (.ImportPath | rtrimstr(".test")) as $pkg
  | select(($pkg | IN($tests[]))
      or any(.Deps[]? | sub(" \\[.*\\]$"; ""); IN($code[])))
  | $pkg'
