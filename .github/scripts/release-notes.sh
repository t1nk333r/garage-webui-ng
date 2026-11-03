#!/usr/bin/env bash
# Writes the notes for a tag's GitHub release to stdout. They come from
# annotated tag messages, so a release always says what changed:
#
#   1. the tag's own message, without its first line when that is just the
#      tag name ("vX.Y.Z", then a blank line, then one line per change);
#   2. the messages of earlier tags since the previous release that were
#      never released themselves, since their changes ship here too;
#   3. a link comparing with the previous release.
#
# stdin lists the tags that already have a published release, one per line:
#
#   gh api "repos/OWNER/REPO/releases" --paginate \
#     -q '.[] | select((.draft or .prerelease) | not) | .tag_name' \
#     | .github/scripts/release-notes.sh vX.Y.Z
#
# Fails when the tag is lightweight or its message lists no changes. Needs the
# full history and the annotated tag objects, not just the tagged commit.
set -euo pipefail

tag=${1:?usage: release-notes.sh TAG < released-tags}
repo=${GITHUB_REPOSITORY:-t1nk333r/garage-webui-ng}

# Prints a tag's change lines: its message minus a first line that only
# repeats the tag name, minus any signature, with no blank lines at either end.
changes() {
  local msg sig first
  # Not %(contents:subject): it joins the first paragraph into one line.
  msg=$(git for-each-ref --format='%(contents)' "refs/tags/$1")
  sig=$(git for-each-ref --format='%(contents:signature)' "refs/tags/$1")
  msg=${msg%"$sig"}
  first=${msg%%$'\n'*}
  if [[ $first == "$1" ]]; then
    msg=${msg#"$first"}
  fi
  # Drop leading blank lines; $(...) has already dropped the trailing ones.
  sed '/[^[:space:]]/,$!d' <<<"$msg"
}

if [[ $(git cat-file -t "refs/tags/$tag" 2>/dev/null) != tag ]]; then
  echo "::error::$tag is not an annotated tag, so it has no message to use as release notes" >&2
  exit 1
fi
notes=$(changes "$tag")
if [[ -z ${notes//[[:space:]]/} ]]; then
  echo "::error::the message of tag $tag lists no changes; retag with one line per change after the version line: git tag -a -f $tag" >&2
  exit 1
fi

declare -A released=()
while IFS= read -r t; do
  [[ -n $t ]] && released[$t]=1
done

# Walk back through the tags this one contains, newest version first, until
# one that was released.
previous="" unreleased=()
while IFS= read -r t; do
  [[ $t == "$tag" ]] && continue
  if [[ -n ${released[$t]:-} ]]; then
    previous=$t
    break
  fi
  unreleased+=("$t")
done < <(git tag --list 'v*' --merged "$tag" --sort=-version:refname)

printf '%s\n' "$notes"

if ((${#unreleased[@]})); then
  printf '\n## Also in this release\n\n'
  if ((${#unreleased[@]} == 1)); then
    printf '%s was tagged but never released, so its changes ship in %s too.\n' "${unreleased[0]}" "$tag"
  else
    joined=$(printf '%s, ' "${unreleased[@]:0:${#unreleased[@]}-1}")
    printf '%s and %s were tagged but never released, so their changes ship in %s too.\n' \
      "${joined%, }" "${unreleased[-1]}" "$tag"
  fi
  for t in "${unreleased[@]}"; do
    printf '\n### %s\n\n' "$t"
    # An annotated tag with no change lines, or a lightweight tag, gets a
    # pointer to its commits instead.
    t_notes=""
    [[ $(git cat-file -t "refs/tags/$t") == tag ]] && t_notes=$(changes "$t")
    if [[ -n ${t_notes//[[:space:]]/} ]]; then
      printf '%s\n' "$t_notes"
    else
      printf 'No change list in its tag message; see its commits: https://github.com/%s/commits/%s\n' "$repo" "$t"
    fi
  done
fi

if [[ -n $previous ]]; then
  printf '\n**Full changelog**: https://github.com/%s/compare/%s...%s\n' "$repo" "$previous" "$tag"
fi
