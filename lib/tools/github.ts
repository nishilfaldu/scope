import { z } from "zod";
import type { ToolImplementation } from "./types";
import { proxy } from "./upstream";

const proxied = proxy("https://api.githubcopilot.com/mcp/", "github");

const owner = z.string().min(1).max(100).describe("Repository owner"),
  repo = z.string().min(1).max(100).describe("Repository name"),
  page = z.number().int().min(1).optional(),
  perPage = z.number().int().min(1).max(100).optional(),
  number = z.number().int().min(1);

type Repo = { owner: string; repo: string };
const at = (input: Repo) => `${input.owner}/${input.repo}`;
const quote = (text: string | undefined, max = 120) =>
  text ? `: "${text.slice(0, max)}${text.length > max ? "…" : ""}"` : "";

// The title comes from GitHub, so the model cannot mislabel the issue.
async function issueRef(token: string, input: Repo, issue: number) {
  const ref = `${at(input)}#${issue}`;
  if (!token) return ref;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${issue}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return ref;
    const { title } = (await response.json()) as { title?: string };
    return title
      ? `${ref} "${title.slice(0, 100)}${title.length > 100 ? "…" : ""}"`
      : ref;
  } catch {
    return ref;
  }
}

export const githubTools: ToolImplementation[] = [
  proxied(
    "get_me",
    "Get the signed-in GitHub user's profile.",
    {},
    () => "Read your profile",
  ),
  proxied<{ query: string }>(
    "search_repositories",
    "Search GitHub repositories with GitHub search syntax.",
    {
      query: z.string().min(1).max(500),
      sort: z
        .enum(["stars", "forks", "help-wanted-issues", "updated"])
        .optional(),
      order: z.enum(["asc", "desc"]).optional(),
      page,
      perPage,
    },
    (input) => `Search repositories for "${input.query.slice(0, 100)}"`,
  ),
  proxied<Repo & { path?: string }>(
    "get_file_contents",
    "Get a file or directory listing from a repository.",
    {
      owner,
      repo,
      path: z.string().max(1000).optional(),
      ref: z.string().max(250).optional(),
      sha: z.string().max(100).optional(),
    },
    (input) => `Read ${input.path || "/"} in ${at(input)}`,
  ),
  proxied<Repo>(
    "list_issues",
    "List issues in a repository.",
    {
      owner,
      repo,
      state: z.enum(["OPEN", "CLOSED"]).optional(),
      labels: z.array(z.string().max(100)).max(20).optional(),
      since: z.string().max(40).optional(),
      after: z.string().max(500).optional(),
      perPage,
    },
    (input) => `List issues in ${at(input)}`,
  ),
  proxied<Repo & { issue_number: number }>(
    "issue_read",
    "Read one issue: details, comments, sub-issues, parent or labels.",
    {
      owner,
      repo,
      issue_number: number,
      method: z.enum([
        "get",
        "get_comments",
        "get_sub_issues",
        "get_parent",
        "get_labels",
      ]),
      page,
      perPage,
    },
    (input) => `Read issue ${at(input)}#${input.issue_number}`,
  ),
  proxied<{ query: string }>(
    "search_issues",
    "Search issues across GitHub, or in one repository with owner and repo.",
    {
      query: z.string().min(1).max(500),
      owner: owner.optional(),
      repo: repo.optional(),
      page,
      perPage,
    },
    (input) => `Search issues for "${input.query.slice(0, 100)}"`,
  ),
  proxied<Repo>(
    "list_pull_requests",
    "List pull requests in a repository.",
    {
      owner,
      repo,
      state: z.enum(["open", "closed", "all"]).optional(),
      base: z.string().max(250).optional(),
      head: z.string().max(250).optional(),
      page,
      perPage,
    },
    (input) => `List pull requests in ${at(input)}`,
  ),
  proxied<Repo & { pullNumber: number }>(
    "pull_request_read",
    "Read one pull request: details, diff, status, files, commits, reviews or review comments.",
    {
      owner,
      repo,
      pullNumber: number,
      method: z.enum([
        "get",
        "get_diff",
        "get_status",
        "get_files",
        "get_commits",
        "get_review_comments",
        "get_reviews",
        "get_comments",
      ]),
      after: z.string().max(500).optional(),
      page,
      perPage,
    },
    (input) => `Read pull request ${at(input)}#${input.pullNumber}`,
  ),
  proxied<{ query: string }>(
    "search_code",
    "Search code with GitHub code search syntax, for example `repo:owner/name term`.",
    { query: z.string().min(1).max(256), page, perPage },
    (input) => `Search code for "${input.query.slice(0, 100)}"`,
  ),
  proxied<Repo>(
    "list_commits",
    "List commits on a branch, tag or SHA.",
    {
      owner,
      repo,
      sha: z.string().max(250).optional(),
      author: z.string().max(250).optional(),
      path: z.string().max(1000).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      page,
      perPage,
    },
    (input) => `List commits in ${at(input)}`,
  ),
  proxied<Repo>(
    "list_branches",
    "List branches in a repository.",
    { owner, repo, page, perPage },
    (input) => `List branches in ${at(input)}`,
  ),
  proxied<
    Repo & {
      method: "create" | "update";
      issue_number?: number;
      title?: string;
      state?: string;
    }
  >(
    "issue_write",
    "Create an issue (method create, with title) or update one (method update, with issue_number).",
    {
      owner,
      repo,
      method: z.enum(["create", "update"]),
      issue_number: number.optional(),
      title: z.string().max(256).optional(),
      body: z.string().max(65_000).optional(),
      labels: z.array(z.string().max(100)).max(20).optional(),
      assignees: z.array(z.string().max(100)).max(10).optional(),
      state: z.enum(["open", "closed"]).optional(),
      state_reason: z
        .enum(["completed", "not_planned", "duplicate"])
        .optional(),
    },
    async (input, token) => {
      if (input.method === "create")
        return `Open an issue in ${at(input)}${quote(input.title)}`;
      const verb =
        input.state === "closed"
          ? "Close"
          : input.state === "open"
            ? "Reopen"
            : "Edit";
      const ref = input.issue_number
        ? await issueRef(token, input, input.issue_number)
        : `${at(input)}#?`;
      return `${verb} issue ${ref}${input.title ? `, renaming it to "${input.title.slice(0, 100)}"` : ""}`;
    },
  ),
  proxied<Repo & { issue_number: number; body: string }>(
    "add_issue_comment",
    "Comment on an issue or pull request.",
    { owner, repo, issue_number: number, body: z.string().min(1).max(65_000) },
    async (input, token) =>
      `Comment on ${await issueRef(token, input, input.issue_number)}${quote(input.body)}`,
  ),
  proxied<Repo & { title: string; head: string; base: string }>(
    "create_pull_request",
    "Open a pull request from head into base.",
    {
      owner,
      repo,
      title: z.string().min(1).max(256),
      head: z.string().min(1).max(250),
      base: z.string().min(1).max(250),
      body: z.string().max(65_000).optional(),
      draft: z.boolean().optional(),
    },
    (input) =>
      `Open a pull request in ${at(input)} (${input.head} into ${input.base})${quote(input.title)}`,
  ),
  proxied<Repo & { branch: string; from_branch?: string }>(
    "create_branch",
    "Create a branch.",
    {
      owner,
      repo,
      branch: z.string().min(1).max(250),
      from_branch: z.string().max(250).optional(),
    },
    (input) =>
      `Create branch ${input.branch} in ${at(input)}${input.from_branch ? ` from ${input.from_branch}` : ""}`,
  ),
  proxied<Repo & { path: string; branch: string; message: string }>(
    "create_or_update_file",
    "Create or update one file with a commit. Pass sha when the file exists.",
    {
      owner,
      repo,
      path: z.string().min(1).max(1000),
      content: z.string().max(1_000_000),
      message: z.string().min(1).max(1000),
      branch: z.string().min(1).max(250),
      sha: z.string().max(100).optional(),
    },
    (input) =>
      `Commit ${input.path} to ${at(input)} on ${input.branch}${quote(input.message)}`,
  ),
  proxied<Repo & { pullNumber: number; merge_method?: string }>(
    "merge_pull_request",
    "Merge a pull request.",
    {
      owner,
      repo,
      pullNumber: number,
      merge_method: z.enum(["merge", "squash", "rebase"]).optional(),
      commit_title: z.string().max(256).optional(),
      commit_message: z.string().max(65_000).optional(),
    },
    async (input, token) =>
      `Merge pull request ${await issueRef(token, input, input.pullNumber)}${input.merge_method ? ` (${input.merge_method})` : ""}`,
  ),
];
