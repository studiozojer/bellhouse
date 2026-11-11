import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config';
export class State {
  db:Database;
  constructor(public config:Config) {
    mkdirSync(config.state,{recursive:true,mode:0o700});
    const path=join(config.state,'bellhouse.sqlite');this.db=new Database(path,{create:true});chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,binding TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,payload TEXT NOT NULL,configHash TEXT NOT NULL,slot TEXT UNIQUE,status TEXT NOT NULL,created INTEGER NOT NULL,finished INTEGER,exitCode INTEGER);
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created);
      CREATE TABLE IF NOT EXISTS dedup(name TEXT NOT NULL,hash TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(name,hash));`);
  }
  value(key:string,fallback:boolean){const row=this.db.query('SELECT value FROM settings WHERE key=?').get(key) as any;return row?row.value==='true':fallback;}
  enabled(){return this.value('enabled',this.config.local.enabled!==false);}
  bindingEnabled(name:string){const b=this.config.bindings.find(b=>b.name===name);return !!b&&this.value('binding:'+name,b.enabled);}
  revision(){return Number((this.db.query("SELECT value FROM settings WHERE key='revision'").get() as any)?.value??0);}
  set(enabled:boolean,binding?:string){
    if(binding&&!this.config.bindings.some(b=>b.name===binding))throw Error('Unknown binding');
    this.db.transaction(()=>{
      this.db.query('INSERT OR REPLACE INTO settings VALUES(?,?)').run(binding?'binding:'+binding:'enabled',String(enabled));
      this.db.query("INSERT OR REPLACE INTO settings VALUES('revision',?)").run(String(this.revision()+1));
    }).immediate();
  }
  permitted(binding:string){return this.enabled()&&this.bindingEnabled(binding);}
  recover(){this.db.query("UPDATE jobs SET status='interrupted',finished=? WHERE status='running'").run(Date.now());}
  enqueue(job:any,dedup?:{hash:string;window:number}){
    return this.db.transaction(()=>{
      if(dedup){const old=this.db.query('SELECT at FROM dedup WHERE name=? AND hash=?').get(job.source,dedup.hash) as any;if(old&&Date.now()-old.at<dedup.window)return false;}
      const r=this.db.query("INSERT OR IGNORE INTO jobs(id,binding,source,kind,name,payload,configHash,slot,status,created) VALUES(?,?,?,?,?,?,?,?,'queued',?)").run(job.id,job.binding,job.source,job.kind,job.name,job.payload,job.configHash,job.slot??null,Date.now());
      if(!r.changes)return false;
      if(dedup)this.db.query('INSERT OR REPLACE INTO dedup VALUES(?,?,?)').run(job.source,dedup.hash,Date.now());
      return true;
    }).immediate();
  }
  queued(){return this.db.query("SELECT * FROM jobs WHERE status='queued' ORDER BY created,id").all() as any[];}
  finish(id:string,status:string,code:number|null=null){this.db.query('UPDATE jobs SET status=?,finished=?,exitCode=? WHERE id=?').run(status,Date.now(),code,id);}
  counts(binding?:string){return this.db.query('SELECT status,count(*) AS count FROM jobs'+(binding?' WHERE binding=?':'')+' GROUP BY status').all(...(binding?[binding]:[]));}
}
