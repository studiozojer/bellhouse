import { createHash } from "crypto";
import { join } from "path";

// Host-local file locks survive Bellhouse restarts. The in-memory set avoids
// spawning redundant lock wrappers during normal operation.
export function createCronRunner(root: string, report: (event: string, detail: string) => void) {
  const running = new Set<string>();
  return async (key: string, tag: string, argv: string[], env: Record<string, string | undefined>, timeoutSeconds = 900) => {
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) {
      report("handler.error", `${tag} invalid_timeout`);
      return 125;
    }
    if (running.has(key)) {
      report("handler.skip", `${tag} reason=overlap`);
      return 75;
    }
    running.add(key);
    try {
      const lock = createHash("sha256").update(key).digest("hex");
      const proc = Bun.spawn([
        env.PYTHON_BIN || "python3", join(import.meta.dir, "bin/run-cron.py"),
        "--lock", join(root, "local/state/cron-locks", lock + ".lock"),
        "--timeout", String(timeoutSeconds), "--", ...argv,
      ], { cwd: root, env, stdout: "ignore", stderr: "ignore" });
      report("handler.spawn", `${tag} pid=${proc.pid}`);
      const code = await proc.exited;
      if (code === 75) report("handler.skip", `${tag} reason=overlap`);
      else if (code === 124) report("handler.timeout", tag);
      report("handler.exit", `${tag} code=${code}`);
      return code;
    } catch {
      report("handler.error", `${tag} spawn_failed`);
      return 125;
    } finally {
      running.delete(key);
    }
  };
}
