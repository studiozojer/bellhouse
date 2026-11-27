# Running Bellhouse

## Run locally

Install [Bun](https://bun.sh/). For scheduled shell and agent handlers, install Python 3 as well. From the Bellhouse checkout, set `ARMILLARY_ROOT` to your workspace and initialize a new host.

```sh
export ARMILLARY_ROOT=/path/to/armillary
bun control.ts init
bun bellhouse.ts
```

The initializer creates a paused manifest with a loopback-only listener. On an existing host, use its current manifest. The default manifest is `$ARMILLARY_ROOT/local/bellhouse.toml`. Set `BELLHOUSE_MANIFEST` to use another file. Bellhouse can infer the workspace root when the checkout is at `repos/bellhouse` inside the workspace.

After adding a binding, restart Bellhouse and run `bun control.ts enable` from a second terminal with the same workspace and manifest settings.

## The two manifests

For the notification example, use the following as the contents of `local/bellhouse.toml`. Replace the push token with your own Expo push token and choose a unique, nonempty webhook secret. Keep this file local.

```toml
enabled = false

[server]
port = 7787
bind = "127.0.0.1"

[push]
endpoint = "https://exp.host/--/api/v2/push/send"
token = "ExponentPushToken[...]"

[[bindings]]
name = "notifications"
path = "bindings/notifications"   # relative to the armillary root

[secrets]
"form-submitted" = "<shared secret for that bell>"
```

Save the following as `bindings/notifications/bells.toml` under the workspace root. Keep credentials in the machine-local manifest. Bellhouse loads bindings at startup, so restart it after editing a binding. For a macOS LaunchAgent, use `launchctl kickstart -k gui/$(id -u)/com.zojer.bellhouse`.

```toml
[[bells]]
name = "form-submitted"
dedup_window_seconds = 600

[[bells.handlers]]
type = "push"
title_template = "New submission from {name}"
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

## Cron supervision

Cron shell and agent handlers run through `cron-runner.ts` and `bin/run-cron.py`. Each binding/cron/handler has a host-local file lock under `local/state/cron-locks/`, with an in-memory guard to avoid redundant wrapper spawns. An overlapping invocation is skipped, including across independent Bellhouse instances or a restart while an older handler still owns its lock. Handler children inherit the lock. Ordinary bell events remain independent deliveries rather than being coalesced by cron identity.

The default process-handler timeout is 900 seconds. Set `timeout_seconds = <integer>` on a cron to choose 1–86,400 seconds. On Linux (Python 3.9+, kernel 5.3+), the wrapper becomes a child subreaper: it adopts and reaps orphaned descendants even when a model worker creates a separate process group. Normal completion, parent crash, timeout and supervisor termination all clean the remaining tree with TERM followed by KILL after ten seconds, before releasing the lock. PID file descriptors prevent signalling a reused process identity. On macOS, timeout and termination clean the isolated process group; detached workers are not covered and handlers must not daemonize. Killing the wrapper itself with SIGKILL bypasses its cleanup; the Hearth guest systemd service provides an outer control-group boundary when that service stops or restarts. An uninterruptible kernel task can delay reaping and lock release. This is lifecycle supervision, not isolation against hostile code. Cron results remain content-free: overlap is exit 75, timeout is exit 124, launch/configuration failure is exit 125, and termination is 128 plus the signal; other handler exit codes are preserved. Push requests have a 15-second default HTTP timeout, overridable by the cron timeout. Existing durable worker leases and write receipts remain authoritative; process supervision does not retry uncertain external actions.

Run `bun test cron-runner.test.ts` and `python3 bin/test-run-cron.py` for synthetic overlap, independent-handler, timeout/descendant, termination, lock-release and symlink-refusal checks. A source deployment must include `bellhouse.ts`, `cron-runner.ts` and `bin/run-cron.py`, and reload the existing LaunchAgent after verifying the deployed files. Preserve its manifest, environment, bindings and credentials.

## Ringing a bell

```sh
curl -X POST http://127.0.0.1:7787/bell/form-submitted \
  -H "x-bell-token: <secret>" \
  -H "content-type: application/json" \
  -d '{"name":"Taylor","message":"Hello from the example form"}'
```

`200 {ok}` on ring, `{ok, deduped}` within the dedup window, `403` on a bad token, `404` for an undeclared bell. Bodies cap at 256 KB.

## Logs and payloads

Bellhouse logs timestamps, event names, and execution metadata to `local/state/bellhouse.log`. It stores webhook payloads under the owning binding’s `state/` directory. Keep that directory and the machine-local manifest out of Git, and give the manifest owner-only permissions (`0600`). The workspace-specific `bin/check-wall.sh` checks selected paths for a small set of sensitive patterns.

## Running in the background

For a daemon-only macOS setup, fill in the paths in the [launchd template](install/com.zojer.bellhouse.plist), copy it to `~/Library/LaunchAgents/`, and load it with `launchctl`. For the native menu and installer, see [Mac menu and installation](#mac-menu-and-installation).

If external systems need to ring a bell, keep `bind = "127.0.0.1"` and expose only the required webhook routes through an HTTPS proxy or tunnel. Keep `/status` private.

## Pausing and resuming

Use `bun control.ts enable`, `bun control.ts disable`, and `bun control.ts status` to manage the host. Pass a binding name to enable or disable just that binding. Add `--json` for machine-readable output. Existing manifests retain their enabled default.

Pause is persistent, independent of launchd. The service remains alive while paused; authenticated bells receive 503 and aren't accepted. Previously accepted, queued jobs wait for re-enabling. Pausing stops tracked subprocess groups and prevents remaining handlers from starting. Effects already committed to an external service cannot be undone. Handlers must stay within the supervised job; Linux cron supervision additionally covers detached descendants, while ordinary bells and macOS crons require a single process group. Interrupted or failed work is retained for manual review and never automatically replayed. Domain bindings must reconcile ambiguous external effects before submitting new work.

The host records queue metadata, schedule slots, deduplication hashes, and controls in `local/state/bellhouse.sqlite`. Actual payloads remain within each binding's private `state/` directory. Handlers execute serially across the host. A successful bell response means durable acceptance, not handler completion. `/status` exposes operational metadata, including paths, binding names and queue counts. Pause and resume use the local CLI. A full queue (1,000 pending jobs) returns 503. Completed history and payloads are retained; automatic retention cleanup and a review UI are not yet implemented.

After restart, previously running jobs become interrupted. Queued jobs with changed handler configuration or agent prompt content are held for review. Shell executable contents are not fingerprinted: bindings should point to immutable releases. Binding manifests remain loaded once at startup; missing/invalid bindings fail startup. Cron slots persist across restarts. The scheduler evaluates the current local minute, without replaying all missed minutes. Set `on_resume = true` on a poller cron for one fresh startup/wake scan; the binding owns bounded catch-up and its cursor. Day-of-month and day-of-week continue to use AND matching. Old file-based deduplication markers are not imported; pause existing webhook producers during migration and reconcile their outstanding deliveries.

## Mac menu and installation

Prepare a private release on macOS with the following command.

```sh
python3 install/macos.py --root /path/to/armillary --bun /absolute/path/to/bun
```

Add `--activate` to install per-user LaunchAgents and `local/bin/bellhouse`. The installer compiles the native AppKit menu using an existing Swift toolchain, ad-hoc signs it, and stores a source snapshot under `~/Library/Application Support/Studio Zojer/Bellhouse/releases/`. It refuses to replace differing existing agents or control links; upgrading requires explicit migration. The menu starts at login and shows host controls, binding toggles, service availability, and executions needing review. Quitting the menu leaves the service running. The daemon restarts after an exit; pause it through the menu or CLI instead of killing it. No sleep prevention or public tunnel is installed.

To remove this installation, pause it, then `launchctl bootout gui/$(id -u)/com.zojer.bellhouse` and `launchctl bootout gui/$(id -u)/com.zojer.bellhouse.menu`, and remove those two plist files from `~/Library/LaunchAgents`. Keep the manifest, database, and binding payloads until any interrupted effects have been reviewed.

## Tests

Run `bun test` for scheduler, lifecycle and guest-control checks. The tests need permission to bind loopback sockets. Run `python3 bin/test-run-cron.py` for process supervision checks.

## Shared operator VM

[Hearth](https://github.com/studiozojer/hearth) owns VM provisioning, operator homes and reply runners. [The integration guide](environment/README.md) describes the boundary with Bellhouse's native menu and existing-VM controls. Existing host bindings retain their own lifecycle; enabling Bellhouse does not enable autonomous replies.

For an operator whose scheduler lives inside Hearth, select `[scheduler] operator = "tycho"` in the machine manifest and use the documented `--menu-only` migration. The Mac then keeps the native controller while the guest owns scheduling and durable execution state. Guest unavailability never falls back to host execution.
