#!/usr/bin/env node
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { loadConfig, saveConfig, login, logout } from "./oauth.mjs";
import { scopeCall } from "./api.mjs";
import { commandContext, runApproved } from "./run.mjs";
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
async function main() {
  const [operation, ...input] = process.argv.slice(2);
  const split = input.indexOf("--"),
    command = split >= 0 ? input.slice(split + 1) : [];
  const { values, positionals } = parseArgs({
    args: split >= 0 ? input.slice(0, split) : input,
    allowPositionals: true,
    options: {
      origin: { type: "string" },
      account: { type: "string" },
      reason: { type: "string" },
      env: { type: "string" },
      id: { type: "string" },
      timeout: { type: "string" },
    },
  });
  if (operation === "login") {
    if (values.origin) {
      const origin = new URL(values.origin);
      if (
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash ||
        origin.username ||
        origin.password ||
        (origin.protocol !== "https:" &&
          !(origin.protocol === "http:" && origin.hostname === "localhost"))
      )
        throw new Error("Invalid Scope origin");
      const response = await fetch(origin.origin + "/api/cli/config", {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Scope configuration unavailable");
      const config = await response.json();
      if (
        config.origin !== origin.origin ||
        typeof config.webClientId !== "string" ||
        typeof config.authkitDomain !== "string" ||
        !config.clientId
      )
        throw new Error("Invalid Scope configuration");
      // A different origin means a new private session; never carry refresh tokens across it.
      await saveConfig({
        origin: config.origin,
        webClientId: config.webClientId,
        authkitDomain: config.authkitDomain,
        clientId: config.clientId,
      });
    }
    await loadConfig();
    await login({ signal: controller.signal });
    return;
  }
  if (operation === "logout") {
    await logout();
    console.log(
      "Local Scope session removed. Stop the CLI connection in Agents to block pending approvals.",
    );
    return;
  }
  if (operation === "accounts") {
    console.log(JSON.stringify(await scopeCall("accounts", {}), null, 2));
    return;
  }
  if (operation === "status" && positionals.length === 1) {
    console.log(
      JSON.stringify(
        await scopeCall("status", { id: positionals[0] }),
        null,
        2,
      ),
    );
    return;
  }
  if (operation === "cancel" && positionals.length === 1) {
    await scopeCall("cancel", { id: positionals[0] });
    console.log("Request cancelled.");
    return;
  }
  if (operation === "run") {
    const timeoutMs = Number(values.timeout ?? 300) * 1000;
    if (
      !values.account ||
      !values.reason ||
      !values.env ||
      !command.length ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > 3_600_000
    )
      throw new Error(
        "Use scope run --account ID --reason PURPOSE --env SLACK_TOKEN [--id ID] [--timeout SECONDS] -- COMMAND",
      );
    const result = await runApproved(
      {
        accountId: values.account,
        reason: values.reason,
        key: values.id ?? randomUUID(),
        command: await commandContext(command, process.cwd(), values.env),
        timeoutMs,
      },
      { signal: controller.signal },
    );
    if (result.reason)
      console.error(`Command ${result.reason}. It will not be retried.`);
    process.exitCode = result.exitCode;
    return;
  }
  console.log(
    "scope login --origin URL\nscope logout\nscope accounts\nscope status REQUEST_ID\nscope cancel REQUEST_ID\nscope run --account ID --reason PURPOSE --env SLACK_TOKEN -- COMMAND",
  );
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error && !/token|oauth|fetch|lock/i.test(error.message)
      ? error.message
      : "Scope operation failed. Check sign-in and setup.",
  );
  process.exitCode = controller.signal.aborted ? 130 : 1;
}
