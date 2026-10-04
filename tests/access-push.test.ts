import { afterEach, expect, test, vi } from "vitest";
import { fixture } from "./access-fixture";
import { api, components } from "../convex/_generated/api";
import { retrier } from "../convex/notifications";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: send } }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  send.mockReset();
});
async function finish(t: Awaited<ReturnType<typeof fixture>>["t"]) {
  for (let i = 0; i < 180; i++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}
async function subscribed(crash = false) {
  const f = await fixture(crash);
  vi.stubEnv("SCOPE_VAPID_PUBLIC_KEY", "synthetic");
  vi.stubEnv("SCOPE_VAPID_PRIVATE_KEY", "synthetic");
  await f.owner.mutation(api.notifications.subscribe, {
    endpoint: "https://fcm.googleapis.com/test",
    p256dh: "private-key",
    auth: "private-auth",
  });
  return f;
}
test("worker heartbeat recovers a crashed delivery, and reuse does not enqueue another prompt", async () => {
  vi.useFakeTimers();
  const enqueue = vi.spyOn(retrier, "run");
  vi.spyOn(console, "error").mockImplementation(() => {});
  send.mockResolvedValue({ statusCode: 201 });
  const f = await subscribed(true);
  const r = await f.t.mutation(api.access.request, f.requestArgs);
  await f.t.mutation(api.access.request, f.requestArgs);
  expect(enqueue).toHaveBeenCalledOnce();
  const runId = await enqueue.mock.results[0].value;
  await finish(f.t);
  expect(send).toHaveBeenCalledOnce();
  expect(JSON.parse(send.mock.calls[0][1])).toEqual({ requestId: r.id });
  expect(
    await f.t.query(components.actionRetrier.public.status, { runId }),
  ).toMatchObject({ type: "completed", result: { type: "success" } });
});
test("retry reloads current authority and skips an approval already decided", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  send.mockRejectedValue({ statusCode: 503, body: "private-auth" });
  const f = await subscribed();
  const r = await f.t.mutation(api.access.request, f.requestArgs);
  vi.advanceTimersByTime(0);
  await f.t.finishInProgressScheduledFunctions();
  expect(send).toHaveBeenCalledOnce();
  await f.owner.mutation(api.access.decide, {
    id: r.id,
    approve: false,
    minutes: 30,
  });
  await finish(f.t);
  expect(send).toHaveBeenCalledOnce();
});
