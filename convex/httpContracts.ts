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
    required: ["passportId", "invokeKey", "app"],
    properties: {
      passportId: { type: "string" },
      invokeKey: { type: "string" },
      app: { type: "string", enum: ACCOUNT_APPS },
      refresh: { type: "boolean" },
    },
  },
  success: {
    type: "object",
    required: [
      "accessToken",
      "tokenType",
      "app",
      "expiresAt",
      "expiresIn",
    ],
    properties: {
      accessToken: { type: "string" },
      tokenType: { type: "string", const: "Bearer" },
      app: { type: "string", enum: ACCOUNT_APPS },
      expiresAt: { type: "number" },
      expiresIn: { type: "number" },
    },
  },
};
