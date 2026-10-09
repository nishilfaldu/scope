// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { googleTools } from "../lib/tools/google";
import { ToolFailure } from "../lib/tools/types";

type Call = { url: URL; method: string; body?: unknown };

function mockGoogle(reply: (call: Call) => [number, unknown?]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: URL, init: RequestInit) => {
    const call = {
      url: new URL(input),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const [status, body] = reply(call);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
    });
  });
  return calls;
}

const run = (name: string, input: unknown) =>
  googleTools.find((t) => t.name === name)!.run("token", input as never);

afterEach(() => vi.unstubAllGlobals());

test("a reply draft joins the thread, and the body cannot add headers", async () => {
  const calls = mockGoogle(({ method }) =>
    method === "GET"
      ? [
          200,
          {
            id: "m1",
            threadId: "t1",
            payload: {
              headers: [
                { name: "Subject", value: "Plans" },
                { name: "Message-Id", value: "<a@mail>" },
              ],
            },
          },
        ]
      : [200, { id: "d1", message: { id: "m2", threadId: "t1" } }],
  );
  await run("gmail_create_draft", {
    to: ["b@example.com"],
    body: "Héllo\r\nBcc: x@evil.com",
    replyToMessageId: "m1",
  });
  const { message } = calls[1].body as {
    message: { raw: string; threadId: string };
  };
  expect(message.threadId).toBe("t1");
  const raw = Buffer.from(message.raw, "base64url").toString();
  expect(raw).toContain("To: b@example.com\r\n");
  expect(raw).toContain("Subject: Re: Plans\r\n");
  expect(raw).toContain("In-Reply-To: <a@mail>\r\nReferences: <a@mail>\r\n");
  expect(raw).not.toContain("Bcc:");
  const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  expect(Buffer.from(body, "base64").toString()).toBe(
    "Héllo\r\nBcc: x@evil.com",
  );
});

test("a non-ASCII subject is encoded and new lines cannot add headers", async () => {
  const calls = mockGoogle(() => [
    200,
    { id: "d1", message: { id: "m1", threadId: "t1" } },
  ]);
  await run("gmail_create_draft", { subject: "Café\r\nBcc: x@evil.com" });
  const raw = Buffer.from(
    (calls[0].body as { message: { raw: string } }).message.raw,
    "base64url",
  ).toString();
  const subject = raw.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)![1];
  expect(Buffer.from(subject, "base64").toString()).toBe(
    "Café Bcc: x@evil.com",
  );
  expect(raw).not.toMatch(/^Bcc:/m);
});

test("a message body prefers plain text and lists attachments", async () => {
  const data = (text: string) => Buffer.from(text).toString("base64url");
  mockGoogle(() => [
    200,
    {
      id: "m1",
      threadId: "t1",
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "a@example.com" }],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/html", body: { data: data("<p>Hi</p>") } },
              { mimeType: "text/plain", body: { data: data("Hi") } },
            ],
          },
          {
            mimeType: "application/pdf",
            filename: "a.pdf",
            body: { attachmentId: "x", size: 10 },
          },
        ],
      },
    },
  ]);
  expect(await run("gmail_get_message", { messageId: "m1" })).toMatchObject({
    from: "a@example.com",
    body: "Hi",
    attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 10 }],
  });
});

test("suggest_time merges everyone's busy times", async () => {
  mockGoogle(() => [
    200,
    {
      calendars: {
        "a@example.com": {
          busy: [
            { start: "2026-10-09T09:00:00Z", end: "2026-10-09T10:00:00Z" },
          ],
        },
        "b@example.com": {
          busy: [
            { start: "2026-10-09T09:30:00Z", end: "2026-10-09T11:00:00Z" },
            { start: "2026-10-09T11:15:00Z", end: "2026-10-09T12:00:00Z" },
          ],
        },
        "c@example.com": { errors: [{ reason: "notFound" }] },
      },
    },
  ]);
  expect(
    await run("calendar_suggest_time", {
      attendeeEmails: ["a@example.com", "b@example.com", "c@example.com"],
      startTime: "2026-10-09T08:00:00Z",
      endTime: "2026-10-09T13:00:00Z",
    }),
  ).toEqual({
    freeTimes: [
      { start: "2026-10-09T08:00:00.000Z", end: "2026-10-09T09:00:00.000Z" },
      { start: "2026-10-09T12:00:00.000Z", end: "2026-10-09T13:00:00.000Z" },
    ],
    unavailable: [{ email: "c@example.com", reason: "notFound" }],
  });
});

test("an all-day event ends the day after its last day", async () => {
  const calls = mockGoogle(() => [200, { id: "e1" }]);
  await run("calendar_create_event", {
    summary: "Off",
    startTime: "2026-10-09T00:00:00Z",
    endTime: "2026-10-09T00:00:00Z",
    allDay: true,
    notificationLevel: "NONE",
  });
  expect(calls[0].url.searchParams.get("sendUpdates")).toBe("none");
  expect(calls[0].body).toMatchObject({
    start: { date: "2026-10-09" },
    end: { date: "2026-10-10" },
  });
});

test("Google errors reach the app, and a rejected token asks to reconnect", async () => {
  mockGoogle(() => [404, { error: { message: "Not Found" } }]);
  await expect(
    run("calendar_get_event", { eventId: "missing" }),
  ).rejects.toThrow(new ToolFailure("Google: Not Found"));
  mockGoogle(() => [401, { error: { message: "Invalid Credentials" } }]);
  const error = await run("calendar_get_event", { eventId: "e1" }).catch(
    (e: unknown) => e,
  );
  expect(error).not.toBeInstanceOf(ToolFailure);
});
