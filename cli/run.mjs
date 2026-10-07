import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { scopeCall } from "./api.mjs";

const baseEnv = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "COMSPEC",
  "PATHEXT",
];

export function childEnvironment(envVar, token, source = process.env) {
  if (
    !/^[A-Z_][A-Z0-9_]{0,63}$/.test(envVar) ||
    baseEnv.includes(envVar) ||
    /^(SCOPE|WORKOS|VERCEL|CONVEX|NODE|LD|DYLD)(_|$)/.test(envVar)
  )
    throw new Error("Choose a dedicated credential environment variable");
  const env = Object.fromEntries(
    baseEnv
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  env[envVar] = token;
  return env;
}

export async function executeCommand(
  { argv, envVar },
  token,
  { signal, timeoutMs = 300_000 } = {},
) {
  if (signal?.aborted) throw new Error("Command cancelled before execution");
  const child = spawn(argv[0], argv.slice(1), {
    env: childEnvironment(envVar, token),
    shell: false,
    stdio: "inherit",
  });
  let reason;
  const stop = (next) => {
    if (reason) return;
    reason = next;
    child.kill("SIGTERM");
  };
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const abort = () => stop("cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const code = await new Promise((resolve) => {
      child.once("error", () => resolve(127));
      child.once("close", (exitCode) => resolve(exitCode ?? 1));
    });
    if (reason === "cancelled") return { exitCode: 130, reason };
    if (reason === "timeout") return { exitCode: 124, reason };
    if (code === 127) return { exitCode: 127, reason: "start-failed" };
    return { exitCode: code };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function runApproved(
  { providerId, reason, command, timeoutMs },
  {
    call = scopeCall,
    signal,
    output = console.error,
    execute = executeCommand,
    wait = delay,
  } = {},
) {
  childEnvironment(command.envVar, "validation");
  const request = await call("request", { providerId, reason }, { signal });
  output(
    request.status === "approved"
      ? "Using an active approval."
      : `Approve in Scope: ${request.approvalUrl}`,
  );
  let status = request.status;
  while (status === "pending") {
    await wait(2000, undefined, { signal });
    ({ status } = await call("status", { id: request.id }, { signal }));
  }
  if (status !== "approved") throw new Error(`Request ${status}.`);
  const { accessToken } = await call("token", { id: request.id }, { signal });
  if (typeof accessToken !== "string" || !accessToken)
    throw new Error("Scope returned no token.");
  return execute(command, accessToken, { signal, timeoutMs });
}
