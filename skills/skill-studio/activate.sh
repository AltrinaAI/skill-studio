#!/usr/bin/env bash
# activate.sh — load every secret Skill Studio manages into the agent's
# environment. Agent-agnostic: it does not assume any particular harness.
#
# Run it through eval so the values also land in the *current* shell:
#   eval "$(bash /path/to/skill-studio/activate.sh --print)"
#
#   (no flag)   wire future shells to load the secrets; print a summary only.
#   --print     also emit `export KEY=VALUE` on stdout for eval to consume.
#
# Two delivery paths, because no single file is read by every agent's shell:
#   • eval --print injects into whatever shell is running right now (universal).
#   • the startup-file hook covers harnesses that re-source a profile on each
#     command (e.g. a fresh shell per tool call) so they inherit them too.
#
# Secret *values* go to stdout only with --print (eval consumes them, so they
# never reach the transcript). Only key *names* are printed, to stderr.

set -euo pipefail

# File of `export KEY=VALUE` lines that Skill Studio renders from its store.
ENV_FILE="${SKILL_STUDIO_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/skill-studio/env}"
MARKER='# skill-studio (managed — loads your Skill Studio secrets)'

if [ ! -s "$ENV_FILE" ]; then
  echo "skill-studio: no secrets configured yet ($ENV_FILE is missing or empty)." >&2
  echo "Add them in Skill Studio, then run this again." >&2
  exit 0
fi

# Make future shells source the secrets. Prepend the hook ABOVE any
# "return if not interactive" guard, since per-command harness shells are
# usually non-interactive and would skip anything below it.
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.zshenv" "$HOME/.profile"; do
  grep -qF "$MARKER" "$rc" 2>/dev/null && continue
  tmp="$(mktemp)"
  {
    printf '%s\n' "$MARKER"
    printf '[ -f "%s" ] && . "%s"\n' "$ENV_FILE" "$ENV_FILE"
    printf '# end skill-studio\n\n'
    cat "$rc" 2>/dev/null || true
  } >"$tmp"
  mv "$tmp" "$rc"
done

# Load into the current shell when asked (eval consumes stdout — no leak).
[ "${1:-}" = "--print" ] && cat "$ENV_FILE"

# Summary — key names only, never values.
names="$(sed -n 's/^[[:space:]]*export[[:space:]]\{1,\}\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$ENV_FILE" | paste -sd' ' -)"
echo "skill-studio: ready — ${names:-no secrets found}" >&2
