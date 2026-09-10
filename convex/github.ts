const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
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

async function githubFetch(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
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

  if (!response.ok) {
    return { ok: false, status: response.status, body: parsed };
  }
  return { ok: true, status: response.status, body: parsed };
}

export async function runGitHubAction(
  action: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      ok: false,
      status: 503,
      body: { error: "GITHUB_TOKEN not configured" },
    };
  }

  try {
    switch (action) {
      case "github.repos.list": {
        return await githubFetch(token, "GET", "/user/repos?per_page=30");
      }
      case "github.repos.get": {
        const owner = requireString(args, "owner");
        const repo = requireString(args, "repo");
        return await githubFetch(
          token,
          "GET",
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        );
      }
      case "github.issues.list": {
        const owner = requireString(args, "owner");
        const repo = requireString(args, "repo");
        return await githubFetch(
          token,
          "GET",
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        );
      }
      case "github.issues.comment": {
        const owner = requireString(args, "owner");
        const repo = requireString(args, "repo");
        const issueNumber = requireString(args, "issue_number");
        const body = requireString(args, "body");
        return await githubFetch(
          token,
          "POST",
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(issueNumber)}/comments`,
          { body },
        );
      }
      case "github.git.createBranch": {
        const owner = requireString(args, "owner");
        const repo = requireString(args, "repo");
        const branch = requireString(args, "branch");
        const fromRef = optionalString(args, "fromRef") ?? "main";
        const ownerEnc = encodeURIComponent(owner);
        const repoEnc = encodeURIComponent(repo);
        const refPath = `/repos/${ownerEnc}/${repoEnc}/git/ref/heads/${encodeURIComponent(fromRef)}`;
        const refResult = await githubFetch(token, "GET", refPath);
        if (!refResult.ok) {
          return refResult;
        }
        const refBody = refResult.body;
        if (
          typeof refBody !== "object" ||
          refBody === null ||
          !("object" in refBody) ||
          typeof (refBody as { object: unknown }).object !== "object" ||
          (refBody as { object: unknown }).object === null ||
          !("sha" in ((refBody as { object: Record<string, unknown> }).object)) ||
          typeof (refBody as { object: { sha: unknown } }).object.sha !==
            "string"
        ) {
          return {
            ok: false,
            status: 502,
            body: { error: "Unexpected GitHub ref response" },
          };
        }
        const sha = (refBody as { object: { sha: string } }).object.sha;
        return await githubFetch(
          token,
          "POST",
          `/repos/${ownerEnc}/${repoEnc}/git/refs`,
          {
            ref: `refs/heads/${branch}`,
            sha,
          },
        );
      }
      case "github.pulls.create": {
        const owner = requireString(args, "owner");
        const repo = requireString(args, "repo");
        const title = requireString(args, "title");
        const head = requireString(args, "head");
        const base = requireString(args, "base");
        const body = optionalString(args, "body");
        return await githubFetch(
          token,
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
      default:
        return {
          ok: false,
          status: 400,
          body: { error: `Unknown GitHub action: ${action}` },
        };
    }
  } catch (error) {
    return {
      ok: false,
      status: 400,
      body: {
        error: error instanceof Error ? error.message : "Invalid GitHub args",
      },
    };
  }
}
