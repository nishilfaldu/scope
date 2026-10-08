import { z } from "zod";
import { ToolFailure, type ToolImplementation } from "./types";

async function slack(
  token: string,
  method: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) form.set(key, String(value));
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true)
    throw new ToolFailure(
      body.error === "missing_scope"
        ? `Slack refused: the connected account lacks the scope "${body.needed}". Reconnect Slack in Scope with that permission.`
        : `Slack refused the call (${body.error ?? response.status}).`,
    );
  return body;
}

// The name comes from Slack, so the model cannot mislabel the target.
async function channelName(token: string, id: string) {
  if (!token) return id;
  try {
    const body = await slack(token, "conversations.info", { channel: id });
    return body.channel?.name ? `#${body.channel.name}` : id;
  } catch {
    return id;
  }
}

const channel = z
  .string()
  .regex(/^[A-Z0-9]{8,20}$/)
  .describe(
    "Channel ID, for example C0123456789. Get it from slack_list_channels.",
  );

export const slackTools: ToolImplementation[] = [
  {
    name: "slack_list_channels",
    description:
      "List Slack channels in the connected workspace. Returns id, name, privacy, member count and topic.",
    inputSchema: {
      includePrivate: z
        .boolean()
        .optional()
        .describe("Also list private channels the account can see."),
      cursor: z.string().max(500).optional(),
    },
    summary: () => "List channels",
    async run(token, input: { includePrivate?: boolean; cursor?: string }) {
      const body = await slack(token, "conversations.list", {
        types: input.includePrivate
          ? "public_channel,private_channel"
          : "public_channel",
        exclude_archived: true,
        limit: 200,
        cursor: input.cursor,
      });
      return {
        channels: body.channels.map(
          (c: {
            id: string;
            name: string;
            is_private: boolean;
            num_members?: number;
            topic?: { value?: string };
          }) => ({
            id: c.id,
            name: c.name,
            private: c.is_private,
            members: c.num_members,
            topic: c.topic?.value || undefined,
          }),
        ),
        nextCursor: body.response_metadata?.next_cursor || undefined,
      };
    },
  },
  {
    name: "slack_read_history",
    description:
      "Read recent messages in one Slack channel, newest first. Returns ts, user, text and thread info.",
    inputSchema: {
      channel,
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(500).optional(),
    },
    summary: async (input: { channel: string }, token) =>
      `Read messages in ${await channelName(token, input.channel)}`,
    async run(
      token,
      input: { channel: string; limit?: number; cursor?: string },
    ) {
      const body = await slack(token, "conversations.history", {
        channel: input.channel,
        limit: input.limit ?? 30,
        cursor: input.cursor,
      });
      return {
        messages: body.messages.map(
          (m: {
            ts: string;
            user?: string;
            text?: string;
            thread_ts?: string;
            reply_count?: number;
          }) => ({
            ts: m.ts,
            user: m.user,
            text: m.text,
            threadTs: m.thread_ts,
            replies: m.reply_count,
          }),
        ),
        nextCursor: body.response_metadata?.next_cursor || undefined,
      };
    },
  },
  {
    name: "slack_search_messages",
    description:
      "Search Slack messages with Slack's search syntax. Needs a user token with the search:read scope.",
    inputSchema: {
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(50).optional(),
    },
    summary: (input: { query: string }) =>
      `Search for "${input.query.slice(0, 100)}"`,
    async run(token, input: { query: string; limit?: number }) {
      const body = await slack(token, "search.messages", {
        query: input.query,
        count: input.limit ?? 20,
      });
      return {
        matches: (body.messages?.matches ?? []).map(
          (m: {
            channel?: { id?: string; name?: string };
            ts: string;
            user?: string;
            username?: string;
            text?: string;
            permalink?: string;
          }) => ({
            channel: m.channel?.name ?? m.channel?.id,
            ts: m.ts,
            user: m.username ?? m.user,
            text: m.text,
            permalink: m.permalink,
          }),
        ),
      };
    },
  },
  {
    name: "slack_post_message",
    description:
      "Post a message to a Slack channel, or reply in a thread when threadTs is set.",
    inputSchema: {
      channel,
      text: z.string().min(1).max(4000),
      threadTs: z
        .string()
        .regex(/^\d+\.\d+$/)
        .optional()
        .describe("Reply in this thread."),
    },
    summary: async (
      input: { channel: string; text: string; threadTs?: string },
      token,
    ) =>
      `${input.threadTs ? "Reply in a thread in" : "Post in"} ${await channelName(token, input.channel)}: "${input.text.slice(0, 120)}${input.text.length > 120 ? "…" : ""}"`,
    async run(
      token,
      input: { channel: string; text: string; threadTs?: string },
    ) {
      const body = await slack(token, "chat.postMessage", {
        channel: input.channel,
        text: input.text,
        thread_ts: input.threadTs,
      });
      return { channel: body.channel, ts: body.ts };
    },
  },
];
