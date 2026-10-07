#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { scopeCall } from "./api.mjs";
import {
  loadConfig,
  removeConfig,
  saveConfig,
  validOrigin,
  validToken,
} from "./config.mjs";
import { runApproved } from "./run.mjs";

const usage = `scope login --origin URL     Save an agent token (from Scope → Agents)
scope logout                 Remove the saved agent token
scope run PROVIDER --reason TEXT --env VAR [--timeout SECONDS] -- COMMAND

The person approves each request in Scope and picks the account and duration.
The token carries every permission granted when the account was connected.
The reason is shown to the person. It does not restrict the token.`;

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

async function readToken() {
  if (process.env.SCOPE_TOKEN) return process.env.SCOPE_TOKEN.trim();
  if (!process.stdin.isTTY) return (await text(process.stdin)).trim();
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  process.stdout.write("Agent token: ");
  // Keep the pasted token out of the terminal scrollback.
  prompt._writeToOutput = () => {};
  try {
    return (await prompt.question("")).trim();
  } finally {
    prompt.close();
    process.stdout.write("\n");
  }
}

async function login(origin) {
  const saved = origin ? null : await loadConfig().catch(() => null);
  if (!origin && !saved) throw new Error("Use scope login --origin URL");
  const config = {
    origin: origin ? validOrigin(origin) : saved.origin,
    token: await readToken(),
  };
  if (!validToken(config.token))
    throw new Error("Paste the agent token shown in Scope → Agents.");
  const { name } = await scopeCall("whoami", {}, { config });
  await saveConfig(config);
  console.log(`Signed in as agent "${name}".`);
}

async function main() {
  const [operation, ...input] = process.argv.slice(2);
  const split = input.indexOf("--"),
    command = split >= 0 ? input.slice(split + 1) : [];
  const { values, positionals } = parseArgs({
    args: split >= 0 ? input.slice(0, split) : input,
    allowPositionals: true,
    options: {
      origin: { type: "string" },
      reason: { type: "string" },
      env: { type: "string" },
      timeout: { type: "string" },
    },
  });
  if (operation === "login") return login(values.origin);
  if (operation === "logout") {
    await removeConfig();
    console.log(
      "Agent token removed from this machine. Delete the agent in Scope to revoke it.",
    );
    return;
  }
  if (operation === "run") {
    const timeoutMs = Number(values.timeout ?? 300) * 1000;
    if (
      positionals.length !== 1 ||
      !values.reason?.trim() ||
      !values.env ||
      !command.length ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > 3_600_000
    )
      throw new Error(usage);
    const result = await runApproved(
      {
        providerId: positionals[0],
        reason: values.reason.trim(),
        command: { argv: command, envVar: values.env },
        timeoutMs,
      },
      { signal: controller.signal },
    );
    if (result.reason) console.error(`Command ${result.reason}.`);
    process.exitCode = result.exitCode;
    return;
  }
  console.log(usage);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Scope failed.");
  process.exitCode = controller.signal.aborted ? 130 : 1;
}
