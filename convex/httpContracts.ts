import { INVOKE_ACTIONS } from "./invoke";
import { ACCOUNT_APPS } from "./permissions";

type JsonSchema = {
  type: "object";
  required?: readonly string[];
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "object";
      const?: string;
      enum?: readonly string[];
    }
  >;
};

export type PostContract = {
  method: "POST";
  body: JsonSchema;
  success: JsonSchema;
};

export const credentialsContract: PostContract = {
  method: "POST",
  body: {
    type: "object",
    required: ["passportId", "invokeKey", "platform"],
    properties: {
      passportId: { type: "string" },
      invokeKey: { type: "string" },
      platform: { type: "string", enum: ACCOUNT_APPS },
      refresh: { type: "boolean" },
    },
  },
  success: {
    type: "object",
    required: [
      "accessToken",
      "tokenType",
      "platform",
      "expiresAt",
      "expiresIn",
    ],
    properties: {
      accessToken: { type: "string" },
      tokenType: { type: "string", const: "Bearer" },
      platform: { type: "string", enum: ACCOUNT_APPS },
      expiresAt: { type: "number" },
      expiresIn: { type: "number" },
    },
  },
};

export const invokeContract: PostContract = {
  method: "POST",
  body: {
    type: "object",
    required: ["passportId", "invokeKey", "action"],
    properties: {
      passportId: { type: "string" },
      invokeKey: { type: "string" },
      action: { type: "string", enum: INVOKE_ACTIONS },
      args: { type: "object" },
    },
  },
  success: {
    type: "object",
    required: ["echo", "passport"],
    properties: {
      echo: { type: "object" },
      passport: { type: "string" },
    },
  },
};
