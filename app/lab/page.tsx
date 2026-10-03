"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { useNow } from "@/hooks/use-now";
import type { Id } from "@/convex/_generated/dataModel";

type Dashboard = {
  accounts: {
    _id: Id<"probeAccounts">;
    label: string;
    providerUserId?: string;
    revoked: boolean;
    credentialKind?: "shared-pat";
  }[];
  requests: {
    _id: Id<"probeRequests">;
    accountId: Id<"probeAccounts">;
    reason: string;
    requester: string;
    status: string;
    expiresAt: number;
    deliveredAt?: number;
    receivedAt?: number;
    decidedAt?: number;
  }[];
  credentials: {
    id: string;
    accountId: string;
    expiresAt: number;
  }[];
};
export default function Lab() {
  const now = useNow();
  const cancel = useMutation(api.probe.cancel);
  const accounts = useQuery(api.probe.accountsForOwner, {});
  const requestsPage = usePaginatedQuery(
    api.probe.requestsForOwner,
    {},
    { initialNumItems: 20 },
  );
  const credentialsPage = usePaginatedQuery(
    api.probe.credentialsForOwner,
    {},
    { initialNumItems: 20 },
  );
  const data = accounts
    ? ({
        accounts,
        requests: requestsPage.results,
        credentials: credentialsPage.results,
      } as Dashboard)
    : undefined;
  const focusedRequest = useRef(false);
  useEffect(() => {
    if (focusedRequest.current) return;
    const id = new URL(window.location.href).searchParams.get("request");
    const element = id ? document.getElementById(`request-${id}`) : null;
    if (element) {
      element.scrollIntoView({ block: "start" });
      focusedRequest.current = true;
    }
  }, [requestsPage.results]);
  const decide = useMutation(api.probe.decide),
    subscribe = useMutation(api.probe.subscribe);
  const [message, setMessage] = useState("");
  const [label, setLabel] = useState("Airtable A");
  const [patOptions, setPatOptions] = useState<
    { key: string; label: string }[]
  >([]);
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
    <BoardShell title="Approvals">
      <main className="mx-auto w-full max-w-3xl space-y-8 p-6">
        <h1 className="text-3xl font-semibold">Scope approvals</h1>
        <p>
          Approve each release of access to the selected account. Provider
          credentials stay inside the local helper.
        </p>
        <nav className="flex gap-4 text-sm underline">
          <a href="#approvals">Requests</a>
          <a href="#history">History</a>
          <a href="#accounts">Accounts</a>
          <a href="#setup">Phone setup</a>
        </nav>
        <p role="status">{message}</p>
        <section id="approvals" className="space-y-3 scroll-mt-6">
          <h2 className="text-xl font-semibold">Approval requests</h2>
          {data?.requests.map((r) => (
            <article
              id={`request-${r._id}`}
              key={r._id}
              className="space-y-2 rounded border p-3 scroll-mt-6 target:ring-2 target:ring-current"
            >
              <strong>
                {data.accounts.find((a) => a._id === r.accountId)?.label}
              </strong>
              <p>{r.reason}</p>
              <p className="break-all text-xs">Requester: {r.requester}</p>
              <p>
                {r.status === "pending" && r.expiresAt <= now
                  ? "expired"
                  : r.status}{" "}
                · approval window ends {new Date(r.expiresAt).toLocaleString()}
              </p>
              {r.receivedAt ? (
                <p>
                  Helper confirmed receipt at{" "}
                  {new Date(r.receivedAt).toLocaleString()}.
                </p>
              ) : r.deliveredAt ? (
                <p>Delivery attempted; receipt has not been confirmed.</p>
              ) : r.status === "approved" ? (
                <p>Approved; waiting for the helper to collect access.</p>
              ) : null}
              {r.status === "pending" && r.expiresAt > now && (
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
              {r.status === "approved" && r.expiresAt > now && (
                <button
                  className="underline"
                  onClick={() =>
                    void run(async () => {
                      await cancel({ id: r._id });
                    })
                  }
                >
                  Stop further delivery
                </button>
              )}
            </article>
          ))}
          {data && !data.requests.length && <p>No approval requests yet.</p>}
          {requestsPage.status === "CanLoadMore" && (
            <button
              className="underline"
              onClick={() => requestsPage.loadMore(20)}
            >
              Load older requests
            </button>
          )}
          <p className="text-xs">
            Stopping delivery does not revoke a credential already received.
          </p>
        </section>
        <section id="history" className="space-y-3">
          <h2 className="text-xl font-semibold">Delivered credentials</h2>
          {data?.credentials.map((c) => (
            <details key={c.id} className="rounded border p-3">
              <summary>
                {data.accounts.find((a) => a._id === c.accountId)?.label} ·
                {data.accounts.find((a) => a._id === c.accountId)
                  ?.credentialKind === "shared-pat"
                  ? "First Connect response expiry"
                  : "First observed expiry"}{" "}
                {new Date(c.expiresAt).toLocaleString()}
              </summary>
              <DeliveryHistory id={c.id as Id<"probeCredentials">} />
            </details>
          ))}
          {credentialsPage.status === "CanLoadMore" && (
            <button
              className="underline"
              onClick={() => credentialsPage.loadMore(20)}
            >
              Load older credentials
            </button>
          )}
        </section>
        <section id="setup" className="space-y-3">
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
          <h2 className="text-xl font-semibold">Agent sign-in</h2>
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
            Continue agent authorization
          </button>
        </section>
        <section id="accounts" className="space-y-3">
          <h2 className="text-xl font-semibold">Airtable accounts</h2>
          <button
            className="rounded border px-4 py-2"
            onClick={() =>
              void run(async () => {
                const result = await post("pat-bindings", {});
                setPatOptions(result.bindings);
              })
            }
          >
            Choose a read-only test account
          </button>
          {patOptions.map((binding) => (
            <button
              key={binding.key}
              className="rounded border px-4 py-2"
              onClick={() =>
                void run(async () => {
                  await post("pat", { bindingKey: binding.key });
                  setMessage(
                    `${binding.label} verified. Each delivery requires approval; PAT expiry remains unverified.`,
                  );
                })
              }
            >
              Add {binding.label}
            </button>
          ))}
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
          <p className="text-sm">
            Account identity is pinned after verification. Connect a new account
            to change identity.
          </p>
          {data?.accounts.map((a) => (
            <article key={a._id} className="space-y-2 rounded border p-3">
              <strong>{a.label}</strong>
              <p>
                {a.providerUserId ?? "Authorization not verified"}{" "}
                {a.revoked ? "· Revoked" : ""}
                {a.credentialKind === "shared-pat"
                  ? " · Shared PAT; provider expiry unverified"
                  : ""}
              </p>
              <code className="break-all text-xs">{a._id}</code>
              <div>
                <button
                  className="mr-4 underline"
                  onClick={() =>
                    void run(async () => {
                      const r = await post("confirm", { id: a._id });
                      setMessage(
                        `Verified ${r.providerUserId}; ${a.credentialKind === "shared-pat" ? "Connect response expires (PAT expiry unverified)" : "provider expiry"} ${new Date(r.expiresAt).toLocaleString()}`,
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
                        r.sharedPat
                          ? "Future Scope delivery blocked. The shared PAT remains active at Airtable."
                          : r.connectRevoked
                            ? "Future delivery blocked; Connect grant revoked. Issued token validity is provider-dependent."
                            : "Future delivery blocked. Connect revocation failed; retry required.",
                      );
                    })
                  }
                >
                  {a.credentialKind === "shared-pat"
                    ? "Block future delivery"
                    : "Disconnect account"}
                </button>
              </div>
            </article>
          ))}
        </section>
      </main>
    </BoardShell>
  );
}

function DeliveryHistory({ id }: { id: Id<"probeCredentials"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.probe.credentialDeliveries,
    { id },
    { initialNumItems: 10 },
  );
  return (
    <div className="space-y-3 pt-3">
      <p>Approved recipients</p>
      {results.map((r) => (
        <article key={r.id} className="border-t pt-2 text-sm">
          <p className="break-all">{r.requester}</p>
          <p>{r.reason}</p>
          <p>
            {r.receivedAt
              ? `Receipt confirmed ${new Date(r.receivedAt).toLocaleString()}`
              : r.deliveredAt
                ? "Delivery attempted; receipt unconfirmed"
                : "Ready; not delivered"}{" "}
            · {r.deliveryAttempts} delivery attempts
          </p>
          <p>Delivery expiry: {new Date(r.expiresAt).toLocaleString()}</p>
        </article>
      ))}
      {status === "CanLoadMore" && (
        <button className="underline" onClick={() => loadMore(10)}>
          Load more recipients
        </button>
      )}
    </div>
  );
}
