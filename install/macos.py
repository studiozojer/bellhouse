#!/usr/bin/env python3
"""Install a private, immutable source snapshot and per-user launch agents.
Without --activate, only prepare artifacts; existing launch agents are untouched.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import shlex
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', required=True, type=Path)
parser.add_argument('--bun', required=True, type=Path)
parser.add_argument('--activate', action='store_true')
parser.add_argument('--upgrade', action='store_true', help='Replace a verified Bellhouse installation, retaining rollback plists')
parser.add_argument('--menu-only', action='store_true', help='Control a configured guest scheduler and retire this installation\'s host daemon')
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
digest.update(b'menu-only' if args.menu_only else b'host-daemon')
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
services = [
    ('com.zojer.bellhouse', [str(bun), str(release / 'bellhouse.ts')], True),
    ('com.zojer.bellhouse.menu', [str(app / 'MacOS/BellhouseMenu')], False),
]
if args.menu_only: services = services[1:]
for label, argv, keep_alive in services:
    data = {'Label': label, 'ProgramArguments': argv, 'WorkingDirectory': str(root), 'EnvironmentVariables': env, 'RunAtLoad': True, 'KeepAlive': keep_alive, 'ThrottleInterval': 10, 'StandardOutPath': str(logs / (label + '.stdout.log')), 'StandardErrorPath': str(logs / (label + '.stderr.log'))}
    with (prepared / (label + '.plist')).open('wb') as f:
        plistlib.dump(data, f)
print('Prepared release:', release, flush=True)
if args.activate:
    # Refuse to replace another installation without an explicit migration.
    agents = Path.home() / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    retired = agents / 'com.zojer.bellhouse.plist'
    if args.menu_only:
        # This is a concrete migration, not a request to drop other host bindings.
        metadata = json.loads(subprocess.check_output([str(bun),'-e',
            'const c=Bun.TOML.parse(await Bun.file(process.argv[1]).text());console.log(JSON.stringify({bindings:c.bindings?.length??0,scheduler:!!c.scheduler}));',
            str(root/'local/bellhouse.toml')],text=True))
        guest = json.loads(subprocess.check_output([str(wrapper),'status','--json'],text=True))
        if metadata['bindings'] or not metadata['scheduler'] or not guest.get('scheduler',{}).get('available') or not guest.get('running') or guest.get('enabled'):
            raise SystemExit('Menu-only migration requires no host bindings and a reachable, running, paused guest scheduler')
        if retired.exists():
            old = plistlib.loads(retired.read_bytes())
            old_control = Path(old.get('EnvironmentVariables',{}).get('BELLHOUSE_CONTROL',''))
            if not args.upgrade or old.get('Label')!='com.zojer.bellhouse' or old.get('EnvironmentVariables',{}).get('ARMILLARY_ROOT')!=str(root) or not old_control.is_relative_to(release.parent.resolve()) or not old_control.is_file():
                raise SystemExit('Refusing to retire an unrecognized host daemon')
            previous = json.loads(subprocess.check_output([str(old_control),'status','--json'],text=True))
            if previous.get('enabled') or previous.get('active') or previous.get('bindings') or any(row.get('status') in ['queued','running'] and row.get('count',0) for row in previous.get('counts',[])):
                raise SystemExit('Pause and reconcile existing host work before migration')
            rollback=release/'rollback';rollback.mkdir(exist_ok=True)
            if not (rollback/retired.name).exists():shutil.copyfile(retired,rollback/retired.name)
    for file in prepared.glob('*.plist'):
        dest = agents / file.name
        if dest.exists() and dest.read_bytes() != file.read_bytes():
            if not args.upgrade:
                raise SystemExit('Existing LaunchAgent differs; use --upgrade after review: ' + str(dest))
            old = plistlib.loads(dest.read_bytes())
            old_program = Path(old.get('ProgramArguments', [''])[0])
            old_control = Path(old.get('EnvironmentVariables', {}).get('BELLHOUSE_CONTROL', ''))
            releases = release.parent.resolve()
            if old.get('Label') != file.stem or old.get('EnvironmentVariables', {}).get('ARMILLARY_ROOT') != str(root) or not old_control.is_relative_to(releases) or not old_control.is_file():
                raise SystemExit('Refusing to replace an unrecognized LaunchAgent')
            rollback = release / 'rollback'
            rollback.mkdir(exist_ok=True)
            backup = rollback / dest.name
            if not backup.exists(): shutil.copyfile(dest, backup)
    manifest = root / 'local/bellhouse.toml'
    if not manifest.exists():
        subprocess.run([str(wrapper), 'init'], check=True)
    local_bin = root / 'local/bin'
    local_bin.mkdir(parents=True, exist_ok=True)
    link = local_bin / 'bellhouse'
    if link.exists() or link.is_symlink():
        if not link.is_symlink():
            raise SystemExit('Existing control command is not an installation link')
        if link.resolve() != wrapper:
            if not args.upgrade or not link.resolve().is_relative_to(release.parent.resolve()):
                raise SystemExit('Existing control command differs: ' + str(link))
            # Stop tracked host work before replacing the daemon. Pause persists.
            subprocess.run([str(link), 'disable'], check=True)
            (release / 'rollback-control.txt').write_text(str(link.resolve()) + '\n')
            link.unlink()
            link.symlink_to(wrapper)
    else:
        link.symlink_to(wrapper)
    domain = 'gui/' + str(os.getuid())
    if args.menu_only and retired.exists():
        label=domain+'/com.zojer.bellhouse'
        if subprocess.run(['launchctl','print',label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
            subprocess.run(['launchctl','bootout',label],check=True)
            for attempt in range(100):
                if subprocess.run(['launchctl','print',label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0:break
                time.sleep(0.1)
            else:raise SystemExit('Old host daemon has not unloaded')
        retired.unlink()
    for file in sorted(prepared.glob('*.plist')):
        dest = agents / file.name
        label = file.stem
        if args.upgrade and dest.exists() and dest.read_bytes() != file.read_bytes():
            loaded = subprocess.run(['launchctl', 'print', domain + '/' + label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            if loaded:
                subprocess.run(['launchctl', 'bootout', domain + '/' + label], check=True)
                # launchd removal can remain visible briefly after bootout returns.
                for attempt in range(100):
                    if subprocess.run(['launchctl', 'print', domain + '/' + label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0: break
                    time.sleep(0.1)
                else: raise SystemExit('Old service has not unloaded: ' + label)
        shutil.copyfile(file, dest)
        exists = subprocess.run(['launchctl', 'print', domain + '/' + label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if not exists:
            subprocess.run(['launchctl', 'bootstrap', domain, str(dest)], check=True)
    subprocess.run([str(wrapper), 'status'], check=True)
