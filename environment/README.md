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

The macOS menu and immutable installer remain in this repo. Read the root README for those controls and upgrades; see Hearth for VM resources, code releases, credentials and recovery boundaries. Old environment setup is retained in Bellhouse Git history at `dc18abc`.
