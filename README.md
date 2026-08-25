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

**Binding** (`<binding>/bells.toml`, committed — no secrets, ever):

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
