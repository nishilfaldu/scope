import type { AppId } from "./permissions";

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
    ctx: { passportName: string },
  ) => Promise<InvokeResult>;
};

async function demoEcho(
  args: Record<string, unknown>,
  ctx: { passportName: string },
): Promise<InvokeResult> {
  return {
    ok: true,
    status: 200,
    body: { echo: args, passport: ctx.passportName },
    error: null,
  };
}

const ACTIONS = {
  "demo.echo": { app: "demo", run: demoEcho },
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
  ctx: { passportName: string },
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
