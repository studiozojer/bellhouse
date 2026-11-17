import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('guest controls use the selected account; failures never mutate or fall back to host state',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bellhouse-guest-'));mkdirSync(join(root,'local'));
  const mode=join(root,'mode'),calls=join(root,'calls'),fake=join(root,'fake limactl');
  writeFileSync(mode,'ok');
  writeFileSync(fake,`#!/usr/bin/env python3
import sys,json
from pathlib import Path
with open(${JSON.stringify(calls)},'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[1]=='list':
 print(json.dumps({'name':'operators','status':'Stopped'}));sys.exit(0)
if Path(${JSON.stringify(mode)}).read_text()=='offline':sys.exit(1)
if sys.argv[-1]!='--json':sys.exit(2)
root='/home/tycho/state/bellhouse'
if Path(${JSON.stringify(mode)}).read_text()=='wrong-account':root='/home/another/state/bellhouse'
print(json.dumps({'version':1,'root':root,'manifest':root+'/local/bellhouse.toml','running':True,'enabled':'enable' in sys.argv,'active':None,'bindings':[],'counts':[]}))
`,{mode:0o700});
  writeFileSync(join(root,'local/bellhouse.toml'),`enabled=true\n[environment]\nname="operators"\nlimactl=${JSON.stringify(fake)}\n[scheduler]\noperator="tycho"\n`);
  const run=async(command:string,binding?:string)=>{
    const p=Bun.spawn([process.execPath,join(import.meta.dir,'../control.ts'),command,...(binding?[binding]:[]),'--json'],{
      env:{...process.env,ARMILLARY_ROOT:root,BELLHOUSE_MANIFEST:join(root,'local/bellhouse.toml')},stdout:'pipe',stderr:'ignore',
    });return {code:await p.exited,output:await new Response(p.stdout).text()};
  };
  try {
    const initial=JSON.parse((await run('status')).output);expect(initial.scheduler.available).toBe(true);expect(initial.enabled).toBe(false);
    expect(JSON.parse((await run('enable','jera')).output).enabled).toBe(true);
    const invocations=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
    const enable=invocations.find(args=>args.includes('enable'));
    expect(enable.slice(0,7)).toEqual(['shell','--workdir=/','operators','sudo','-iu','tycho','env']);
    expect(enable.slice(-3)).toEqual(['enable','jera','--json']);
    writeFileSync(mode,'offline');
    const unavailable=JSON.parse((await run('status')).output);
    expect(unavailable.scheduler.available).toBe(false);expect(unavailable.enabled).toBe(false);
    expect((await run('enable')).code).toBe(1);
    expect((await run('disable')).code).toBe(1);
    writeFileSync(mode,'wrong-account');expect((await run('enable')).code).toBe(1);
    expect((await run('enable','x;touch bad')).code).toBe(1);
    expect(existsSync(join(root,'local/state/bellhouse.sqlite'))).toBe(false);
    const daemon=Bun.spawn([process.execPath,join(import.meta.dir,'../bellhouse.ts')],{
      env:{...process.env,ARMILLARY_ROOT:root},stdout:'ignore',stderr:'ignore',
    });expect(await daemon.exited).toBe(1);
    expect(existsSync(join(root,'local/state/bellhouse.sqlite'))).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
},15000);
