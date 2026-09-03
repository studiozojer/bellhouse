#!/bin/sh
# check-wall.sh — grep the workspace's OUTSIDE-wall surfaces for data that belongs inside.
# Usage: bin/check-wall.sh [armillary-root]   (exit 1 on any hit)
#
# Inside the wall (never scanned): binding ops dirs (their state/ is gitignored anyway),
# local/, and any directory named data/ (2026-09-03 — expocommons/projects/<slug>/data/
# is a bounded project's working layer and is gitignored; see expocommons/projects/README.md).
# Outside (scanned): operators/, root-level files, mechanism repos, and the commons
# excluding ops/ and notes/.
#
# NOTE on data/: grep --exclude-dir matches a BASENAME, not a path, so this exempts any
# directory called data/ under the scanned roots, not only the projects/ one. That is a
# real widening and it is accepted knowingly: no such directory exists today outside
# numpy's venv (already excluded), and the rule "a directory named data/ is inside the
# wall" is one a person can hold in their head. If a data/ ever appears under operators/,
# this is too broad and wants a path-aware prune instead.
ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
FAIL=0

scan() {
  # $1 = path, $2 = grep --include/--exclude args passed through
  hits=$(grep -RInE \
    --exclude-dir=state --exclude-dir=ops --exclude-dir=notes --exclude-dir=data --exclude-dir=.git \
    --exclude-dir=node_modules --exclude-dir=inbox --exclude-dir=.venv --exclude-dir=site-packages \
    'ExponentPushToken\[[A-Za-z0-9_-]{8,}\]|hubspot\.com/contacts/|[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|tuta|proton)[A-Za-z0-9.-]*\.[a-z]+' \
    "$ROOT/$1" 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "WALL BREACH in $1:"
    echo "$hits" | head -20
    FAIL=1
  fi
}

scan operators
scan expocommons
scan repos/bellhouse
for f in "$ROOT"/*.md "$ROOT"/*.toml; do
  [ -f "$f" ] || continue
  hits=$(grep -InE 'ExponentPushToken\[[A-Za-z0-9_-]{8,}\]|hubspot\.com/contacts/' "$f" 2>/dev/null)
  if [ -n "$hits" ]; then echo "WALL BREACH in $(basename "$f"):"; echo "$hits"; FAIL=1; fi
done

[ "$FAIL" -eq 0 ] && echo "wall holds — no lead data outside the wall"
exit $FAIL
