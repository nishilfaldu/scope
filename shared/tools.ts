// Tools Scope exposes over MCP. Convex reads this list for rules; Next runs the tools.
export type Rule = "allow" | "ask" | "block";

export type ToolInfo = {
  name: string;
  providerId: string;
  title: string;
  readOnly: boolean;
};

const group = (
  providerId: string,
  entries: [name: string, title: string, readOnly: boolean][],
) =>
  entries.map(([name, title, readOnly]) => ({
    name,
    providerId,
    title,
    readOnly,
  }));

// Scope decides readOnly itself, also for proxied tools, so an upstream
// server cannot turn a write into an allowed read.
export const tools: readonly ToolInfo[] = [
  ...group("slack", [
    ["slack_search_public", "Search public channels", true],
    ["slack_search_public_and_private", "Search all conversations", true],
    ["slack_search_channels", "Find channels", true],
    ["slack_search_users", "Find people", true],
    ["slack_list_user_channels", "List your channels", true],
    ["slack_read_channel", "Read messages", true],
    ["slack_read_thread", "Read a thread", true],
    ["slack_read_user_profile", "Read a profile", true],
    ["slack_list_channel_members", "List channel members", true],
    ["slack_get_reactions", "Read reactions", true],
    ["slack_read_canvas", "Read a canvas", true],
    ["slack_send_message", "Send a message", false],
    ["slack_schedule_message", "Schedule a message", false],
    ["slack_send_message_draft", "Save a draft", false],
    ["slack_add_reaction", "Add a reaction", false],
    ["slack_create_canvas", "Create a canvas", false],
    ["slack_update_canvas", "Edit a canvas", false],
  ]),
  ...group("github", [
    ["github_get_me", "Read your profile", true],
    ["github_search_repositories", "Search repositories", true],
    ["github_get_file_contents", "Read files", true],
    ["github_list_issues", "List issues", true],
    ["github_issue_read", "Read an issue", true],
    ["github_search_issues", "Search issues", true],
    ["github_list_pull_requests", "List pull requests", true],
    ["github_pull_request_read", "Read a pull request", true],
    ["github_search_code", "Search code", true],
    ["github_list_commits", "List commits", true],
    ["github_list_branches", "List branches", true],
    ["github_issue_write", "Open or edit an issue", false],
    ["github_add_issue_comment", "Comment on an issue or PR", false],
    ["github_create_pull_request", "Open a pull request", false],
    ["github_create_branch", "Create a branch", false],
    ["github_create_or_update_file", "Commit a file", false],
    ["github_merge_pull_request", "Merge a pull request", false],
  ]),
  ...group("notion", [
    ["notion_search", "Search", true],
    ["notion_fetch", "Read a page", true],
    ["notion_list_recent_pages", "List recent pages", true],
    ["notion_list_shared_pages", "List shared pages", true],
    ["notion_get_comments", "Read comments", true],
    ["notion_get_users", "List members", true],
    ["notion_get_teams", "List teamspaces", true],
    ["notion_query_data_sources", "Query a database", true],
    ["notion_create_pages", "Create pages", false],
    ["notion_update_page", "Change a page", false],
    ["notion_move_pages", "Move pages", false],
    ["notion_duplicate_page", "Duplicate a page", false],
    ["notion_create_comment", "Comment on a page", false],
  ]),
  ...group("vercel", [
    ["vercel_list_projects", "List projects", true],
    ["vercel_get_project", "Read a project", true],
    ["vercel_list_deployments", "List deployments", true],
    ["vercel_get_deployment", "Read a deployment", true],
    ["vercel_list_deployment_events", "Read build logs", true],
    ["vercel_get_runtime_logs", "Read runtime logs", true],
    ["vercel_get_runtime_errors", "Read runtime errors", true],
    ["vercel_list_project_domains", "List domains", true],
    ["vercel_filter_project_envs", "List environment variable names", true],
    ["vercel_search_vercel_documentation", "Search docs", true],
    ["vercel_request_promote", "Promote to production", false],
    ["vercel_request_rollback", "Roll back production", false],
    ["vercel_cancel_deployment", "Cancel a deployment", false],
    ["vercel_pause_project", "Pause a project", false],
    ["vercel_unpause_project", "Resume a project", false],
  ]),
  ...group("google", [
    ["gmail_search_threads", "Search mail", true],
    ["gmail_get_thread", "Read an email thread", true],
    ["gmail_get_message", "Read an email", true],
    ["gmail_list_drafts", "List drafts", true],
    ["gmail_list_labels", "List labels", true],
    ["gmail_create_draft", "Draft an email", false],
    ["calendar_list_calendars", "List calendars", true],
    ["calendar_list_events", "List events", true],
    ["calendar_search_events", "Search events", true],
    ["calendar_get_event", "Read an event", true],
    ["calendar_suggest_time", "Find free times", true],
    ["calendar_create_event", "Create an event", false],
    ["calendar_update_event", "Change an event", false],
    ["calendar_respond_to_event", "Answer an invitation", false],
    ["calendar_delete_event", "Delete an event", false],
  ]),
];

export function toolFor(name: string) {
  return tools.find((tool) => tool.name === name);
}

export function defaultRule(tool: ToolInfo): Rule {
  return tool.readOnly ? "allow" : "ask";
}

export const ruleLabel: Record<Rule, string> = {
  allow: "Allow",
  ask: "Ask me",
  block: "Block",
};
