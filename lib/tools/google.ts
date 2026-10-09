import { z } from "zod";
import { ToolFailure, type ToolImplementation } from "./types";

// Gmail and Calendar REST APIs, called with the person's token. The tool names
// and inputs follow Google's Workspace MCP servers, which need a preview
// enrollment. Message decoding and draft building follow
// taylorwilsdon/google_workspace_mcp (MIT).
const gmailApi = "https://gmail.googleapis.com/gmail/v1/users/me";
const calendarApi = "https://www.googleapis.com/calendar/v3";
const enc = encodeURIComponent;

type Query = Record<string, string | number | boolean | string[] | undefined>;

async function google<T>(
  url: string,
  token: string,
  {
    method = "GET",
    query = {},
    body,
  }: { method?: string; query?: Query; body?: unknown } = {},
): Promise<T> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query))
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) target.searchParams.append(key, String(item));
  const response = await fetch(target, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data as T;
  // An expired grant is reported as a reconnect by the gateway.
  if (response.status === 401) throw new Error("Google rejected the token");
  const message = (data as { error?: { message?: string } }).error?.message;
  throw new ToolFailure(
    `Google: ${(message ?? response.statusText).slice(0, 500)}`,
  );
}

// Gmail allows about 250 quota units per second per person.
async function inBatches<T, R>(
  items: T[],
  size: number,
  each: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size)
    results.push(...(await Promise.all(items.slice(i, i + size).map(each))));
  return results;
}

type Part = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: Part[];
};
type Message = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: Part;
};
type Format = "MINIMAL" | "FULL_CONTENT" | "METADATA_ONLY";

const maxBody = 20_000,
  maxThreadMessages = 20;

const header = (part: Part | undefined, name: string) =>
  part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
    ?.value;

const decode = (data: string) => Buffer.from(data, "base64url").toString();

function findPart(part: Part | undefined, mimeType: string): Part | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && !part.filename && part.body?.data)
    return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyText(payload: Part | undefined) {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decode(plain.body.data);
  const html = findPart(payload, "text/html");
  const text = html?.body?.data ? htmlToText(decode(html.body.data)) : "";
  return text.length > maxBody
    ? `${text.slice(0, maxBody)}\n[Scope cut this email at ${maxBody} characters.]`
    : text;
}

function attachments(part: Part | undefined): object[] {
  if (!part) return [];
  const own =
    part.filename && part.body?.attachmentId
      ? [
          {
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size,
          },
        ]
      : [];
  return [...own, ...(part.parts ?? []).flatMap(attachments)];
}

const apiFormat = (format?: Format) =>
  format === "MINIMAL"
    ? "minimal"
    : format === "METADATA_ONLY"
      ? "metadata"
      : "full";

function mail(message: Message, format?: Format) {
  const base = {
    messageId: message.id,
    threadId: message.threadId,
    labels: message.labelIds ?? [],
    snippet: message.snippet,
  };
  if (format === "MINIMAL") return base;
  const h = (name: string) => header(message.payload, name);
  const meta = {
    ...base,
    from: h("From"),
    to: h("To"),
    cc: h("Cc"),
    subject: h("Subject"),
    date: h("Date"),
  };
  if (format === "METADATA_ONLY") return meta;
  return {
    ...meta,
    body: bodyText(message.payload),
    attachments: attachments(message.payload),
  };
}

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ");

const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

const base64Lines = (text: string) =>
  Buffer.from(text)
    .toString("base64")
    .replace(/.{76}(?=.)/g, "$&\r\n");

// An RFC 2822 message in base64url, as Gmail's drafts API expects.
function rawMessage(
  headers: [string, string | undefined][],
  body?: string,
  htmlBody?: string,
) {
  const lines = headers.flatMap(([name, value]) =>
    value ? [`${name}: ${oneLine(value)}`] : [],
  );
  lines.push("MIME-Version: 1.0");
  const part = (type: string, content: string) =>
    [
      `Content-Type: ${type}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(content),
    ].join("\r\n");
  if (body && htmlBody) {
    const boundary = `scope-${crypto.randomUUID()}`;
    lines.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      part("text/plain", body),
      `--${boundary}`,
      part("text/html", htmlBody),
      `--${boundary}--`,
    );
  } else
    lines.push(
      part(htmlBody ? "text/html" : "text/plain", htmlBody ?? body ?? ""),
    );
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

type When = { dateTime?: string; date?: string; timeZone?: string };
type Attendee = {
  email: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  self?: boolean;
  comment?: string;
};
type Event = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: When;
  end?: When;
  htmlLink?: string;
  hangoutLink?: string;
  organizer?: { email?: string };
  attendees?: Attendee[];
  recurrence?: string[];
  recurringEventId?: string;
};
type Guest = { email: string; optional?: boolean };

const calendarUrl = (calendarId?: string) =>
  `${calendarApi}/calendars/${enc(calendarId ?? "primary")}`;

const eventUrl = (eventId: string, calendarId?: string) =>
  `${calendarUrl(calendarId)}/events/${enc(eventId)}`;

function event(e: Event) {
  return {
    eventId: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    allDay: !!e.start?.date,
    timeZone: e.start?.timeZone,
    location: e.location,
    description: e.description?.slice(0, 4000),
    status: e.status,
    organizer: e.organizer?.email,
    attendees: e.attendees?.map((a) => ({
      email: a.email,
      response: a.responseStatus,
      optional: a.optional,
      self: a.self,
    })),
    meetUrl: e.hangoutLink,
    recurrence: e.recurrence,
    recurringEventId: e.recurringEventId,
    link: e.htmlLink,
  };
}

const sendUpdates = (level?: string) =>
  level === "NONE"
    ? "none"
    : level === "EXTERNAL_ONLY"
      ? "externalOnly"
      : "all";

const day = (value: string) => value.slice(0, 10);

function nextDay(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// All-day events end on the day after their last day.
function eventTimes(
  start?: string,
  end?: string,
  allDay?: boolean,
  timeZone?: string,
) {
  if (!allDay)
    return {
      ...(start && { start: { dateTime: start, timeZone } }),
      ...(end && { end: { dateTime: end, timeZone } }),
    };
  if (!start) return end ? { end: { date: nextDay(day(end)) } } : {};
  let last = end ? day(end) : day(start);
  if (!end || !/T00:00(:00)?/.test(end)) last = nextDay(last);
  if (last <= day(start)) last = nextDay(day(start));
  return { start: { date: day(start) }, end: { date: last } };
}

const meet = () => ({
  conferenceData: {
    createRequest: {
      requestId: crypto.randomUUID(),
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  },
});

// Recurring events need a named time zone, so use the calendar's own.
async function calendarZone(token: string, calendarId?: string) {
  const entry = await google<{ timeZone?: string }>(
    `${calendarApi}/users/me/calendarList/${enc(calendarId ?? "primary")}`,
    token,
  );
  return entry.timeZone;
}

function freeTimes(
  busy: { start: string; end: string }[],
  from: string,
  to: string,
  minutes: number,
) {
  const ranges = busy
    .map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)
    .sort((a, b) => a[0] - b[0]);
  const free: { start: string; end: string }[] = [];
  let cursor = Date.parse(from);
  const until = Date.parse(to),
    length = minutes * 60_000;
  for (const [start, end] of [...ranges, [until, until] as const]) {
    if (start - cursor >= length)
      free.push({
        start: new Date(cursor).toISOString(),
        end: new Date(Math.min(start, until)).toISOString(),
      });
    cursor = Math.max(cursor, end);
    if (cursor >= until || free.length === 20) break;
  }
  return free;
}

const pageSize = (max: number) => z.number().int().min(1).max(max).optional(),
  pageToken = z.string().max(1000).optional(),
  id = z.string().min(1).max(1024),
  time = z.iso.datetime({ offset: true }),
  calendarId = z
    .string()
    .max(500)
    .optional()
    .describe("Calendar ID from list_calendars. Default: primary calendar."),
  notificationLevel = z
    .enum(["NONE", "EXTERNAL_ONLY", "ALL"])
    .optional()
    .describe("Who gets an email about the change. Default: ALL."),
  attendees = z
    .array(z.object({ email: z.email(), optional: z.boolean().optional() }))
    .max(100)
    .optional(),
  messageFormat = z
    .enum(["MINIMAL", "FULL_CONTENT", "METADATA_ONLY"])
    .optional()
    .describe("Default: FULL_CONTENT.");

const quote = (text: string | undefined, max = 120) =>
  text
    ? `"${text.slice(0, max)}${text.length > max ? "…" : ""}"`
    : "(no subject)";

const when = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";

const notifies = (level: string | undefined, guests: number) =>
  guests === 0 || level === "NONE"
    ? ""
    : level === "EXTERNAL_ONLY"
      ? ", emailing external guests"
      : ", emailing guests";

// The title comes from Calendar, so the model cannot mislabel the event.
async function eventTitle(token: string, eventId: string, calendar?: string) {
  if (!token) return "an event";
  try {
    const found = await google<Event>(eventUrl(eventId, calendar), token);
    const start = found.start?.dateTime ?? found.start?.date;
    return found.summary
      ? `"${found.summary.slice(0, 100)}"${start ? ` on ${when(start)}` : ""}`
      : "an event";
  } catch {
    return "an event";
  }
}

function tool<Input>(
  name: string,
  description: string,
  inputSchema: z.ZodRawShape,
  summary: (input: Input, token: string) => string | Promise<string>,
  run: (token: string, input: Input) => Promise<unknown>,
): ToolImplementation {
  return { name, description, inputSchema, summary, run };
}

type Draft = {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  htmlBody?: string;
  replyToMessageId?: string;
};
type EventFields = {
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  timeZone?: string;
  addGoogleMeetUrl?: boolean;
  notificationLevel?: string;
};
type EventChange = {
  eventId: string;
  calendarId?: string;
  notificationLevel?: string;
};

export const googleTools: ToolImplementation[] = [
  tool<{
    query?: string;
    pageSize?: number;
    pageToken?: string;
    includeTrash?: boolean;
  }>(
    "gmail_search_threads",
    "Search Gmail threads with Gmail search syntax, for example `from:alex newer_than:7d`.",
    {
      query: z.string().max(1000).optional(),
      pageSize: pageSize(50),
      pageToken,
      includeTrash: z.boolean().optional(),
    },
    (input) =>
      input.query
        ? `Search mail for "${input.query.slice(0, 100)}"`
        : "List recent mail",
    async (token, input) => {
      const list = await google<{
        threads?: { id: string }[];
        nextPageToken?: string;
      }>(`${gmailApi}/threads`, token, {
        query: {
          q: input.query,
          maxResults: input.pageSize ?? 10,
          pageToken: input.pageToken,
          includeSpamTrash: input.includeTrash,
        },
      });
      const threads = await inBatches(list.threads ?? [], 5, async (t) => {
        const { messages = [] } = await google<{ messages?: Message[] }>(
          `${gmailApi}/threads/${enc(t.id)}`,
          token,
          {
            query: {
              format: "metadata",
              metadataHeaders: ["From", "Subject", "Date"],
            },
          },
        );
        const first = messages[0],
          last = messages.at(-1);
        return {
          threadId: t.id,
          subject: header(first?.payload, "Subject"),
          from: header(first?.payload, "From"),
          lastDate: header(last?.payload, "Date"),
          messages: messages.length,
          snippet: last?.snippet,
          labels: [...new Set(messages.flatMap((m) => m.labelIds ?? []))],
        };
      });
      return { threads, nextPageToken: list.nextPageToken };
    },
  ),
  tool<{ threadId: string; messageFormat?: Format }>(
    "gmail_get_thread",
    "Read one email thread.",
    { threadId: id, messageFormat },
    () => "Read an email thread",
    async (token, input) => {
      const { messages = [] } = await google<{ messages?: Message[] }>(
        `${gmailApi}/threads/${enc(input.threadId)}`,
        token,
        { query: { format: apiFormat(input.messageFormat) } },
      );
      return {
        threadId: input.threadId,
        messages: messages
          .slice(-maxThreadMessages)
          .map((m) => mail(m, input.messageFormat)),
        ...(messages.length > maxThreadMessages && {
          note: `Showing the last ${maxThreadMessages} of ${messages.length} messages.`,
        }),
      };
    },
  ),
  tool<{ messageId: string; messageFormat?: Format }>(
    "gmail_get_message",
    "Read one email.",
    { messageId: id, messageFormat },
    () => "Read an email",
    async (token, input) =>
      mail(
        await google<Message>(
          `${gmailApi}/messages/${enc(input.messageId)}`,
          token,
          { query: { format: apiFormat(input.messageFormat) } },
        ),
        input.messageFormat,
      ),
  ),
  tool<{ query?: string; pageSize?: number; pageToken?: string }>(
    "gmail_list_drafts",
    "List email drafts.",
    {
      query: z.string().max(1000).optional(),
      pageSize: pageSize(50),
      pageToken,
    },
    () => "List drafts",
    async (token, input) => {
      const list = await google<{
        drafts?: { id: string }[];
        nextPageToken?: string;
      }>(`${gmailApi}/drafts`, token, {
        query: {
          q: input.query,
          maxResults: input.pageSize ?? 10,
          pageToken: input.pageToken,
        },
      });
      const drafts = await inBatches(list.drafts ?? [], 5, async (d) => {
        const draft = await google<{ id: string; message: Message }>(
          `${gmailApi}/drafts/${enc(d.id)}`,
          token,
          { query: { format: "metadata" } },
        );
        return { draftId: draft.id, ...mail(draft.message, "METADATA_ONLY") };
      });
      return { drafts, nextPageToken: list.nextPageToken };
    },
  ),
  tool<Record<string, never>>(
    "gmail_list_labels",
    "List Gmail labels.",
    {},
    () => "List labels",
    async (token) => {
      const { labels = [] } = await google<{
        labels?: { id: string; name: string; type: string }[];
      }>(`${gmailApi}/labels`, token);
      return labels.map(({ id, name, type }) => ({ id, name, type }));
    },
  ),
  tool<Draft>(
    "gmail_create_draft",
    "Save an email as a draft. Nothing is sent. Addresses must be plain, like user@example.com.",
    {
      to: z.array(z.email()).max(100).optional(),
      cc: z.array(z.email()).max(100).optional(),
      bcc: z.array(z.email()).max(100).optional(),
      subject: z.string().max(1000).optional(),
      body: z.string().max(200_000).optional(),
      htmlBody: z.string().max(400_000).optional(),
      replyToMessageId: id.optional(),
    },
    (input) => {
      const to = [
        ...(input.to ?? []),
        ...(input.cc ?? []),
        ...(input.bcc ?? []),
      ];
      return `Draft an email${to.length ? ` to ${to.join(", ").slice(0, 200)}` : ""}: ${quote(input.subject)}`;
    },
    async (token, input) => {
      let subject = input.subject,
        threadId: string | undefined,
        inReplyTo: string | undefined,
        references: string | undefined;
      if (input.replyToMessageId) {
        const original = await google<Message>(
          `${gmailApi}/messages/${enc(input.replyToMessageId)}`,
          token,
          {
            query: {
              format: "metadata",
              metadataHeaders: ["Subject", "Message-ID", "References"],
            },
          },
        );
        threadId = original.threadId;
        inReplyTo = header(original.payload, "Message-ID");
        references = [header(original.payload, "References"), inReplyTo]
          .filter(Boolean)
          .join(" ");
        const prior = header(original.payload, "Subject") ?? "";
        subject ??= /^re:/i.test(prior) ? prior : `Re: ${prior}`;
      }
      const raw = rawMessage(
        [
          ["To", input.to?.join(", ")],
          ["Cc", input.cc?.join(", ")],
          ["Bcc", input.bcc?.join(", ")],
          ["Subject", subject && encodeHeader(oneLine(subject))],
          ["In-Reply-To", inReplyTo],
          ["References", references],
        ],
        input.body,
        input.htmlBody,
      );
      const draft = await google<{ id: string; message: Message }>(
        `${gmailApi}/drafts`,
        token,
        {
          method: "POST",
          body: { message: { raw, ...(threadId && { threadId }) } },
        },
      );
      return {
        draftId: draft.id,
        messageId: draft.message.id,
        threadId: draft.message.threadId,
        status: "Saved as a draft. Nothing was sent.",
      };
    },
  ),

  tool<{ pageSize?: number; pageToken?: string }>(
    "calendar_list_calendars",
    "List the calendars on the account.",
    { pageSize: pageSize(250), pageToken },
    () => "List calendars",
    async (token, input) => {
      const list = await google<{
        items?: {
          id: string;
          summary?: string;
          summaryOverride?: string;
          primary?: boolean;
          accessRole?: string;
          timeZone?: string;
        }[];
        nextPageToken?: string;
      }>(`${calendarApi}/users/me/calendarList`, token, {
        query: { maxResults: input.pageSize, pageToken: input.pageToken },
      });
      return {
        calendars: (list.items ?? []).map((c) => ({
          calendarId: c.id,
          name: c.summaryOverride ?? c.summary,
          primary: c.primary,
          accessRole: c.accessRole,
          timeZone: c.timeZone,
        })),
        nextPageToken: list.nextPageToken,
      };
    },
  ),
  tool<{
    calendarId?: string;
    startTime?: string;
    endTime?: string;
    timeZone?: string;
    fullText?: string;
    pageSize?: number;
    pageToken?: string;
  }>(
    "calendar_list_events",
    "List events on a calendar in a time range. Without a start or end time, lists upcoming events.",
    {
      calendarId,
      startTime: time.optional(),
      endTime: time.optional(),
      timeZone: z.string().max(100).optional(),
      fullText: z.string().max(500).optional(),
      pageSize: pageSize(250),
      pageToken,
    },
    () => "List calendar events",
    async (token, input) => {
      const list = await google<{
        items?: Event[];
        nextPageToken?: string;
        timeZone?: string;
      }>(`${calendarUrl(input.calendarId)}/events`, token, {
        query: {
          timeMin:
            input.startTime ??
            (input.endTime ? undefined : new Date().toISOString()),
          timeMax: input.endTime,
          timeZone: input.timeZone,
          q: input.fullText,
          maxResults: input.pageSize ?? 50,
          pageToken: input.pageToken,
          singleEvents: true,
          orderBy: "startTime",
        },
      });
      return {
        events: (list.items ?? []).map(event),
        timeZone: list.timeZone,
        nextPageToken: list.nextPageToken,
      };
    },
  ),
  tool<{ query: string; pageSize?: number; pageToken?: string }>(
    "calendar_search_events",
    "Search events on the primary calendar by text, from one year ago onward.",
    { query: z.string().min(1).max(500), pageSize: pageSize(250), pageToken },
    (input) => `Search events for "${input.query.slice(0, 100)}"`,
    async (token, input) => {
      const list = await google<{ items?: Event[]; nextPageToken?: string }>(
        `${calendarUrl()}/events`,
        token,
        {
          query: {
            q: input.query,
            timeMin: new Date(Date.now() - 365 * 86_400_000).toISOString(),
            maxResults: input.pageSize ?? 50,
            pageToken: input.pageToken,
            singleEvents: true,
            orderBy: "startTime",
          },
        },
      );
      return {
        events: (list.items ?? []).map(event),
        nextPageToken: list.nextPageToken,
      };
    },
  ),
  tool<{ eventId: string; calendarId?: string }>(
    "calendar_get_event",
    "Read one event.",
    { eventId: id, calendarId },
    () => "Read an event",
    async (token, input) =>
      event(
        await google<Event>(eventUrl(input.eventId, input.calendarId), token),
      ),
  ),
  tool<{
    attendeeEmails: string[];
    startTime: string;
    endTime: string;
    timeZone?: string;
    durationMinutes?: number;
  }>(
    "calendar_suggest_time",
    "Find times in a range when everyone is free. Include your own email to check your calendar too. Returns up to 20 free windows in UTC.",
    {
      attendeeEmails: z.array(z.email()).min(1).max(50),
      startTime: time,
      endTime: time,
      timeZone: z.string().max(100).optional(),
      durationMinutes: z.number().int().min(5).max(1440).optional(),
    },
    () => "Check free times",
    async (token, input) => {
      const result = await google<{
        calendars?: Record<
          string,
          {
            busy?: { start: string; end: string }[];
            errors?: { reason: string }[];
          }
        >;
      }>(`${calendarApi}/freeBusy`, token, {
        method: "POST",
        body: {
          timeMin: input.startTime,
          timeMax: input.endTime,
          timeZone: input.timeZone,
          items: input.attendeeEmails.map((email) => ({ id: email })),
        },
      });
      const calendars = Object.entries(result.calendars ?? {});
      return {
        freeTimes: freeTimes(
          calendars.flatMap(([, c]) => c.busy ?? []),
          input.startTime,
          input.endTime,
          input.durationMinutes ?? 30,
        ),
        unavailable: calendars.flatMap(([email, c]) =>
          c.errors?.length ? [{ email, reason: c.errors[0].reason }] : [],
        ),
      };
    },
  ),
  tool<
    EventFields & {
      summary: string;
      startTime: string;
      endTime: string;
      attendees?: Guest[];
      recurrenceData?: string[];
    }
  >(
    "calendar_create_event",
    "Create an event.",
    {
      summary: z.string().min(1).max(1000),
      startTime: time,
      endTime: time,
      calendarId,
      description: z.string().max(8000).optional(),
      location: z.string().max(1000).optional(),
      allDay: z.boolean().optional(),
      timeZone: z.string().max(100).optional(),
      attendees,
      recurrenceData: z.array(z.string().max(500)).max(10).optional(),
      addGoogleMeetUrl: z.boolean().optional(),
      notificationLevel,
    },
    (input) => {
      const guests = input.attendees?.length ?? 0;
      return `Create "${input.summary.slice(0, 100)}" on ${when(input.startTime)}${guests ? ` with ${guests} guest${guests === 1 ? "" : "s"}` : ""}${notifies(input.notificationLevel, guests)}`;
    },
    async (token, input) => {
      const timeZone =
        input.timeZone ??
        (input.recurrenceData?.length && !input.allDay
          ? await calendarZone(token, input.calendarId)
          : undefined);
      return event(
        await google<Event>(`${calendarUrl(input.calendarId)}/events`, token, {
          method: "POST",
          query: {
            sendUpdates: sendUpdates(input.notificationLevel),
            conferenceDataVersion: input.addGoogleMeetUrl ? 1 : undefined,
          },
          body: {
            summary: input.summary,
            description: input.description,
            location: input.location,
            ...eventTimes(
              input.startTime,
              input.endTime,
              input.allDay,
              timeZone,
            ),
            attendees: input.attendees?.map(({ email, optional }) => ({
              email,
              optional,
            })),
            recurrence: input.recurrenceData,
            ...(input.addGoogleMeetUrl && meet()),
          },
        }),
      );
    },
  ),
  tool<
    EventFields & {
      eventId: string;
      addedAttendees?: Guest[];
      removedAttendeeEmails?: string[];
    }
  >(
    "calendar_update_event",
    "Change an event. Fields that are not set stay the same.",
    {
      eventId: id,
      calendarId,
      summary: z.string().max(1000).optional(),
      description: z.string().max(8000).optional(),
      location: z.string().max(1000).optional(),
      startTime: time.optional(),
      endTime: time.optional(),
      allDay: z.boolean().optional(),
      timeZone: z.string().max(100).optional(),
      addedAttendees: attendees,
      removedAttendeeEmails: z.array(z.email()).max(100).optional(),
      addGoogleMeetUrl: z.boolean().optional(),
      notificationLevel,
    },
    async (input, token) =>
      `Change ${await eventTitle(token, input.eventId, input.calendarId)}${input.addedAttendees?.length ? `, adding ${input.addedAttendees.length} guest${input.addedAttendees.length === 1 ? "" : "s"}` : ""}${notifies(input.notificationLevel, 1)}`,
    async (token, input) => {
      const url = eventUrl(input.eventId, input.calendarId);
      let guests: Attendee[] | undefined;
      if (input.addedAttendees?.length || input.removedAttendeeEmails?.length) {
        const current = await google<Event>(url, token);
        const removed = new Set(
          input.removedAttendeeEmails?.map((e) => e.toLowerCase()),
        );
        const kept = (current.attendees ?? []).filter(
          (a) => !removed.has(a.email.toLowerCase()),
        );
        const known = new Set(kept.map((a) => a.email.toLowerCase()));
        guests = [
          ...kept,
          ...(input.addedAttendees ?? [])
            .filter((a) => !known.has(a.email.toLowerCase()))
            .map(({ email, optional }) => ({ email, optional })),
        ];
      }
      return event(
        await google<Event>(url, token, {
          method: "PATCH",
          query: {
            sendUpdates: sendUpdates(input.notificationLevel),
            conferenceDataVersion: input.addGoogleMeetUrl ? 1 : undefined,
          },
          body: {
            summary: input.summary,
            description: input.description,
            location: input.location,
            ...eventTimes(
              input.startTime,
              input.endTime,
              input.allDay,
              input.timeZone,
            ),
            attendees: guests,
            ...(input.addGoogleMeetUrl && meet()),
          },
        }),
      );
    },
  ),
  tool<
    EventChange & {
      responseStatus: "accepted" | "declined" | "tentative";
      responseComment?: string;
    }
  >(
    "calendar_respond_to_event",
    "Accept, decline or tentatively accept an invitation.",
    {
      eventId: id,
      calendarId,
      responseStatus: z.enum(["accepted", "declined", "tentative"]),
      responseComment: z.string().max(1000).optional(),
      notificationLevel,
    },
    async (input, token) =>
      `${input.responseStatus === "accepted" ? "Accept" : input.responseStatus === "declined" ? "Decline" : "Tentatively accept"} ${await eventTitle(token, input.eventId, input.calendarId)}`,
    async (token, input) => {
      const url = eventUrl(input.eventId, input.calendarId);
      const current = await google<Event>(url, token);
      if (!current.attendees?.some((a) => a.self))
        throw new ToolFailure(
          "You are not a guest on this event, so there is no invitation to answer.",
        );
      return event(
        await google<Event>(url, token, {
          method: "PATCH",
          query: { sendUpdates: sendUpdates(input.notificationLevel) },
          body: {
            attendees: current.attendees.map((a) =>
              a.self
                ? {
                    ...a,
                    responseStatus: input.responseStatus,
                    ...(input.responseComment !== undefined && {
                      comment: input.responseComment,
                    }),
                  }
                : a,
            ),
          },
        }),
      );
    },
  ),
  tool<EventChange>(
    "calendar_delete_event",
    "Delete an event.",
    { eventId: id, calendarId, notificationLevel },
    async (input, token) =>
      `Delete ${await eventTitle(token, input.eventId, input.calendarId)}${notifies(input.notificationLevel, 1)}`,
    async (token, input) => {
      await google(eventUrl(input.eventId, input.calendarId), token, {
        method: "DELETE",
        query: { sendUpdates: sendUpdates(input.notificationLevel) },
      });
      return { deleted: true, eventId: input.eventId };
    },
  ),
];
