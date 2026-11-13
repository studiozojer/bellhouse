#!/usr/bin/env python3
"""Install a private, immutable source snapshot and per-user launch agents.
Without --activate, only prepare artifacts; existing launch agents are untouched.
"""
import argparse
import hashlib
import os
from pathlib import Path
import plistlib
import shutil
import shlex
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', required=True, type=Path)
parser.add_argument('--bun', required=True, type=Path)
parser.add_argument('--activate', action='store_true')
args = parser.parse_args()
root, bun = args.root.resolve(), args.bun.resolve()
source = Path(__file__).resolve().parent.parent
if not root.is_dir() or not bun.is_file():
    parser.error('Root and Bun executable must exist')
os.umask(0o077)
files = [Path('cron-runner.ts'), Path('bin/run-cron.py'), Path('bellhouse.ts'), Path('control.ts'), *sorted(Path('src') / p.name for p in (source / 'src').glob('*.ts')), Path('macos/BellhouseMenu.swift')]
digest = hashlib.sha256()
for file in files:
    digest.update(str(file).encode()); digest.update((source / file).read_bytes())
# Installation inputs belong to the snapshot identity too.
digest.update(str(root).encode()); digest.update(str(bun).encode())
release = Path.home() / 'Library/Application Support/Studio Zojer/Bellhouse/releases' / digest.hexdigest()[:16]
release.mkdir(parents=True, exist_ok=True)
for file in files:
    target = release / file
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() != (source / file).read_bytes():
        raise SystemExit('Existing release does not match its identity')
    shutil.copyfile(source / file, target)
wrapper = release / 'bellhouse'
wrapper.write_text('#!/bin/sh\nexport ARMILLARY_ROOT=' + shlex.quote(str(root)) + '\nexec ' + shlex.quote(str(bun)) + ' ' + shlex.quote(str(release / 'control.ts')) + ' "$@"\n')
wrapper.chmod(0o700)
app = release / 'Bellhouse.app/Contents'
(app / 'MacOS').mkdir(parents=True, exist_ok=True)
subprocess.run(['xcrun', 'swiftc', str(release / 'macos/BellhouseMenu.swift'), '-o', str(app / 'MacOS/BellhouseMenu'), '-module-cache-path', str(root / 'local/cache/bellhouse-swift')], check=True)
with (app / 'Info.plist').open('wb') as f:
    plistlib.dump({'CFBundleIdentifier': 'com.zojer.bellhouse.menu', 'CFBundleName': 'Bellhouse', 'CFBundleExecutable': 'BellhouseMenu', 'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'LSUIElement': True}, f)
subprocess.run(['codesign', '--force', '--sign', '-', str(app.parent)], check=True)
logs = root / 'local/state'
logs.mkdir(parents=True, exist_ok=True)
env = {'ARMILLARY_ROOT': str(root), 'BELLHOUSE_CONTROL': str(wrapper), 'PATH': str(bun.parent) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}
prepared = release / 'LaunchAgents'
prepared.mkdir(exist_ok=True)
for label, argv, keep_alive in [
    ('com.zojer.bellhouse', [str(bun), str(release / 'bellhouse.ts')], True),
    ('com.zojer.bellhouse.menu', [str(app / 'MacOS/BellhouseMenu')], False),
]:
    data = {'Label': label, 'ProgramArguments': argv, 'WorkingDirectory': str(root), 'EnvironmentVariables': env, 'RunAtLoad': True, 'KeepAlive': keep_alive, 'ThrottleInterval': 10, 'StandardOutPath': str(logs / (label + '.stdout.log')), 'StandardErrorPath': str(logs / (label + '.stderr.log'))}
    with (prepared / (label + '.plist')).open('wb') as f:
        plistlib.dump(data, f)
print('Prepared release:', release, flush=True)
if args.activate:
    # Refuse to replace another installation without an explicit migration.
    agents = Path.home() / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    for file in prepared.glob('*.plist'):
        dest = agents / file.name
        if dest.exists() and dest.read_bytes() != file.read_bytes():
            raise SystemExit('Existing LaunchAgent differs; preserve it and migrate explicitly: ' + str(dest))
    manifest = root / 'local/bellhouse.toml'
    if not manifest.exists():
        subprocess.run([str(wrapper), 'init'], check=True)
    local_bin = root / 'local/bin'
    local_bin.mkdir(parents=True, exist_ok=True)
    link = local_bin / 'bellhouse'
    if link.exists() or link.is_symlink():
        if not link.is_symlink() or link.resolve() != wrapper:
            raise SystemExit('Existing control command differs: ' + str(link))
    else:
        link.symlink_to(wrapper)
    domain = 'gui/' + str(os.getuid())
    for file in sorted(prepared.glob('*.plist')):
        dest = agents / file.name
        shutil.copyfile(file, dest)
        label = file.stem
        exists = subprocess.run(['launchctl', 'print', domain + '/' + label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if not exists:
            subprocess.run(['launchctl', 'bootstrap', domain, str(dest)], check=True)
    subprocess.run([str(wrapper), 'status'], check=True)
