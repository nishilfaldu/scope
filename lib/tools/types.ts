import type { ZodRawShape } from "zod";

// A message the model may see. Other errors are reported without details.
export class ToolFailure extends Error {}

export type ToolImplementation = {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  // One line shown on the approval request. It may look up names with the token.
  summary(input: never, token: string): string | Promise<string>;
  // A string is returned to the app as is; anything else as JSON.
  run(token: string, input: never): Promise<unknown>;
};
