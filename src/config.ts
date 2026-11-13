import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
export type Handler = {type:'shell'|'agent'|'push';enabled?:boolean;argv?:string[];prompt_file?:string;claude_args?:string[];title_template?:string;body_template?:string;data_template?:Record<string,string>};
export type Bell = {name:string;enabled?:boolean;dedup_window_seconds?:number;handlers?:Handler[]};
export type Cron = {name:string;schedule:string;enabled?:boolean;on_resume?:boolean;timeout_seconds?:number;handlers?:Handler[]};
export type Binding = {name:string;path:string;dir:string;enabled:boolean;bells:Bell[];crons:Cron[]};
export function loadConfig(root=resolve(process.env.ARMILLARY_ROOT??resolve(import.meta.dir,'../../..')),manifest=process.env.BELLHOUSE_MANIFEST??resolve(root,'local/bellhouse.toml')) {
  const local=Bun.TOML.parse(readFileSync(manifest,'utf8')) as any;
  const names=new Set<string>(),bells=new Set<string>();
  const bindings:Binding[]=(local.bindings??[]).map((b:any)=>{
    if(!/^[a-zA-Z0-9_-]+$/.test(b.name)||names.has(b.name)||typeof b.path!=='string')throw Error('Invalid or duplicate binding');
    names.add(b.name);
    const dir=resolve(root,b.path),file=resolve(dir,'bells.toml');
    if(!existsSync(file))throw Error('Binding manifest unavailable: '+b.name);
    const c=Bun.TOML.parse(readFileSync(file,'utf8')) as any;
    for(const entry of [...(c.bells??[]),...(c.crons??[])])if(!/^[a-zA-Z0-9_-]+$/.test(entry.name))throw Error('Invalid bell/cron name');
    for(const bell of c.bells??[]){if(bells.has(bell.name))throw Error('Duplicate bell name');bells.add(bell.name);}
    for(const cron of c.crons??[])if(!validCron(cron.schedule))throw Error('Invalid cron schedule: '+cron.name);
    for(const cron of c.crons??[])if(cron.timeout_seconds!==undefined&&(!Number.isInteger(cron.timeout_seconds)||cron.timeout_seconds<1||cron.timeout_seconds>86400))throw Error('Invalid cron timeout');
    if(new Set((c.crons??[]).map((x:any)=>x.name)).size!==(c.crons??[]).length)throw Error('Duplicate cron name');
    for(const entry of [...(c.bells??[]),...(c.crons??[])])for(const h of entry.handlers??[]){
      if(!['shell','agent','push'].includes(h.type))throw Error('Unknown handler');
      if(h.type==='shell'&&(!Array.isArray(h.argv)||!h.argv.length||!h.argv.every((a:unknown)=>typeof a==='string')))throw Error('Invalid handler argv');
      if(h.type==='agent'&&typeof h.prompt_file!=='string')throw Error('Missing agent prompt');
    }
    return {...b,dir,enabled:b.enabled!==false,bells:c.bells??[],crons:c.crons??[]};
  });
  return {root,manifest:resolve(manifest),local,bindings,state:resolve(root,'local/state')};
}
export type Config=ReturnType<typeof loadConfig>;
const limits=[[0,59],[0,23],[1,31],[1,12],[0,6]];
export function validCron(schedule:unknown):schedule is string {
  if(typeof schedule!=='string')return false;
  const fields=schedule.trim().split(/\s+/);if(fields.length!==5)return false;
  return fields.every((f,i)=>f.split(',').every(part=>{
    if(part==='*')return true;
    const step=/^\*\/(\d+)$/.exec(part);if(step)return Number(step[1])>=1&&Number(step[1])<=limits[i][1]+1;
    const range=/^(\d+)-(\d+)$/.exec(part);if(range)return Number(range[1])>=limits[i][0]&&Number(range[2])<=limits[i][1]&&Number(range[1])<=Number(range[2]);
    return /^\d+$/.test(part)&&Number(part)>=limits[i][0]&&Number(part)<=limits[i][1];
  }));
}
export function cronMatches(schedule:string,d:Date) {
  const values=[d.getMinutes(),d.getHours(),d.getDate(),d.getMonth()+1,d.getDay()];
  return schedule.trim().split(/\s+/).every((f,i)=>f.split(',').some(p=>{
    if(p==='*')return true;const step=/^\*\/(\d+)$/.exec(p);if(step)return values[i]%Number(step[1])===0;
    const range=/^(\d+)-(\d+)$/.exec(p);return range?values[i]>=Number(range[1])&&values[i]<=Number(range[2]):Number(p)===values[i];
  }));
}
