import { spawn } from 'node:child_process';
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config';

// Only explicitly configured environments are controlled. No discovery/adoption.
function settings(config: Config) {
  const value = config.local.environment;
  if (!value) return null;
  if (!/^[-a-zA-Z0-9_]+$/.test(value.name) || typeof value.limactl !== 'string' || !value.limactl.startsWith('/')) throw Error('Invalid environment');
  return value as {name: string; limactl: string};
}
export function execute(argv: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {stdio: ['ignore', 'pipe', 'ignore']});
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Environment operation timed out')); }, timeout);
    child.stdout.on('data', chunk => {
      out += chunk;
      if (out.length > 1024 * 1024) { child.kill('SIGKILL'); reject(Error('Environment output too large')); }
    });
    child.on('error', () => { clearTimeout(timer); reject(Error('Environment command unavailable')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Error('Environment command failed')); });
  });
}
const guestStatus = `import json,pathlib,subprocess
result=[]
for p in sorted(pathlib.Path('/etc/bellhouse/operators').glob('*.json')):
 d=json.loads(p.read_text())
 name=d['name']
 if not name.replace('-','').replace('_','').isalnum(): continue
 unit='bellhouse-operator-'+name+'.service'
 active=subprocess.run(['systemctl','is-active','--quiet',unit]).returncode==0
 result.append({'name':name,'home':d['home'],'model':d.get('model'),'ready':bool(d.get('ready',False)),'active':active})
print(json.dumps(result))`;
export async function environmentStatus(config: Config) {
  const env = settings(config);
  if (!env) return null;
  try {
    const output = await execute([env.limactl, 'list', '--json', env.name], 8000);
    const rows = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const vm = rows.find(row => row.name === env.name);
    if (!vm) return {name: env.name, state: 'Missing', operators: []};
    const value = {name: env.name, state: vm.status, cpus: vm.cpus, memory: vm.memory, disk: vm.disk, operators: [] as any[], guestAvailable: false};
    if (vm.status === 'Running') {
      try {
        value.operators = JSON.parse(await execute([env.limactl, 'shell', '--workdir=/', env.name, 'python3', '-c', guestStatus], 8000));
        value.guestAvailable = true;
      } catch {} // Running VM does not imply guest services are ready.
    }
    return value;
  } catch { return {name: env.name, state: 'Unavailable', operators: []}; }
}
export async function environmentChange(config: Config, operation: string) {
  const env = settings(config);
  if (!env || !['start','stop'].includes(operation)) throw Error('Unknown environment operation');
  mkdirSync(config.state, {recursive: true, mode: 0o700});
  const lock = join(config.state, 'environment-operation.lock');
  mkdirSync(lock, {mode: 0o700});
  try {
    const current = await environmentStatus(config);
    // Never implicitly create a VM from a name or force-stop one on failure.
    if (!current || !['Running','Stopped'].includes(current.state)) throw Error('Environment unavailable');
    if ((operation === 'start' && current.state === 'Stopped') || (operation === 'stop' && current.state === 'Running')) {
      await execute([env.limactl, operation, '--tty=false', env.name], 180000);
    }
  } finally { rmdirSync(lock); }
}
export async function environmentTerminal(config: Config, name: string, logs = false) {
  const env = settings(config);
  if (!env || !/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('Unknown operator');
  const value = await environmentStatus(config);
  if (value?.state !== 'Running' || !value.operators.some((operator: any) => operator.name === name)) throw Error('Operator unavailable');
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const command = [env.limactl, 'shell', '--workdir=/', env.name, 'sudo', ...(logs ? ['journalctl', '-u', 'bellhouse-operator-'+name+'.service', '-n', '100', '--no-pager'] : ['-iu', name])].map(quote).join(' ');
  mkdirSync(config.state, {recursive: true, mode: 0o700});
  const launcher = join(config.state, `operator-${name}-${logs ? 'logs' : 'home'}.command`);
  writeFileSync(launcher, '#!/bin/sh\nexec '+command+'\n', {mode: 0o700});
  await execute(['/usr/bin/open', '-a', 'Terminal', launcher]);
}
