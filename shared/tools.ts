// Tools Scope exposes over MCP. Convex reads this list for rules; Next runs the tools.
export type Rule = "allow" | "ask" | "block";

export type ToolInfo = {
  name: string;
  providerId: string;
  title: string;
  readOnly: boolean;
};

export const tools: readonly ToolInfo[] = [
  {
    name: "slack_list_channels",
    providerId: "slack",
    title: "List channels",
    readOnly: true,
  },
  {
    name: "slack_read_history",
    providerId: "slack",
    title: "Read channel messages",
    readOnly: true,
  },
  {
    name: "slack_search_messages",
    providerId: "slack",
    title: "Search messages",
    readOnly: true,
  },
  {
    name: "slack_post_message",
    providerId: "slack",
    title: "Post a message",
    readOnly: false,
  },
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
