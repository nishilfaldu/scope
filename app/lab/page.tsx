"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Dashboard = {
  accounts: {
    _id: Id<"probeAccounts">;
    label: string;
    providerUserId?: string;
    revoked: boolean;
  }[];
  requests: {
    _id: Id<"probeRequests">;
    accountId: Id<"probeAccounts">;
    reason: string;
    requester: string;
    status: string;
    expiresAt: number;
  }[];
  credentials: {
    id: string;
    accountId: string;
    expiresAt: number;
    recipients: string[];
  }[];
};
export default function Lab() {
  const data = useQuery(api.probe.dashboard, {}) as Dashboard | undefined;
  const decide = useMutation(api.probe.decide),
    subscribe = useMutation(api.probe.subscribe);
  const [message, setMessage] = useState("");
  const [label, setLabel] = useState("Airtable A");
  async function post(operation: string, body: unknown) {
    const response = await fetch("/api/probe/" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error("Operation unavailable; check setup and sign-in.");
    return response.json();
  }
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch {
      setMessage("Operation unavailable; check setup and sign-in.");
    }
  }
  async function notifications() {
    const registration = await navigator.serviceWorker.register(
      "/probe-sw.js",
      { scope: "/lab", updateViaCache: "none" },
    );
    if (
      Notification.permission !== "granted" &&
      (await Notification.requestPermission()) !== "granted"
    )
      throw new Error("Permission denied");
    await navigator.serviceWorker.ready;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) throw new Error("Push is not configured");
    const key = Uint8Array.from(
      atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const s = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    const json = s.toJSON();
    await subscribe({
      endpoint: s.endpoint,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    });
    setMessage("Notifications enabled.");
  }
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-3xl font-semibold">Scope approval lab</h1>
      <p>Experimental flow. Existing Slack access remains available.</p>
      <p role="status">{message}</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Phone setup</h2>
        <p>
          On iPhone, use Share → Add to Home Screen, open Scope from its icon,
          then enable notifications. Approval requires your Scope sign-in.
        </p>
        <button
          className="rounded border px-4 py-2"
          onClick={() => void run(notifications)}
        >
          Enable notifications
        </button>
        <button
          className="ml-2 rounded border px-4 py-2"
          onClick={() =>
            void run(async () => {
              const result = await post("push-test", {});
              setMessage(
                `Push service accepted ${result.sent}; failed ${result.failed}. Confirm receipt on your device.`,
              );
            })
          }
        >
          Send test notification
        </button>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">MCP sign-in</h2>
        <button
          className="rounded border px-4 py-2"
          onClick={() =>
            void run(async () => {
              const id = new URL(location.href).searchParams.get(
                "external_auth_id",
              );
              if (!id)
                throw new Error("Start sign-in from the MCP client first");
              const result = await post("workos", { external_auth_id: id });
              location.assign(result.url);
            })
          }
        >
          Continue WorkOS authorization
        </button>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Airtable accounts</h2>
        <input
          aria-label="Account label"
          className="rounded border p-2"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="ml-2 rounded border px-4 py-2"
          onClick={() =>
            void run(async () => {
              const result = await post("authorize", { label });
              location.assign(result.url);
            })
          }
        >
          Connect account
        </button>
        {data?.accounts.map((a) => (
          <article key={a._id} className="space-y-2 rounded border p-3">
            <strong>{a.label}</strong>
            <p>
              {a.providerUserId ?? "Authorization not verified"}{" "}
              {a.revoked ? "· Revoked" : ""}
            </p>
            <code className="break-all text-xs">{a._id}</code>
            <div>
              <button
                className="mr-4 underline"
                onClick={() =>
                  void run(async () => {
                    const r = await post("confirm", { id: a._id });
                    setMessage(
                      `Verified ${r.providerUserId}; provider expiry ${new Date(r.expiresAt).toLocaleString()}`,
                    );
                  })
                }
              >
                Verify API access
              </button>
              <button
                className="underline"
                onClick={() =>
                  void run(async () => {
                    const r = await post("revoke", { id: a._id });
                    setMessage(
                      r.connectRevoked
                        ? "Future delivery blocked; Connect grant revoked. Issued token validity is provider-dependent."
                        : "Future delivery blocked. Connect revocation failed; retry required.",
                    );
                  })
                }
              >
                Revoke
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Approval requests</h2>
        {data?.requests.map((r) => (
          <article key={r._id} className="space-y-2 rounded border p-3">
            <strong>
              {data.accounts.find((a) => a._id === r.accountId)?.label}
            </strong>
            <p>{r.reason}</p>
            <p className="break-all text-xs">Requester: {r.requester}</p>
            <p>
              {r.status} · expires {new Date(r.expiresAt).toLocaleString()}
            </p>
            {r.status === "pending" && (
              <div>
                <button
                  className="mr-4 rounded border px-4 py-2"
                  onClick={() =>
                    void run(async () => {
                      await decide({ id: r._id, approve: true });
                    })
                  }
                >
                  Approve
                </button>
                <button
                  className="rounded border px-4 py-2"
                  onClick={() =>
                    void run(async () => {
                      await decide({ id: r._id, approve: false });
                    })
                  }
                >
                  Deny
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Delivered credentials</h2>
        {data?.credentials.map((c) => (
          <details key={c.id} className="rounded border p-3">
            <summary>
              {data.accounts.find((a) => a._id === c.accountId)?.label} ·
              expires {new Date(c.expiresAt).toLocaleString()}
            </summary>
            <p>Recipient agents</p>
            <ul>
              {c.recipients.map((r) => (
                <li className="break-all text-xs" key={r}>
                  {r}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </main>
  );
}
