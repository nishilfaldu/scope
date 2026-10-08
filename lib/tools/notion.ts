import { z } from "zod";
import type { ToolImplementation } from "./types";
import { callUpstream, proxy } from "./upstream";

const server = "https://mcp.notion.com/mcp";
const upstreamName = (name: string) => `notion-${name.replaceAll("_", "-")}`;
const proxied = proxy(server, "notion", upstreamName);

const markdownNote =
  'Content uses Notion Markdown. Read its rules once with notion_fetch and id "notion://docs/enhanced-markdown-spec".';

const id = z.string().min(1).max(500),
  pageId = id.describe("Page ID or URL"),
  limit = z.number().int().min(1).max(200).optional(),
  cursor = z.string().max(500).optional(),
  dateRange = z
    .object({
      start_date: z.iso.date().optional(),
      end_date: z.iso.date().optional(),
    })
    .optional(),
  value = z.union([
    z.string().max(20_000),
    z.number(),
    z.array(z.string().max(2000)).max(100),
    z.null(),
  ]),
  properties = z.record(z.string().max(200), value),
  parent = z.union([
    z.object({ type: z.literal("page_id").optional(), page_id: id }),
    z.object({ type: z.literal("database_id").optional(), database_id: id }),
    z.object({
      type: z.literal("data_source_id").optional(),
      data_source_id: id,
    }),
  ]);

const quote = (text: string | undefined, max = 120) =>
  text ? `"${text.slice(0, max)}${text.length > max ? "…" : ""}"` : "";

// The title comes from Notion, so the model cannot mislabel the page.
async function pageTitle(token: string, page: string) {
  if (!token) return "a page";
  try {
    const body = JSON.parse(
      await callUpstream(server, token, upstreamName("fetch"), { id: page }),
    );
    return body.title ? quote(String(body.title), 100) : "a page";
  } catch {
    return "a page";
  }
}

type Parent = {
  page_id?: string;
  database_id?: string;
  data_source_id?: string;
};
const parentId = (p?: Parent) =>
  p?.page_id ?? p?.database_id ?? p?.data_source_id;

export const notionTools: ToolImplementation[] = [
  proxied<{ query: string }>(
    "search",
    "Search Notion with short keywords, or find a user by name or email (query_type user).",
    {
      query: z.string().max(500),
      query_type: z.enum(["internal", "user"]).optional(),
      page_url: z.string().max(500).optional(),
      data_source_url: z.string().max(500).optional(),
      teamspace_id: z.string().max(100).optional(),
      filters: z
        .object({
          created_date_range: dateRange,
          last_edited_date_range: dateRange,
          created_by_user_ids: z.array(z.string().max(100)).max(100).optional(),
          edited_by_user_ids: z.array(z.string().max(100)).max(100).optional(),
          teamspace_ids: z.array(z.string().max(100)).max(100).optional(),
          title_only: z.boolean().optional(),
        })
        .optional(),
      sort: z.enum(["relevance", "last_edited", "created"]).optional(),
      page_size: z.number().int().min(1).max(100).optional(),
    },
    (input) => `Search for "${input.query.slice(0, 100)}"`,
  ),
  proxied<{ id: string }>(
    "fetch",
    `Read a page, database or data source by URL or ID. ${markdownNote}`,
    {
      id,
      include_discussions: z.boolean().optional(),
      include_transcript: z.boolean().optional(),
    },
    (input) =>
      input.id.startsWith("notion://docs/")
        ? "Read Notion docs"
        : "Read a page",
  ),
  proxied(
    "list_recent_pages",
    "List pages you viewed recently.",
    { limit, cursor },
    () => "List recent pages",
  ),
  proxied(
    "list_shared_pages",
    "List pages shared with you.",
    { limit, cursor },
    () => "List shared pages",
  ),
  proxied(
    "get_comments",
    "Read the comments on a page.",
    {
      page_id: pageId,
      include_resolved: z.boolean().optional(),
      include_all_blocks: z.boolean().optional(),
      discussion_id: z.string().max(500).optional(),
    },
    () => "Read comments",
  ),
  proxied(
    "get_users",
    "List workspace members, or find one by name or email.",
    {
      query: z.string().min(1).max(100).optional(),
      user_id: z.string().min(1).max(100).optional(),
      start_cursor: z.string().min(1).max(500).optional(),
      page_size: z.number().int().min(1).max(100).optional(),
    },
    () => "List members",
  ),
  proxied(
    "get_teams",
    "List teamspaces.",
    { query: z.string().min(1).max(100).optional() },
    () => "List teamspaces",
  ),
  proxied(
    "query_data_sources",
    "Query a database with read-only SQL, rows or a saved view. Fetch the database first for its collection:// URL and columns.",
    { data: z.record(z.string().max(100), z.unknown()) },
    () => "Query a database",
  ),
  proxied<{
    pages: { properties?: { title?: unknown } }[];
    parent?: Parent;
  }>(
    "create_pages",
    `Create pages. Without a parent they are private pages. ${markdownNote}`,
    {
      pages: z
        .array(
          z.object({
            properties: properties.optional(),
            content: z.string().max(200_000).optional(),
            template_id: z.string().max(200).optional(),
            icon: z.string().max(500).optional(),
            cover: z.string().max(1000).optional(),
          }),
        )
        .min(1)
        .max(20),
      parent: parent.optional(),
    },
    async (input, token) => {
      const titles = input.pages
        .map((p) => p.properties?.title)
        .filter((t): t is string => typeof t === "string");
      const where = parentId(input.parent);
      const what =
        input.pages.length === 1
          ? `page ${quote(titles[0]) || "(untitled)"}`
          : `${input.pages.length} pages`;
      return `Create ${what}${where ? ` in ${await pageTitle(token, where)}` : " in your private pages"}`;
    },
  ),
  proxied<{
    page_id: string;
    command: string;
    allow_deleting_content?: boolean;
  }>(
    "update_page",
    `Change a page's properties or content. ${markdownNote}`,
    {
      page_id: pageId,
      command: z.enum([
        "update_properties",
        "update_content",
        "replace_content",
        "insert_content",
      ]),
      properties: properties.optional(),
      content: z.string().max(200_000).optional(),
      content_updates: z
        .array(
          z.object({
            old_str: z.string().min(1).max(20_000),
            new_str: z.string().max(20_000),
            replace_all_matches: z.boolean().optional(),
          }),
        )
        .max(100)
        .optional(),
      position: z.object({ type: z.enum(["start", "end"]) }).optional(),
      allow_deleting_content: z.boolean().optional(),
    },
    async (input, token) => {
      const page = await pageTitle(token, input.page_id);
      const verb = {
        update_properties: "Change properties of",
        update_content: "Edit",
        replace_content: "Replace all content of",
        insert_content: "Add to",
      }[input.command];
      return `${verb ?? "Change"} ${page}${input.allow_deleting_content ? ", allowing deletions" : ""}`;
    },
  ),
  proxied<{ page_or_database_ids: string[]; new_parent: Parent }>(
    "move_pages",
    "Move pages or databases under a new parent.",
    {
      page_or_database_ids: z.array(id).min(1).max(100),
      new_parent: parent,
    },
    async (input, token) => {
      const what =
        input.page_or_database_ids.length === 1
          ? await pageTitle(token, input.page_or_database_ids[0])
          : `${input.page_or_database_ids.length} pages`;
      return `Move ${what} to ${await pageTitle(token, parentId(input.new_parent)!)}`;
    },
  ),
  proxied<{ page_id: string }>(
    "duplicate_page",
    "Duplicate a page.",
    { page_id: pageId },
    async (input, token) =>
      `Duplicate ${await pageTitle(token, input.page_id)}`,
  ),
  proxied<{ page_id: string; markdown?: string }>(
    "create_comment",
    "Comment on a page, on a part of it, or reply to a discussion.",
    {
      page_id: pageId,
      markdown: z.string().min(1).max(10_000),
      discussion_id: z.string().max(500).optional(),
      selection_with_ellipsis: z.string().max(200).optional(),
    },
    async (input, token) =>
      `Comment on ${await pageTitle(token, input.page_id)}: ${quote(input.markdown)}`,
  ),
];
