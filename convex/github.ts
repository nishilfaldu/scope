import type { InvokeResult } from "./invoke";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid string arg: ${key}`);
  }
  return value;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid string arg: ${key}`);
  }
  return value;
}

function errorFromGitHubBody(body: unknown, status: number): string {
  if (isPlainObject(body) && typeof body.message === "string") {
    return body.message;
  }
  if (isPlainObject(body) && typeof body.error === "string") {
    return body.error;
  }
  return `GitHub request failed (${status})`;
}

function shaFromGitRef(body: unknown): string | null {
  if (!isPlainObject(body) || !isPlainObject(body.object)) {
    return null;
  }
  return typeof body.object.sha === "string" ? body.object.sha : null;
}

type GitHubCtx = {
  githubToken: string | null;
};

async function githubFetch(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<InvokeResult> {
  if (!token) {
    return {
      ok: false,
      status: 503,
      body: { error: "GitHub not connected" },
      error: "GitHub not connected",
    };
  }

  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { error: text };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body: parsed,
    error: response.ok ? null : errorFromGitHubBody(parsed, response.status),
  };
}

export async function githubReposList(
  _args: Record<string, unknown>,
  ctx: GitHubCtx,
): Promise<InvokeResult> {
  return await githubFetch(ctx.githubToken, "GET", "/user/repos?per_page=30");
}

export async function githubReposGet(
  args: Record<string, unknown>,
  ctx: GitHubCtx,
): Promise<InvokeResult> {
  const owner = requireString(args, "owner");
  const repo = requireString(args, "repo");
  return await githubFetch(
    ctx.githubToken,
    "GET",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  );
}

export async function githubIssuesList(
  args: Record<string, unknown>,
  ctx: GitHubCtx,
): Promise<InvokeResult> {
  const owner = requireString(args, "owner");
  const repo = requireString(args, "repo");
  return await githubFetch(
    ctx.githubToken,
    "GET",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
  );
}

export async function githubIssuesComment(
  args: Record<string, unknown>,
  ctx: GitHubCtx,
): Promise<InvokeResult> {
  const owner = requireString(args, "owner");
  const repo = requireString(args, "repo");
  const issueNumber = requireString(args, "issue_number");
  const body = requireString(args, "body");
  return await githubFetch(
    ctx.githubToken,
    "POST",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(issueNumber)}/comments`,
    { body },
  );
}

export async function githubCreateBranch(
  args: Record<string, unknown>,
  ctx: GitHubCtx,
): Promise<InvokeResult> {
  const owner = requireString(args, "owner");
  const repo = requireString(args, "repo");
  const branch = requireString(args, "branch");
  const fromRef = optionalString(args, "fromRef") ?? "main";
  const ownerEnc = encodeURIComponent(owner);
  const repoEnc = encodeURIComponent(repo);
  const refResult = await githubFetch(
    ctx.githubToken,
    "GET",
    `/repos/${ownerEnc}/${repoEnc}/git/ref/heads/${encodeURIComponent(fromRef)}`,
  );
  if (!refResult.ok) {
    return refResult;
  }
  const sha = shaFromGitRef(refResult.body);
  if (sha === null) {
    return {
      ok: false,
      status: 502,
      body: { error: "Unexpected GitHub ref response" },
      error: "Unexpected GitHub ref response",
    };
  }
  return await githubFetch(
    ctx.githubToken,
    "POST",
    `/repos/${ownerEnc}/${repoEnc}/git/refs`,
    {
      ref: `refs/heads/${branch}`,
      sha,
    },
  );
}

export async function githubPullsCreate(
  args: Record<string, unknown>,
  ctx: GitHubCtx,
): Promise<InvokeResult> {
  const owner = requireString(args, "owner");
  const repo = requireString(args, "repo");
  const title = requireString(args, "title");
  const head = requireString(args, "head");
  const base = requireString(args, "base");
  const body = optionalString(args, "body");
  return await githubFetch(
    ctx.githubToken,
    "POST",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      title,
      head,
      base,
      ...(body !== undefined ? { body } : {}),
    },
  );
}
