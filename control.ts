import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './src/config';
import { State } from './src/state';
process.umask(0o077);
export async function status(config=loadConfig()) {
  const state=new State(config);
  const address=config.local.server?.bind??'127.0.0.1';
  const host=['0.0.0.0','::'].includes(address)?'127.0.0.1':address;
  const port=config.local.server?.port??7787;
  try {
    const r=await fetch(`http://${host.includes(':')?'['+host+']':host}:${port}/status`,{signal:AbortSignal.timeout(700)});
    if(r.ok){const value=await r.json();if(value.root===config.root&&value.manifest===config.manifest){state.db.close();return value;}}
  }catch{}
  const result={version:1,root:config.root,manifest:config.manifest,running:false,enabled:state.enabled(),revision:state.revision(),active:null,counts:state.counts(),bindings:config.bindings.map(b=>({name:b.name,enabled:state.bindingEnabled(b.name),active:false,counts:state.counts(b.name)}))};
  state.db.close();return result;
}
export async function change(enabled:boolean,binding?:string){
  const config=loadConfig(),state=new State(config);state.set(enabled,binding);
  const revision=state.revision();state.db.close();
  const deadline=Date.now()+15000;let value:any;
  do{
    value=await status(config);
    const active=binding?value.active?.binding===binding:!!value.active;
    if(!value.running||(value.observedRevision>=revision&&(enabled||!active)))return value;
    await Bun.sleep(75);
  }while(Date.now()<deadline);
  throw Error('Pause persisted, but active work has not stopped. Check status.');
}
if(import.meta.main){
  try{
    const args=process.argv.slice(2);const command=args.shift()??'status';
    if(command==='init'){
      const root=process.env.ARMILLARY_ROOT;
      if(!root)throw Error('Set ARMILLARY_ROOT for init.');
      const path=process.env.BELLHOUSE_MANIFEST??join(root,'local/bellhouse.toml');mkdirSync(join(root,'local'),{recursive:true,mode:0o700});
      writeFileSync(path,'# This host starts paused. Use bellhouse enable when ready.\nenabled = false\n\n[server]\nbind = "127.0.0.1"\nport = 7787\n',{mode:0o600,flag:'wx'});
      console.log('Initialized a paused bellhouse.');
    }else{
      const json=args.includes('--json');const rest=args.filter(x=>x!=='--json');
      if(!['enable','disable','status'].includes(command)||rest.length>1||(command==='status'&&rest.length))throw Error('Usage: bellhouse status [--json] | enable [binding] | disable [binding]');
      const value=command==='status'?await status():await change(command==='enable',rest[0]);
      if(json)console.log(JSON.stringify(value));else{
        console.log(`Bellhouse ${value.enabled?'enabled':'disabled'} · ${value.running?'service running':'service stopped'}${value.active?' · working':''}`);
        for(const b of value.bindings)console.log(`  ${b.name}: ${b.enabled?'enabled':'disabled'}${b.active?' · working':''}`);
        const attention=(value.counts as any[]).filter(x=>['interrupted','failed','configuration-changed'].includes(x.status)).reduce((n,x)=>n+x.count,0);
        if(attention)console.log(`  ${attention} execution(s) need review; uncertain effects are not automatically repeated.`);
      }
    }
  }catch{
    console.error('Bellhouse control failed. Check the command, local manifest and service status; a requested pause may already be persisted.');process.exitCode=1;
  }
}
