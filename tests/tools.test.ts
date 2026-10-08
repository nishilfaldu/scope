// @vitest-environment node
import { expect, test } from "vitest";
import { githubTools } from "../lib/tools/github";
import { googleTools } from "../lib/tools/google";
import { notionTools } from "../lib/tools/notion";
import { slackTools } from "../lib/tools/slack";
import { vercelTools } from "../lib/tools/vercel";
import { connectorFor } from "../shared/connectors";
import { tools } from "../shared/tools";

const implementations = [
  ...slackTools,
  ...githubTools,
  ...notionTools,
  ...googleTools,
  ...vercelTools,
];

test("every tool has one implementation and a known provider", () => {
  expect(implementations.map((t) => t.name).sort()).toEqual(
    tools.map((t) => t.name).sort(),
  );
  for (const tool of tools) expect(connectorFor(tool.providerId)).toBeDefined();
});

test("summaries name the target", async () => {
  const summary = (name: string, input: unknown) =>
    implementations.find((t) => t.name === name)!.summary(input as never, "");
  expect(
    await summary("github_issue_write", {
      owner: "acme",
      repo: "web",
      method: "update",
      issue_number: 4,
      state: "closed",
    }),
  ).toBe("Close issue acme/web#4");
  expect(
    await summary("gmail_create_draft", {
      to: ["a@example.com"],
      subject: "Hi",
    }),
  ).toBe('Draft an email to a@example.com: "Hi"');
  expect(
    await summary("calendar_create_event", {
      summary: "Sync",
      startTime: "2026-10-09T17:00:00Z",
      attendees: [{ email: "b@example.com" }],
    }),
  ).toBe(
    'Create "Sync" on Oct 9, 2026, 5:00 PM UTC with 1 guest, emailing guests',
  );
});
