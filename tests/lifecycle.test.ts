import { test,expect } from 'bun:test';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { loadConfig,cronMatches,validCron } from '../src/config';
import { Runtime } from '../src/runtime';
import { State } from '../src/state';
const sleep=(n=30)=>Bun.sleep(n);
async function until(check:()=>boolean){const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Condition did not occur');await sleep();}}
function fixture(script="require('fs').appendFileSync(process.env.BELL_BINDING_DIR+'/state/effects','x');",extra=''){
 const root=mkdtempSync(join(tmpdir(),'bellhouse-'));mkdirSync(join(root,'local'));mkdirSync(join(root,'binding'));
 writeFileSync(join(root,'local/bellhouse.toml'),'enabled=false\n[server]\nport=0\nbind="127.0.0.1"\n[[bindings]]\nname="test"\npath="binding"\n[secrets]\ninput="fixture-secret"\n');
 writeFileSync(join(root,'handler.js'),script);
 writeFileSync(join(root,'binding/bells.toml'),`[[bells]]\nname="input"\n[[bells.handlers]]\ntype="shell"\nargv=${JSON.stringify([process.execPath,join(root,'handler.js')])}\n${extra}`);
 const config=loadConfig(root,join(root,'local/bellhouse.toml'));const state=new State(config);
 return{root,config,state,effects:join(root,'binding/state/effects'),cleanup:()=>{state.db.close();rmSync(root,{recursive:true,force:true});}};
}
async function ring(r:Runtime,body='{"message":"private fixture"}',token='fixture-secret'){
 return r.handle(new Request('http://localhost/bell/input',{method:'POST',headers:{'x-bell-token':token},body}));
}
test('disabled host persists through restart; rejected bells are not queued; control resumes without a new delivery',async()=>{
 const f=fixture();let r=new Runtime(f.config);
 try{
  expect((await ring(r)).status).toBe(503);expect(f.state.queued()).toHaveLength(0);
  f.state.set(true);expect((await ring(r)).status).toBe(200);
  await until(()=>existsSync(f.effects));await until(()=>!r.active);
  f.state.set(false);await r.stop();r=new Runtime(f.config);
  expect(r.status().enabled).toBe(false);expect((await ring(r)).status).toBe(503);
  f.state.set(true);expect(await(await ring(r)).json()).toEqual({ok:true,deduped:true});
  await sleep(100);expect(readFileSync(f.effects,'utf8')).toBe('x');
 }finally{await r.stop();f.cleanup();}
});
test('per-binding pause survives restart while host stays enabled',async()=>{
 const f=fixture();f.state.set(true);f.state.set(false,'test');let r=new Runtime(f.config);
 try{expect((await ring(r)).status).toBe(503);await r.stop();r=new Runtime(f.config);expect(r.status().enabled).toBe(true);expect(r.status().bindings[0].enabled).toBe(false);f.state.set(true,'test');await ring(r);await until(()=>existsSync(f.effects));}finally{await r.stop();f.cleanup();}
});
test('pause terminates active process group; remaining handlers do not run and uncertain work is retained',async()=>{
 const f=fixture("require('fs').writeFileSync(process.env.BELL_BINDING_DIR+'/state/started','yes');setTimeout(()=>require('fs').writeFileSync(process.env.BELL_BINDING_DIR+'/state/effects','late'),2000);setInterval(()=>{},100);");
 f.state.set(true);let r=new Runtime(f.config);
 try{
  await ring(r);await until(()=>existsSync(join(f.root,'binding/state/started')));
  f.state.set(false);r.observe();await until(()=>!r.active);expect(existsSync(f.effects)).toBe(false);
  expect((f.state.counts() as any[]).some(x=>x.status==='interrupted'&&x.count===1)).toBe(true);
  await r.stop();f.state.set(true);r=new Runtime(f.config);await sleep(150);expect(r.active).toBe(null);expect(existsSync(f.effects)).toBe(false);
 }finally{await r.stop();f.cleanup();}
});
test('queued delivery survives a paused restart; changed handler config is held for review',async()=>{
 const f=fixture();f.state.set(true);let r=new Runtime(f.config);
 try{
  r.active={job:{binding:'test'},controller:new AbortController()} as any;await ring(r);r.active=null;
  f.state.set(false);await r.stop();r=new Runtime(f.config);expect(f.state.queued()).toHaveLength(1);
  f.state.set(true);await r.drain();expect(readFileSync(f.effects,'utf8')).toBe('x');
  r.active={job:{binding:'test'},controller:new AbortController()} as any;await ring(r,'{"message":"second"}');r.active=null;await r.stop();
  const file=join(f.root,'binding/bells.toml');writeFileSync(file,readFileSync(file,'utf8').replace('type="shell"','enabled=false\ntype="shell"'));
  r=new Runtime(loadConfig(f.root,join(f.root,'local/bellhouse.toml')));await until(()=>(f.state.counts() as any[]).some(x=>x.status==='configuration-changed'));
  expect(readFileSync(f.effects,'utf8')).toBe('x');expect((f.state.counts() as any[]).some(x=>x.status==='configuration-changed')).toBe(true);
 }finally{await r.stop();f.cleanup();}
});
test('current-minute cron is durable across daemon restart; wake scans occur once without replaying sleeping minutes',async()=>{
 const f=fixture("",'[[crons]]\nname="poll"\nschedule="* * * * *"\non_resume=true\n');f.state.set(true);let r=new Runtime(f.config);
 try{
  await until(()=>!r.active);const before=(f.state.db.query('SELECT count(*) AS n FROM jobs').get() as any).n;
  await r.stop();r=new Runtime(f.config);expect((f.state.db.query('SELECT count(*) AS n FROM jobs').get() as any).n).toBe(before);
  const future=new Date(Date.now()+8*3600_000);r.tick(future);expect((f.state.db.query('SELECT count(*) AS n FROM jobs').get() as any).n).toBe(before+1);
  r.tick(future);expect((f.state.db.query('SELECT count(*) AS n FROM jobs').get() as any).n).toBe(before+1);
 }finally{await r.stop();f.cleanup();}
});
test('private payloads stay inside binding wall; auth/size refusals and status contain no content',async()=>{
 const f=fixture();f.state.set(true);const r=new Runtime(f.config);
 try{
  expect((await ring(r,'sensitive','wrong')).status).toBe(403);
  expect((await ring(r,'é'.repeat(140000))).status).toBe(413);
  await ring(r,'{"message":"sensitive fixture text"}');await until(()=>!r.active);
  expect(JSON.stringify(r.status())).not.toContain('sensitive fixture text');
  expect(readFileSync(join(f.root,'local/state/bellhouse.log'),'utf8')).not.toContain('sensitive fixture text');
 }finally{await r.stop();f.cleanup();}
});
test('cron validation refuses zero steps and invalid ranges',()=>{
 expect(validCron('*/0 * * * *')).toBe(false);expect(validCron('61 * * * *')).toBe(false);expect(validCron('* * * * *')).toBe(true);expect(cronMatches('*/5 * * * *',new Date(2026,10,10,12,15))).toBe(true);
});
test('pause also kills a stubborn descendant after its parent exits',async()=>{
 const child="process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.env.BELL_BINDING_DIR+'/state/child-started','yes');setTimeout(()=>require('fs').writeFileSync(process.env.BELL_BINDING_DIR+'/state/effects','escaped'),3000);setInterval(()=>{},100);";
 const f=fixture(`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setInterval(()=>{},100);`);
 f.state.set(true);const r=new Runtime(f.config);
 try{
  await ring(r);await until(()=>existsSync(join(f.root,'binding/state/child-started')));
  f.state.set(false);r.observe();await until(()=>!r.active);await sleep(1200);
  expect(existsSync(f.effects)).toBe(false);
  expect((f.state.counts() as any[]).some(x=>x.status==='interrupted')).toBe(true);
 }finally{await r.stop();f.cleanup();}
});
test('pausing a cron waits for wrapper cleanup and retains interruption',async()=>{
 const f=fixture("require('fs').writeFileSync(process.env.BELL_BINDING_DIR+'/state/started','yes');setInterval(()=>{},100);",'[[crons]]\nname="poll"\nschedule="* * * * *"\ntimeout_seconds=60\n');
 f.config.bindings[0].crons[0].handlers=f.config.bindings[0].bells[0].handlers;
 f.state.set(true);const r=new Runtime(f.config);
 try{
  await until(()=>existsSync(join(f.root,'binding/state/started')));
  f.state.set(false);r.observe();
  await sleep(2200);expect(r.active).not.toBe(null);
  await r.stop();expect((f.state.counts() as any[]).some(x=>x.status==='interrupted')).toBe(true);
 }finally{await r.stop();f.cleanup();}
},15000);
