# Agent Passport client

This small ESM client implements the agent side of the HTTP approval and credential flow. It has no runtime dependencies. Build with `pnpm --dir agent-client build` and install the package from this directory in the agent's Node project. It is private until a versioned package is published.

```ts
import { AgentPassportClient } from "@agent-passport/client";
import { FileAgentPassportStore } from "@agent-passport/client/file-store";

const passport = new AgentPassportClient({
  baseUrl: "https://YOUR-DEPLOYMENT.convex.site",
  store: new FileAgentPassportStore("/private/agent-state/customer-task.json"),
});

const access = await passport.requestAccess({
  agentName: "Customer support agent",
  apps: ["gmail"],
  ttlMs: 60 * 60 * 1000,
  reason: "Draft a reply to the customer",
});
if (access.status === "approval_required") {
  // Send only access.approvalUrl to the human. Resume the task after approval.
  console.log(access.approvalUrl);
}

// These calls can run in a later process with the same private store path.
await passport.waitForAccess();
const credential = await passport.getCredential("gmail");
if (credential.status === "approval_required") {
  console.log(credential.approvalUrl); // Send only the URL to the human.
  const token = await passport.waitForCredential("gmail");
  // Pass token.accessToken directly to the provider tool; never print it.
} else {
  // Pass credential.value.accessToken directly to the provider tool.
}
```

Use one store per agent task. The file store writes with owner-only permissions; place the path outside repositories, logs, and synchronized folders. Keep the approval URL in chat, and keep the claim handle, slice secret, and provider token out of chat. `capabilities()` reads the public app catalog before requesting access. `AgentPassportError` exposes `code`, `retryable`, and `nextAction` for recovery. Call `waitForAccess` or `waitForCredential` with an `AbortSignal` to stop waiting when the agent task is cancelled.

The store saves the idempotency key before sending a request, so a restart can retry the same request without a second approval. An approved slice handoff can be claimed again with the same private handle during its short claim window if a process stops before saving the response.
