# Operator environments moved to Hearth

[Hearth](https://github.com/studiozojer/hearth) owns the VM recipe, operator-home provisioning, pinned tool installation and reply runners. The original Lima template and tool installer have moved there; use Hearth's setup command rather than maintaining a second copy here.

Bellhouse retains its environment status, existing-VM start/stop controls, operator home/journal launchers and local host enable/pause. It is not the owner of operator homes, identities or model configuration.

The existing machine-local binding stays valid:

```toml
[environment]
name = "operators"
limactl = "/opt/homebrew/bin/limactl"
```

Hearth can explicitly adopt that VM without recreating its disk or moving homes. Its installer preserves the menu's current guest inventory contract, `/etc/bellhouse/operators/<name>.json`, and journal unit name, `bellhouse-operator-<name>.service`. Operator readiness and activity remain independently observed. Enabling the local Bellhouse host does not itself authorize a reply or start a model call.

The macOS menu and immutable installer remain in this repo. See the [operations guide](../OPERATIONS.md#mac-menu-and-installation) for those controls and upgrades; see Hearth for VM resources, code releases, credentials and recovery boundaries. Old environment setup is retained in Bellhouse Git history at `dc18abc`.

## Scheduler inside Hearth

Hearth can install a committed Bellhouse source snapshot as a separate service for each operator. The daemon runs as that operator's unprivileged Unix account, with private state under `/home/<operator>/state/bellhouse`. The initial manifest is paused with no bindings. Service activation is separate from installation and does not enable work. Hearth owns this deployment, unit, filesystem and rollback; Bellhouse remains the scheduler implementation.

To make the laptop a controller for that scheduler, add the following to its machine-local manifest alongside `[environment]`:

```toml
[scheduler]
operator = "tycho"
```

The existing `status`, `enable`, `disable` and binding controls now call the guest CLI through the human administrator's existing Lima connection. No credentials or host paths are mounted into the VM. Wrong-account responses and failed control operations are refused; there is no fallback that changes the old host database. An unavailable guest is reported as unavailable. Environment start/stop and home terminals still work locally. Only one guest scheduler is selected by this menu; additional operator schedulers can be controlled through separate configurations.

Once the guest service is running and paused, with any old host work reconciled, migrate the menu installation:

```sh
python3 install/macos.py --root /path/to/armillary --bun /absolute/path/to/bun --menu-only --activate --upgrade
```

This compiles the same native AppKit menu, verifies the guest is reachable and paused, refuses host bindings or queued/active host work, preserves the previous daemon plist/control target, and removes only the recognized host daemon LaunchAgent. The manifest, SQLite history and payloads remain. New Bellhouse code refuses to start a host daemon against a guest-controller manifest. The guest daemon starts with its VM after explicit Hearth activation; starting the Mac menu does not start the VM.

To roll back, pause guest work, disable/stop its Hearth service deliberately, restore the previous machine manifest and saved LaunchAgent/control target, and reload the old host installation. Do not copy guest state into the host or clear held executions. Merely having Bellhouse in the guest does not discover Jera mentions, renew Jera authorization, authorize inference or publish replies; enroll a bounded application binding separately.
