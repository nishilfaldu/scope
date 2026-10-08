import { z } from "zod";
import type { ToolImplementation } from "./types";
import { callUpstream, proxy } from "./upstream";

const server = "https://mcp.vercel.com";
const proxied = proxy(server, "vercel");

const team = {
  teamId: z
    .string()
    .max(100)
    .optional()
    .describe("Team ID. Get it from a project or deployment."),
  slug: z
    .string()
    .max(100)
    .optional()
    .describe("Team slug, instead of teamId."),
};
const idOrName = z.string().min(1).max(200).describe("Project ID or name"),
  projectId = z.string().min(1).max(200).describe("Project ID"),
  deploymentId = z.string().min(1).max(300).describe("Deployment ID or URL"),
  limit = z.number().int().min(1).max(100).optional(),
  epochMs = z.number().int().min(0).optional();

type Team = { teamId?: string; slug?: string };

// The name comes from Vercel, so the model cannot mislabel the deployment.
async function deploymentName(token: string, id: string, scope: Team) {
  if (!token) return id;
  try {
    const text = await callUpstream(server, token, "get_deployment", {
      idOrUrl: id,
      ...scope,
    });
    const body = JSON.parse(text);
    const d = body.result ?? body;
    return d.url ? `${d.url}${d.target ? ` (${d.target})` : ""}` : id;
  } catch {
    return id;
  }
}

export const vercelTools: ToolImplementation[] = [
  proxied<{ search?: string }>(
    "list_projects",
    "List projects. Pass teamId or slug for a team's projects.",
    {
      search: z.string().max(200).optional(),
      limit: z
        .string()
        .regex(/^\d{1,3}$/)
        .optional(),
      from: z.string().max(100).optional(),
      ...team,
    },
    (input) =>
      input.search
        ? `List projects matching "${input.search.slice(0, 100)}"`
        : "List projects",
  ),
  proxied<{ idOrName: string }>(
    "get_project",
    "Read one project's settings.",
    { idOrName, ...team },
    (input) => `Read project ${input.idOrName}`,
  ),
  proxied(
    "list_deployments",
    "List deployments, newest first. Filter by projectId, target, state, branch or sha.",
    {
      projectId: projectId.optional(),
      target: z.enum(["production", "preview"]).optional(),
      state: z.string().max(100).optional(),
      branch: z.string().max(250).optional(),
      sha: z.string().max(100).optional(),
      limit,
      since: epochMs,
      until: epochMs,
      ...team,
    },
    () => "List deployments",
  ),
  proxied<{ idOrUrl: string }>(
    "get_deployment",
    "Read one deployment.",
    { idOrUrl: deploymentId, ...team },
    (input) => `Read deployment ${input.idOrUrl}`,
  ),
  proxied<{ idOrUrl: string }>(
    "list_deployment_events",
    "Read a deployment's build logs.",
    {
      idOrUrl: deploymentId,
      direction: z.enum(["backward", "forward"]).optional(),
      limit: z.number().int().min(1).max(2000).optional(),
      since: epochMs,
      until: epochMs,
      ...team,
    },
    (input) => `Read build logs for ${input.idOrUrl}`,
  ),
  proxied<{ projectId: string }>(
    "get_runtime_logs",
    "Read runtime logs for a project.",
    {
      projectId,
      teamId: z.string().min(1).max(100),
      deploymentId: z.string().max(300).optional(),
      environment: z.enum(["production", "preview"]).optional(),
      level: z.array(z.string().max(20)).max(10).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      query: z.string().max(500).optional(),
      requestId: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    (input) => `Read runtime logs for ${input.projectId}`,
  ),
  proxied<{ projectId: string }>(
    "get_runtime_errors",
    "Read grouped runtime errors for a project.",
    {
      projectId,
      teamId: z.string().min(1).max(100),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      routes: z.string().max(1000).optional(),
    },
    (input) => `Read runtime errors for ${input.projectId}`,
  ),
  proxied<{ idOrName: string }>(
    "list_project_domains",
    "List a project's domains.",
    { idOrName, limit, ...team },
    (input) => `List domains of ${input.idOrName}`,
  ),
  proxied<{ idOrName: string }>(
    "filter_project_envs",
    "List a project's environment variable names and targets. Values stay encrypted.",
    {
      idOrName,
      gitBranch: z.string().max(250).optional(),
      ...team,
    },
    (input) => `List environment variables of ${input.idOrName}`,
  ),
  proxied<{ topic: string }>(
    "search_vercel_documentation",
    "Search the Vercel documentation.",
    {
      topic: z.string().min(1).max(500),
      tokens: z.number().int().min(100).max(10_000).optional(),
    },
    (input) => `Search Vercel docs for "${input.topic.slice(0, 100)}"`,
  ),
  proxied<Team & { projectId: string; deploymentId: string }>(
    "request_promote",
    "Promote a deployment to production.",
    { projectId, deploymentId, ...team },
    async (input, token) =>
      `Promote ${await deploymentName(token, input.deploymentId, input)} to production`,
  ),
  proxied<Team & { projectId: string; deploymentId: string }>(
    "request_rollback",
    "Roll production back to an earlier deployment.",
    {
      projectId,
      deploymentId,
      description: z.string().max(500).optional(),
      ...team,
    },
    async (input, token) =>
      `Roll production back to ${await deploymentName(token, input.deploymentId, input)}`,
  ),
  proxied<Team & { id: string }>(
    "cancel_deployment",
    "Cancel a deployment that is building.",
    { id: deploymentId, ...team },
    async (input, token) =>
      `Cancel deployment ${await deploymentName(token, input.id, input)}`,
  ),
  proxied<{ projectId: string }>(
    "pause_project",
    "Pause a project. Its deployments stop serving traffic.",
    { projectId, ...team },
    (input) => `Pause project ${input.projectId}`,
  ),
  proxied<{ projectId: string }>(
    "unpause_project",
    "Resume a paused project.",
    { projectId, ...team },
    (input) => `Resume project ${input.projectId}`,
  ),
];
