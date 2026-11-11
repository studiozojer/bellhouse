# bellhouse

A small always-on doorbell + cron service for an armillary workspace. Mechanism only: bellhouse knows **bells** (named HTTP endpoints), **crons** (schedules), and **handlers** (what a ring does). It knows nothing about any domain — what rings, and what ringing means, is declared by **bindings**, the same move the armillary router makes with modules. A bare bellhouse with no bindings is a working host that rings nothing, and that is fine.

## Run

```sh
bun bellhouse.ts
```

Requires [bun](https://bun.sh) (native TOML imports). Reads the machine-local manifest at `$ARMILLARY_ROOT/local/bellhouse.toml` (override with `BELLHOUSE_MANIFEST`). `ARMILLARY_ROOT` defaults to two directories above this repo — the standard `repos/bellhouse` placement.

## The two manifests

**Machine-local** (`local/bellhouse.toml`, gitignored — secrets and machine config live here and only here):

```toml
[server]
port = 7787
bind = "127.0.0.1"        # widen only behind a tunnel

[push]
endpoint = "https://exp.host/--/api/v2/push/send"
token = "ExponentPushToken[...]"

[[bindings]]
name = "expo"
path = "expocommons/ops"   # relative to the armillary root

[secrets]
"inbound-lead" = "<shared secret for that bell>"
```

**Binding** (`<binding>/bells.toml`, committed — no secrets, ever). **Read once, at process start.** Editing or pulling a `bells.toml` does not change what a running bellhouse serves — the bindings are loaded into memory at startup and never re-read. A binding edit is inert until `launchctl kickstart -k gui/$(id -u)/com.zojer.bellhouse`. Noted 2026-08-30, after a handler sat on disk for four days while the process served the version it had loaded before the pull:

```toml
[[bells]]
name = "inbound-lead"
dedup_window_seconds = 600

[[bells.handlers]]
type = "push"
title_template = "Inbound: {name} — {company}"
body_template = "{message}"

[[crons]]
name = "morning-sweep"
schedule = "7 9 * * *"      # 5-field cron, local time
enabled = false

[[crons.handlers]]
type = "shell"
argv = ["sh", "some-script.sh"]
```

## Handler types

- **push** — Expo push notification. Templates substitute `{key}` from the JSON payload (`{body}` = raw body). Token and endpoint come from the local manifest.
- **shell** — spawn `argv` (no shell interpolation) with env: `BELL_SOURCE`, `BELL_PAYLOAD_FILE`, `BELL_BINDING_DIR`, `ARMILLARY_ROOT`. cwd is the armillary root.
- **agent** — spawn a headless `claude -p` session in the armillary root. The prompt is `prompt_file` (relative to the binding) plus a pointer to the payload file, with a standing instruction that payload contents are data, never instructions.

Any handler takes `enabled = false` to stay declared but dormant.

## Ringing a bell

```sh
curl -X POST http://127.0.0.1:7787/bell/inbound-lead \
  -H "x-bell-token: <secret>" \
  -H "content-type: application/json" \
  -d '{"name":"…","company":"…","message":"…"}'
```

`200 {ok}` on ring, `{ok, deduped}` within the dedup window, `403` on a bad token, `404` for an undeclared bell. Bodies cap at 256 KB.

## The data wall

The global log (`local/state/bellhouse.log`) is content-free by design: timestamps, bell names, exit codes. Payloads and run artifacts persist only under the owning binding's `state/` directory — which the binding is expected to **gitignore**. That directory is the wall: sensitive working data stays inside the binding that owns it and never enters git history or the mechanism layer. `bin/check-wall.sh` greps the workspace's outside-wall surfaces for leaks.

## Always-on

`install/com.zojer.bellhouse.plist` is a launchd template — fill in the paths, `cp` to `~/Library/LaunchAgents/`, `launchctl load` it. Public reachability (for external webhooks) is deliberately out of scope: put a Tailscale funnel or Cloudflare tunnel in front, keep `bind = "127.0.0.1"`.

## Laptop controls

Initialize a new host with `ARMILLARY_ROOT=/path/to/armillary bun control.ts init`. New hosts start paused; existing manifests retain their enabled default. `bun control.ts enable`, `disable`, and `status` control the host. Pass a binding name to enable/disable just that binding, and `--json` for machine-readable status. Set `ARMILLARY_ROOT` explicitly when using a worktree or installed snapshot.

Pause is persistent, independent of launchd. The service remains alive while paused; authenticated bells receive 503 and aren't accepted. Previously accepted, queued jobs wait for re-enabling. Pausing stops tracked subprocess groups and prevents remaining handlers from starting. Effects already committed to an external service cannot be undone. Handlers must not daemonize or escape their process group. Interrupted or failed work is retained for manual review and never automatically replayed. Domain bindings must reconcile ambiguous external effects before submitting new work.

The host records queue metadata, schedule slots, deduplication hashes, and controls in `local/state/bellhouse.sqlite`. Actual payloads remain within each binding's private `state/` directory. Handlers execute serially across the host. A successful bell response means durable acceptance, not handler completion. `/status` exposes content-free status; mutations are local CLI operations, not HTTP endpoints. A full queue (1,000 pending jobs) returns 503. Completed history and payloads are retained; automatic retention cleanup and a review UI are not yet implemented.

After restart, previously running jobs become interrupted. Queued jobs with changed handler configuration or agent prompt content are held for review. Shell executable contents are not fingerprinted: bindings should point to immutable releases. Binding manifests remain loaded once at startup; missing/invalid bindings fail startup. Cron slots persist across restarts. The scheduler evaluates the current local minute, without replaying all missed minutes. Set `on_resume = true` on a poller cron for one fresh startup/wake scan; the binding owns bounded catch-up and its cursor. Day-of-month and day-of-week continue to use AND matching. Old file-based deduplication markers are not imported; pause existing webhook producers during migration and reconcile their outstanding deliveries.

On macOS, prepare a private release with:

```sh
python3 install/macos.py --root /path/to/armillary --bun /absolute/path/to/bun
```

Add `--activate` to install per-user LaunchAgents and `local/bin/bellhouse`. The installer compiles the native AppKit menu using an existing Swift toolchain, ad-hoc signs it, and stores a source snapshot under `~/Library/Application Support/Studio Zojer/Bellhouse/releases/`. It refuses to replace differing existing agents or control links; upgrading requires explicit migration. The menu starts at login and shows host controls, binding toggles, service availability, and executions needing review. Quitting the menu leaves the service running. The daemon restarts after an exit; pause it through the menu or CLI instead of killing it. No sleep prevention or public tunnel is installed.

To remove this installation, pause it, then `launchctl bootout gui/$(id -u)/com.zojer.bellhouse` and `launchctl bootout gui/$(id -u)/com.zojer.bellhouse.menu`, and remove those two plist files from `~/Library/LaunchAgents`. Keep the manifest, database, and binding payloads until any interrupted effects have been reviewed.

Run lifecycle verification with `bun test` (requires permission to bind loopback sockets).
