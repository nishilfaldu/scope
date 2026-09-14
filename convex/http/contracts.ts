import { ALL_APPS } from "../domain/apps";

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
    required: ["passportToken", "passportSecret", "app"],
    properties: {
      passportToken: { type: "string" },
      passportSecret: { type: "string" },
      app: { type: "string", enum: ALL_APPS },
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
      app: { type: "string", enum: ALL_APPS },
      expiresAt: { type: "number" },
      expiresIn: { type: "number" },
    },
  },
};
