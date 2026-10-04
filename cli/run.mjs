import { isDeepStrictEqual } from "node:util";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { readFile, lstat, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { configPath } from "./oauth.mjs";
import { scopeCall } from "./api.mjs";
import { validCommand } from "../shared/contracts.mjs";
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
export function secretVariants(secrets) {
  return [
    ...new Set(
      secrets
        .filter((s) => typeof s === "string" && s.length)
        .flatMap((secret) => [
          secret,
          encodeURIComponent(secret),
          Buffer.from(secret).toString("base64"),
          Buffer.from(secret).toString("base64url"),
          Buffer.from(secret).toString("hex"),
        ]),
    ),
  ].sort((a, b) => b.length - a.length);
}
export function streamRedactor(secrets, emit) {
  const variants = secretVariants(secrets),
    longest = Math.max(1, ...variants.map((s) => s.length));
  const decoder = new StringDecoder("utf8");
  let pending = "";
  function drain(final = false) {
    let safe = "",
      consumed = 0;
    while (
      consumed < pending.length &&
      (final || pending.length - consumed >= longest)
    ) {
      const match = variants.find((secret) =>
        pending.startsWith(secret, consumed),
      );
      if (match) {
        safe += "[REDACTED]";
        consumed += match.length;
      } else {
        safe += pending[consumed];
        consumed++;
      }
    }
    pending = pending.slice(consumed);
    if (safe) emit(safe);
  }
  return {
    write(chunk) {
      pending += decoder.write(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      );
      drain();
    },
    end() {
      pending += decoder.end();
      drain(true);
    },
  };
}
export async function commandContext(argv, cwd, envVar) {
  const command = { argv: [...argv], cwd: resolve(cwd), envVar };
  if (!validCommand(command)) throw new Error("Invalid command");
  childEnvironment(envVar, "validation");
  return command;
}
export async function executeCommand(
  command,
  token,
  {
    signal,
    timeoutMs = 300_000,
    outputLimit = 1_048_576,
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
    secrets = [],
  } = {},
) {
  if (signal?.aborted) throw new Error("Command cancelled before execution");
  const env = childEnvironment(command.envVar, token),
    child = spawn(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  let bytes = 0,
    stopReason,
    killTimer,
    drainTimer,
    finish;
  const stop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    const kill = (sig) => {
      try {
        if (process.platform === "win32") child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch {}
    };
    kill("SIGTERM");
    killTimer = setTimeout(() => {
      kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      finish?.(null, null);
    }, 1000);
  };
  const out = streamRedactor([token, ...secrets], stdout),
    err = streamRedactor([token, ...secrets], stderr);
  const consume = (redactor) => (chunk) => {
    bytes += chunk.length;
    if (bytes <= outputLimit) redactor.write(chunk);
    else stop("output-limit");
  };
  child.stdout.on("data", consume(out));
  child.stderr.on("data", consume(err));
  const abort = () => stop("cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  try {
    return await new Promise((resolveResult) => {
      let done = false;
      finish = (code, terminatedBy) => {
        if (done) return;
        done = true;
        resolveResult({
          exitCode:
            stopReason === "cancelled"
              ? 130
              : stopReason === "timeout"
                ? 124
                : stopReason === "output-limit"
                  ? 125
                  : (code ?? 128),
          ...(stopReason
            ? { reason: stopReason }
            : terminatedBy
              ? { reason: "signal" }
              : {}),
        });
      };
      child.once("error", () => {
        if (!done) {
          done = true;
          resolveResult({ exitCode: 127, reason: "start-failed" });
        }
      });
      child.once("close", finish);
      // Detached descendants can inherit pipes. Bound draining after the main child exits.
      child.once("exit", (code, terminatedBy) => {
        drainTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(code, terminatedBy);
        }, 100);
      });
    });
  } finally {
    if (stopReason && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(drainTimer);
    child.stdout.destroy();
    child.stderr.destroy();
    signal?.removeEventListener("abort", abort);
    out.end();
    err.end();
  }
}
async function saveJournal(path, journal) {
  const temp = path + ".new";
  await writeFile(temp, JSON.stringify(journal), { mode: 0o600 });
  await rename(temp, path);
}
export async function runApproved(
  { accountId, reason, agentName = "CLI", command, key, timeoutMs },
  {
    call = scopeCall,
    signal,
    output = console.error,
    execute = executeCommand,
    wait = delay,
    journalRoot = join(dirname(configPath), "runs"),
  } = {},
) {
  if (
    !/^[A-Za-z0-9_-]{16,128}$/.test(key) ||
    !accountId ||
    !reason?.trim() ||
    reason.length > 1000
  )
    throw new Error("Invalid invocation");
  await mkdir(journalRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(journalRoot);
  if (
    !info.isDirectory() ||
    info.mode & 0o077 ||
    info.uid !== process.getuid?.()
  )
    throw new Error("Invocation directory must be private");
  const path = join(journalRoot, key + ".json");
  try {
    await writeFile(path, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { retries: 0 });
  let journal;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.mode & 0o077 || info.uid !== process.getuid?.())
      throw new Error("Invocation file must be private");
    journal = JSON.parse(await readFile(path, "utf8"));
    const invocation = { accountId, reason: reason.trim(), agentName, command };
    if (
      journal.invocation &&
      !isDeepStrictEqual(journal.invocation, invocation)
    )
      throw new Error(
        "Invocation changed. Use a new ID for changed commands or accounts.",
      );
    if (["running", "finished"].includes(journal.state))
      throw new Error(
        "This invocation already started. Its command will not be retried.",
      );
    journal.invocation = invocation;
    // Persist the stable key before any approval request. Provider tokens are never journaled.
    await saveJournal(path, journal);
    const request = await call(
      "request",
      { accountId, reason: reason.trim(), agentName },
      { signal },
    );
    journal.requestId = request.id;
    await saveJournal(path, journal);
    output(
      `Invocation ${key}\n${request.status === "active" ? "Active approval" : "Approve"}: ${request.approvalUrl}`,
    );
    let context;
    for (;;) {
      if (signal?.aborted) throw new Error("Request cancelled");
      context = await call("status", { id: request.id }, { signal });
      if (context.status !== "pending") break;
      await wait(1000, undefined, { signal });
    }
    if (context.status !== "active")
      throw new Error(`Access ${context.status}`);
    if (context.accountId !== accountId)
      throw new Error("Approval does not match this account");
    const credential = await call("deliver", { id: request.id }, { signal });
    if (
      credential.status !== "ready" ||
      !credential.accessToken ||
      credential.accountId !== accountId ||
      credential.requestId !== request.id ||
      credential.grantVersion !== context.grantVersion ||
      JSON.stringify(credential.grantedScopes) !==
        JSON.stringify(context.snapshot.grantedScopes) ||
      typeof credential.until !== "number" ||
      !Number.isFinite(credential.until) ||
      credential.until <= Date.now()
    )
      throw new Error("Credential does not match this approval");
    await call(
      "receipt",
      { id: request.id, receiptProof: credential.receiptProof },
      { signal },
    );
    if (signal?.aborted) throw new Error("Command cancelled before execution");
    journal.state = "running";
    await saveJournal(path, journal);
    const result = await execute(command, credential.accessToken, {
      signal,
      timeoutMs,
    });
    journal.state = "finished";
    journal.result = result;
    await saveJournal(path, journal);
    return result;
  } finally {
    await release();
  }
}
