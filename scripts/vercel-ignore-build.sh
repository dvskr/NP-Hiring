#!/usr/bin/env bash
# Vercel ignoreCommand: exit 0 skips the build, exit 1 builds.
# Skips a deploy when nothing but docs, tests or Markdown changed since the
# last deployed commit. Anything this script can't work out builds.
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$prev" ]; then
  exit 1
fi
if ! git cat-file -e "$prev^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=50 origin "$prev" 2>/dev/null || exit 1
fi
if git diff --quiet "$prev" HEAD -- . \
  ':(exclude)docs' ':(exclude)tests' ':(exclude)test-data' \
  ':(exclude)*.md' ':(exclude).github'; then
  echo "Only docs, tests or Markdown changed since $prev: skipping the build."
  exit 0
fi
exit 1
