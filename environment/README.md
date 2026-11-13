# Shared operator environment

One Lima VM hosts multiple independent Unix users. The initial template provisions Tycho with a private persistent home and no sudo membership. Lima's separate `operator-admin` account is the human-controlled provisioning route. Operator accounts must never receive that account's SSH key or sudo authority.

The laptop template uses native aarch64 virtualization, Ubuntu 24.04, two vCPUs, 4 GiB RAM and a 32 GiB disk. The cloud image is pinned by SHA-256. There are no host filesystem mounts, forwarded SSH agents, inherited proxy environment, automatic application port forwarding or guest host-loopback access. Outbound network access remains available. The host administrator can still read guest data; this is not isolation from the machine's owner. Operators share a kernel and are not mutually isolated VMs.

Create and provision from this directory's parent:

```sh
limactl start --name=operators --tty=false environment/operators.yaml
limactl copy environment/install-tools.sh operators:/tmp/bellhouse-install-tools.sh
limactl shell --workdir=/ operators sudo sh /tmp/bellhouse-install-tools.sh
```

The tools script installs a checksum-verified OpenCode 1.18.34 Linux ARM64 binary. For another architecture, deliberately select matching images and binaries; do not silently use emulation. Existing operator homes are preserved when provisioning runs again. Provisioning does not copy credentials, authorize Jera, install a reply worker or invoke a model.

Add to the machine-local Bellhouse manifest:

```toml
[environment]
name = "operators"
limactl = "/opt/homebrew/bin/limactl"
```

`bellhouse status --json` includes independently observed VM and guest state. `bellhouse environment start|stop` controls only that existing VM. Stopping requests a normal guest shutdown; the CLI never force-kills the VM on timeout. Starts/stops are serialized by a directory lock in `local/state`; if a controller is forcibly killed, inspect the actual VM state before removing the stale lock. VM boot does not grant an operator permission to publish.

The macOS menu shows start/stop controls and operator submenus. Stop asks for confirmation because it stops all work in the guest. Open Terminal in Home opens an interactive shell as that operator, using the local human's administrative connection; View Recent Runs opens its designated systemd journal. These actions open private local `.command` launchers with Terminal, without AppleScript automation. The VM is manually started on this laptop and is not registered for boot/login autostart. Quitting the menu does not stop the VM or local Bellhouse daemon.

`/etc/bellhouse/operators/<name>.json` is root-owned inventory describing a user, home, model and readiness. It is not yet an executable mandate. Tycho is deliberately `ready=false`, shown as **Setup pending**, with no enable button: no guest reply service exists. The local Bellhouse daemon's enable/pause control remains separate and does not stop the VM. Guest Bellhouse supervision, per-operator enable/pause, durable reply recovery and Jera OAuth are subsequent integration work, not delivered by this VM scaffold.

Initial homes use `graph`, `identity`, `workspace`, `state`, `.config` and `.ssh`. The laptop's graph was seeded from Tycho's tracked revision `ba49a666065921588dd95d1ffe90cec2a2748324`; `identity` links to `graph/identity`. The seed is a private working copy, not an automatic two-way synchronization. Original graph files remain authoritative until a deliberate ownership/sync policy is selected. OpenCode's model is pinned to `opencode/deepseek-v4.1-flash`; no provider auth was copied.

Before upgrading the native menu, prepare with `install/macos.py` as documented in the root README, then use `--activate --upgrade`. Upgrade validates the prior installation's root/control path, saves previous plists in the new release's `rollback/`, pauses local tracked work, and replaces only these two Bellhouse LaunchAgents. `rollback-control.txt` retains the old CLI target. After an interrupted upgrade, re-running activation reconciles missing service registrations; verify both launchd status and the CLI's live status.

Back up operator homes and `/etc/bellhouse` separately from the reproducible OS. An initial private archive is retained under the router's `local/deploy/bellhouse/backups`; archive integrity was read-checked. It remains on the same physical laptop, and no full restore or off-machine backup has been verified. Before autonomous work is enabled, configure scheduled off-machine backups and test a restore into a separate directory/VM. Snapshots are not a substitute for those backups.
