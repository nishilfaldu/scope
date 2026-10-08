import { z } from "zod";
import type { ToolImplementation } from "./types";
import { callUpstream, proxy } from "./upstream";

const calendarServer = "https://calendarmcp.googleapis.com/mcp/v1";
const gmail = proxy("https://gmailmcp.googleapis.com/mcp/v1", "gmail"),
  calendar = proxy(calendarServer, "calendar");

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
    .optional();

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
    const text = await callUpstream(calendarServer, token, "get_event", {
      eventId,
      ...(calendar && { calendarId: calendar }),
    });
    const event = JSON.parse(text) as { summary?: string; startTime?: string };
    return event.summary
      ? `"${event.summary.slice(0, 100)}"${event.startTime ? ` on ${when(event.startTime)}` : ""}`
      : "an event";
  } catch {
    return "an event";
  }
}

type Draft = { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string };
type EventChange = {
  eventId: string;
  calendarId?: string;
  notificationLevel?: string;
};

export const googleTools: ToolImplementation[] = [
  gmail<{ query?: string }>(
    "search_threads",
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
  ),
  gmail(
    "get_thread",
    "Read one email thread.",
    { threadId: id, messageFormat },
    () => "Read an email thread",
  ),
  gmail(
    "get_message",
    "Read one email.",
    { messageId: id, messageFormat },
    () => "Read an email",
  ),
  gmail(
    "list_drafts",
    "List email drafts.",
    {
      query: z.string().max(1000).optional(),
      pageSize: pageSize(50),
      pageToken,
    },
    () => "List drafts",
  ),
  gmail("list_labels", "List Gmail labels.", {}, () => "List labels"),
  gmail<Draft>(
    "create_draft",
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
  ),

  calendar(
    "list_calendars",
    "List the calendars on the account.",
    { pageSize: pageSize(250), pageToken },
    () => "List calendars",
  ),
  calendar(
    "list_events",
    "List events on a calendar in a time range.",
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
  ),
  calendar<{ query: string }>(
    "search_events",
    "Search events by text.",
    { query: z.string().min(1).max(500), pageSize: pageSize(250), pageToken },
    (input) => `Search events for "${input.query.slice(0, 100)}"`,
  ),
  calendar(
    "get_event",
    "Read one event.",
    { eventId: id, calendarId },
    () => "Read an event",
  ),
  calendar(
    "suggest_time",
    "Find free times for a group of people.",
    {
      attendeeEmails: z.array(z.email()).min(1).max(50),
      startTime: time,
      endTime: time,
      timeZone: z.string().max(100).optional(),
      durationMinutes: z.number().int().min(5).max(1440).optional(),
    },
    () => "Check free times",
  ),
  calendar<{
    summary: string;
    startTime: string;
    attendees?: unknown[];
    notificationLevel?: string;
  }>(
    "create_event",
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
  ),
  calendar<EventChange & { addedAttendees?: unknown[] }>(
    "update_event",
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
  ),
  calendar<EventChange & { responseStatus: string }>(
    "respond_to_event",
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
  ),
  calendar<EventChange>(
    "delete_event",
    "Delete an event.",
    { eventId: id, calendarId, notificationLevel },
    async (input, token) =>
      `Delete ${await eventTitle(token, input.eventId, input.calendarId)}${notifies(input.notificationLevel, 1)}`,
  ),
];
