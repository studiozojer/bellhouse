import { loadConfig } from './src/config';
import { Runtime } from './src/runtime';
process.umask(0o077);
try {
  const runtime=new Runtime(loadConfig());
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void runtime.stop().then(()=>process.exit(0));});
} catch {
  // Config/child failures may carry secret values or private paths.
  console.error('Bellhouse could not start. Check the local manifest, binding files and listening port.');
  process.exitCode=1;
}
