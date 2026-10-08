import { z } from "zod";
import type { ToolImplementation } from "./types";
import { proxy } from "./upstream";

const proxied = proxy(
  "https://mcp.slack.com/mcp",
  "slack",
  (name) => `slack_${name}`,
);

async function slack(
  token: string,
  method: string,
  params: Record<string, string>,
) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams(params),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (body.ok !== true) throw new Error(body.error);
  return body;
}

async function personName(token: string, user: string) {
  const body = await slack(token, "users.info", { user });
  return body.user?.real_name || body.user?.name || user;
}

// Names come from Slack, so the model cannot mislabel the target.
async function where(token: string, id: string) {
  if (!token) return id;
  try {
    if (/^[UW]/.test(id))
      return `a direct message with ${await personName(token, id)}`;
    const { channel } = await slack(token, "conversations.info", {
      channel: id,
    });
    if (channel?.is_im)
      return `a direct message with ${await personName(token, channel.user)}`;
    if (channel?.is_mpim) return "a group direct message";
    return channel?.name ? `#${channel.name}` : id;
  } catch {
    return id;
  }
}

const quote = (text: string, max = 120) =>
  `"${text.slice(0, max)}${text.length > max ? "…" : ""}"`;

const conversation = z
    .string()
    .regex(/^[CDGUW][A-Z0-9]{8,20}$/)
    .describe("Channel, DM or user ID, for example C0123456789"),
  ts = z
    .string()
    .regex(/^\d{10}\.\d{6}$/)
    .describe('Message timestamp, for example "1234567890.123456"'),
  unixTime = z.string().regex(/^\d{1,10}(\.\d{1,6})?$/),
  cursor = z.string().max(1000).optional(),
  limit = (max: number) => z.number().int().min(1).max(max).optional(),
  detail = z.enum(["detailed", "concise"]).optional(),
  channelTypes = z
    .string()
    .regex(
      /^(public_channel|private_channel|mpim|im)(,(public_channel|private_channel|mpim|im))*$/,
    )
    .optional()
    .describe("Comma-separated: public_channel, private_channel, mpim, im"),
  keywords = z
    .array(z.string().min(1).max(200))
    .max(20)
    .optional()
    .describe(
      'Single words or exact phrases in quotes, for example ["launch", "\\"release notes\\""]',
    ),
  question = z
    .string()
    .max(500)
    .optional()
    .describe("The question in plain words, used to rank results"),
  message = z.string().min(1).max(40_000),
  canvasId = z.string().regex(/^F[A-Z0-9]{8,20}$/),
  canvasMarkdown =
    "Canvas Markdown: mention users as ![](@U123) and channels as ![](#C123).";

const search = {
  keywords,
  natural_language_query: question,
  filters: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Slack search modifiers, for example from:<@U123> in:<#C456> after:2026-01-01",
    ),
  after: unixTime.optional(),
  before: unixTime.optional(),
  sort: z.enum(["score", "timestamp"]).optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
  include_bots: z.boolean().optional(),
  include_context: z.boolean().optional(),
  only_my_channels: z.boolean().optional(),
  limit: limit(20),
  cursor,
  response_format: detail,
};

type Search = { keywords?: string[]; natural_language_query?: string };
const searchText = (input: Search) =>
  input.natural_language_query?.slice(0, 100) ||
  input.keywords?.join(" ").slice(0, 100) ||
  "";

type Message = { channel_id: string; message: string; thread_ts?: string };

export const slackTools: ToolImplementation[] = [
  proxied<Search>(
    "search_public",
    "Search messages in public channels.",
    search,
    (input) => `Search public channels for "${searchText(input)}"`,
  ),
  proxied<Search>(
    "search_public_and_private",
    "Search messages in public and private channels and DMs.",
    { ...search, channel_types: channelTypes },
    (input) => `Search all conversations for "${searchText(input)}"`,
  ),
  proxied<Search>(
    "search_channels",
    "Find channels by name or description.",
    {
      keywords,
      natural_language_query: question,
      channel_types: channelTypes,
      include_archived: z.boolean().optional(),
      limit: limit(20),
      cursor,
      response_format: detail,
    },
    (input) => `Find channels matching "${searchText(input)}"`,
  ),
  proxied<Search>(
    "search_users",
    "Find people by name, email or title.",
    {
      keywords,
      natural_language_query: question,
      limit: limit(20),
      cursor,
      response_format: detail,
    },
    (input) => `Find people matching "${searchText(input)}"`,
  ),
  proxied(
    "list_user_channels",
    "List the channels and DMs you are a member of.",
    {
      types: channelTypes,
      name_prefix: z.string().max(80).optional(),
      exclude_archived: z.boolean().optional(),
      format: z.enum(["full", "ids_only", "names_only"]).optional(),
      limit: limit(200),
      cursor,
    },
    () => "List your channels",
  ),
  proxied<{ channel_id: string }>(
    "read_channel",
    "Read messages in a channel or DM, newest first.",
    {
      channel_id: conversation,
      limit: limit(100),
      oldest: unixTime.optional(),
      latest: unixTime.optional(),
      cursor,
      response_format: detail,
    },
    async (input, token) =>
      `Read messages in ${await where(token, input.channel_id)}`,
  ),
  proxied<{ channel_id: string }>(
    "read_thread",
    "Read the replies in a thread.",
    {
      channel_id: conversation,
      message_ts: ts,
      limit: limit(1000),
      oldest: ts.optional(),
      latest: ts.optional(),
      cursor,
      response_format: detail,
    },
    async (input, token) =>
      `Read a thread in ${await where(token, input.channel_id)}`,
  ),
  proxied(
    "read_user_profile",
    "Read a person's profile. Without user_id, reads your own.",
    {
      user_id: z
        .string()
        .regex(/^[UW][A-Z0-9]{8,20}$/)
        .optional(),
      include_locale: z.boolean().optional(),
      response_format: detail,
    },
    () => "Read a profile",
  ),
  proxied<{ channel_id: string }>(
    "list_channel_members",
    "List the members of a channel.",
    {
      channel_id: conversation,
      limit: limit(30),
      cursor,
      include_bots: z.boolean().optional(),
      include_deleted: z.boolean().optional(),
      response_format: z.enum(["detailed", "concise", "ids_only"]).optional(),
    },
    async (input, token) =>
      `List members of ${await where(token, input.channel_id)}`,
  ),
  proxied(
    "get_reactions",
    "Read the emoji reactions on a message.",
    { channel_id: conversation, message_ts: ts },
    () => "Read reactions",
  ),
  proxied(
    "read_canvas",
    "Read a canvas as Markdown, with its section IDs.",
    { canvas_id: canvasId },
    () => "Read a canvas",
  ),
  proxied<Message & { reply_broadcast?: boolean }>(
    "send_message",
    "Send a message to a channel or DM, or reply in a thread with thread_ts.",
    {
      channel_id: conversation,
      message,
      thread_ts: ts.optional(),
      reply_broadcast: z.boolean().optional(),
    },
    async (input, token) => {
      const target = await where(token, input.channel_id);
      return `${input.thread_ts ? `Reply in a thread in ${target}` : `Send to ${target}`}${input.reply_broadcast ? " and the channel" : ""}: ${quote(input.message)}`;
    },
  ),
  proxied<Message & { post_at: number }>(
    "schedule_message",
    "Schedule a message. post_at is a Unix time between 2 minutes and 120 days ahead.",
    {
      channel_id: conversation,
      message,
      post_at: z.number().int().positive(),
      thread_ts: ts.optional(),
      reply_broadcast: z.boolean().optional(),
    },
    async (input, token) => {
      const at = new Date(input.post_at * 1000).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      });
      return `Schedule for ${at} UTC in ${await where(token, input.channel_id)}: ${quote(input.message)}`;
    },
  ),
  proxied<Message>(
    "send_message_draft",
    "Save a message as a draft in Slack for you to review and send.",
    { channel_id: conversation, message, thread_ts: ts.optional() },
    async (input, token) =>
      `Save a draft in ${await where(token, input.channel_id)}: ${quote(input.message)}`,
  ),
  proxied<{ channel_id: string; emoji: string }>(
    "add_reaction",
    "React to a message with an emoji.",
    {
      channel_id: conversation,
      message_ts: ts,
      emoji: z
        .string()
        .regex(/^[a-z0-9_+'-]{1,100}$/)
        .describe("Emoji name without colons"),
    },
    async (input, token) =>
      `React with :${input.emoji}: in ${await where(token, input.channel_id)}`,
  ),
  proxied<{ title: string }>(
    "create_canvas",
    `Create a canvas. Do not repeat the title in the content. ${canvasMarkdown}`,
    {
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(200_000),
    },
    (input) => `Create canvas ${quote(input.title, 100)}`,
  ),
  proxied<{ canvas_id: string; sections: { edit_type: string }[] }>(
    "update_canvas",
    `Edit a canvas. Get fresh section IDs from slack_read_canvas first. ${canvasMarkdown}`,
    {
      canvas_id: canvasId,
      sections: z
        .array(
          z.object({
            edit_type: z.enum(["append", "prepend", "replace", "delete"]),
            section_id: z.string().max(200).optional(),
            content: z.string().max(200_000).optional(),
          }),
        )
        .min(1)
        .max(100),
    },
    (input) => {
      const deletes = input.sections.filter(
        (s) => s.edit_type === "delete",
      ).length;
      return `Edit canvas ${input.canvas_id} (${input.sections.length} change${input.sections.length === 1 ? "" : "s"}${deletes ? `, ${deletes} deletion${deletes === 1 ? "" : "s"}` : ""})`;
    },
  ),
];
