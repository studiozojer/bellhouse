import { test, expect } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createCronRunner } from "./cron-runner";

test("cron skips overlap within a process and across independent runners, then releases its lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "bellhouse-cron-"));
  const events: string[] = [];
  const report = (event: string, detail: string) => events.push(event + " " + detail);
  const run = createCronRunner(root, report), other = createCronRunner(root, report);
  try {
    const first = run("same", "synthetic", ["python3", "-c", "import time; time.sleep(0.8)"], process.env, 10);
    expect(await run("same", "synthetic", ["false"], process.env, 10)).toBe(75);
    await Bun.sleep(250);
    expect(await other("same", "synthetic", ["false"], process.env, 10)).toBe(75);
    expect(await first).toBe(0);
    expect(await other("same", "synthetic", ["true"], process.env, 10)).toBe(0);
    expect(events.some(e=>e.startsWith("handler.skip"))).toBe(true);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("independent jobs proceed and handler exits retain their status", async()=>{
 const root=await mkdtemp(join(tmpdir(),"bellhouse-cron-"));const run=createCronRunner(root,()=>{});
 try { expect(await Promise.all([run("a","synthetic",["true"],process.env),run("b","synthetic",["sh","-c","exit 7"],process.env)])).toEqual([0,7]);
 expect(await run("a","synthetic",["true"],process.env,0)).toBe(125);
 }finally{await rm(root,{recursive:true,force:true});}
});
