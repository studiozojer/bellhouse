import type {Config} from './config';
import {execute} from './environment';

export function schedulerSettings(config:Config) {
  const scheduler=config.local.scheduler;
  if(!scheduler)return null;
  const env=config.local.environment;
  if(!/^[a-z][a-z0-9_-]{0,30}$/.test(scheduler.operator)||['root','operator-admin','ubuntu','nobody'].includes(scheduler.operator)
    ||!env||!/^[-a-zA-Z0-9_]+$/.test(env.name)||typeof env.limactl!=='string'||!env.limactl.startsWith('/')) throw Error('Invalid guest scheduler');
  return {operator:scheduler.operator as string,name:env.name as string,limactl:env.limactl as string};
}

// The Mac controls the explicitly selected guest account through the existing
// administrator transport. No host credentials, mounts or new network port.
export async function guestControl(config:Config,command:'status'|'enable'|'disable',binding?:string) {
  const target=schedulerSettings(config);if(!target)throw Error('No guest scheduler');
  if(binding&&!/^[a-zA-Z0-9_-]+$/.test(binding))throw Error('Invalid binding');
  const root=`/home/${target.operator}/state/bellhouse`;
  const value=JSON.parse(await execute([target.limactl,'shell','--workdir=/',target.name,
    'sudo','-iu',target.operator,'env',`ARMILLARY_ROOT=${root}`,`BELLHOUSE_MANIFEST=${root}/local/bellhouse.toml`,
    '/usr/local/bin/bun',`/opt/hearth/bellhouse/operators/${target.operator}/current/control.ts`,
    command,...(binding?[binding]:[]),'--json'],command==='status'?8000:20000));
  if(value.version!==1||value.root!==root||value.manifest!==root+'/local/bellhouse.toml'
    ||typeof value.enabled!=='boolean'||typeof value.running!=='boolean')throw Error('Unexpected guest scheduler');
  return {...value,scheduler:{location:'guest',operator:target.operator,environment:target.name,available:true}};
}

export function unavailableScheduler(config:Config) {
  const target=schedulerSettings(config)!;
  // Unknown never falls back to changing or reporting the host's saved controls.
  return {version:1,running:false,enabled:false,active:null,bindings:[],counts:[],
    scheduler:{location:'guest',operator:target.operator,environment:target.name,available:false}};
}
