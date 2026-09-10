import type { AppId } from "./permissions";
import {
  githubCreateBranch,
  githubIssuesComment,
  githubIssuesList,
  githubPullsCreate,
  githubReposGet,
  githubReposList,
} from "./github";

export type InvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error: string | null;
};

type ActionSpec = {
  app: AppId;
  run: (
    args: Record<string, unknown>,
    ctx: { passportName: string; githubToken: string | null },
  ) => Promise<InvokeResult>;
};

async function demoEcho(
  args: Record<string, unknown>,
  ctx: { passportName: string; githubToken: string | null },
): Promise<InvokeResult> {
  return {
    ok: true,
    status: 200,
    body: { echo: args, passport: ctx.passportName },
    error: null,
  };
}

export const ACTIONS = {
  "demo.echo": { app: "demo", run: demoEcho },
  "github.repos.list": { app: "github", run: githubReposList },
  "github.repos.get": { app: "github", run: githubReposGet },
  "github.issues.list": { app: "github", run: githubIssuesList },
  "github.issues.comment": { app: "github", run: githubIssuesComment },
  "github.git.createBranch": { app: "github", run: githubCreateBranch },
  "github.pulls.create": { app: "github", run: githubPullsCreate },
} as const satisfies Record<string, ActionSpec>;

export function lookupAction(action: string): ActionSpec | null {
  if (Object.hasOwn(ACTIONS, action)) {
    return ACTIONS[action as keyof typeof ACTIONS];
  }
  return null;
}

export async function runAction(
  spec: ActionSpec,
  args: Record<string, unknown>,
  ctx: { passportName: string; githubToken: string | null },
): Promise<InvokeResult> {
  try {
    return await spec.run(args, ctx);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid args";
    return {
      ok: false,
      status: 400,
      body: { error: message },
      error: message,
    };
  }
}
