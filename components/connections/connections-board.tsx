"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BoardShell } from "@/components/layout/board-shell";
import { AppMark } from "@/components/scope/app-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  accountName,
  approvalPost,
  type ApprovalAccount,
} from "@/lib/approval-display";
import { APP_CONNECT_URL, CONNECT_ERRORS } from "@/lib/connections";
import styles from "@/components/scope/scope.module.css";

type ManagedAccount =
  | { app: "Airtable"; account: ApprovalAccount }
  | { app: "Slack"; id: Id<"connections">; name: string };
export function ConnectionsBoard({ returnTo }: { returnTo: string | null }) {
  const accounts = useQuery(api.probe.accountsForOwner, {}) as
    ApprovalAccount[] | undefined;
  const slack = useQuery(api.tables.connections.queries.statusesForApps, {
    apps: ["slack"],
  });
  const disconnect = useAction(api.tables.connections.actions.disconnect);
  const startOAuth = useMutation(api.tables.oauthStates.mutations.start);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [connect, setConnect] = useState<"Airtable" | "Slack" | null>(null),
    [manage, setManage] = useState<ManagedAccount | null>(null);
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result =
      url.searchParams.get("airtable") || url.searchParams.get("slack");
    if (result) {
      if (result === "connected")
        queueMicrotask(() => setNotice("Account connected."));
      else
        queueMicrotask(() =>
          setError(
            CONNECT_ERRORS[url.searchParams.get("reason") ?? ""] ||
              "Sign-in did not complete. No new account was added. Try connecting again.",
          ),
        );
      ["airtable", "slack", "reason", "account"].forEach((key) =>
        url.searchParams.delete(key),
      );
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch {
      setError(
        "Could not complete this connection. Check your sign-in and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signIn(app: "Airtable" | "Slack") {
    await run(async () => {
      if (app === "Airtable") {
        const result = await approvalPost<{ url: string }>("authorize", {});
        window.location.assign(result.url);
      } else {
        const { state, browserProof } = await startOAuth({
          app: "slack",
          returnTo: `${window.location.origin}/connections`,
        });
        sessionStorage.setItem(`scope-oauth:${state}`, browserProof);
        const url = new URL(APP_CONNECT_URL.slack);
        url.searchParams.set("state", state);
        window.location.assign(url.toString());
      }
    });
  }
  function openConnect(app: "Airtable" | "Slack") {
    setConnect(app);
    setOptions([]);
    setError("");
    if (app === "Airtable")
      void approvalPost<{ bindings: { key: string; label: string }[] }>(
        "pat-bindings",
        {},
      )
        .then((r) => setOptions(r.bindings))
        .catch(() => {});
  }
  return (
    <BoardShell title="Connections">
      <header className={styles.pageHeading}>
        <h1>Connections</h1>
        <p>Choose the accounts your agents can ask to use.</p>
      </header>
      {returnTo && (
        <p className={styles.notice}>
          <Link href={returnTo}>Return to request</Link>
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {error && !connect && !manage && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.connectionList}>
        {(["Airtable", "Slack"] as const).map((app) => (
          <section className={styles.appGroup} key={app}>
            <header>
              <AppMark app={app} />
              <h2>{app}</h2>
              <Button
                variant="ghost"
                className={styles.addAccount}
                disabled={busy}
                onClick={() => openConnect(app)}
              >
                Connect account
              </Button>
            </header>
            {app === "Airtable" ? (
              !accounts ? (
                <p className={styles.loading}>Loading accounts…</p>
              ) : accounts.length ? (
                accounts.map((a) => (
                  <div className={styles.account} key={a._id}>
                    <div>
                      <h3>{accountName(a.baseName || a.label)}</h3>
                      <p>
                        {a.providerEmail || "Identity verified by Airtable"}
                      </p>
                      {a.revoked && (
                        <p className={styles.attention}>Sharing stopped</p>
                      )}
                    </div>
                    <button
                      className={styles.textAction}
                      onClick={() => {
                        setError("");
                        setManage({ app, account: a });
                      }}
                    >
                      Manage
                    </button>
                  </div>
                ))
              ) : (
                <p className={styles.empty}>No Airtable accounts connected.</p>
              )
            ) : !slack ? (
              <p className={styles.loading}>Loading accounts…</p>
            ) : slack[0]?.accounts.length ? (
              slack[0].accounts.map((a) => (
                <div className={styles.account} key={a.id}>
                  <div>
                    <h3>{a.login}</h3>
                    <p>Identity verified by Slack</p>
                    <p>MCP access is not available yet</p>
                  </div>
                  <button
                    className={styles.textAction}
                    onClick={() => {
                      setError("");
                      setManage({ app, id: a.id, name: a.login });
                    }}
                  >
                    Manage
                  </button>
                </div>
              ))
            ) : (
              <p className={styles.empty}>No Slack accounts connected.</p>
            )}
          </section>
        ))}
      </div>
      <Dialog
        open={!!connect}
        onOpenChange={(open) => {
          if (!open && !busy) setConnect(null);
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Connect {connect}</DialogTitle>
            <DialogDescription>
              {connect === "Slack"
                ? "Account sign-in is available. Slack access through MCP is not available yet."
                : "Choose an available account or sign in to Airtable."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {connect === "Airtable" && options.length > 0 && (
            <div className="space-y-4">
              <p className={styles.detailNote}>
                Your available read-only accounts
              </p>
              {options.map((o) => (
                <div
                  className="flex items-center justify-between gap-4"
                  key={o.key}
                >
                  <span>{accountName(o.label)}</span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await approvalPost("pat", { bindingKey: o.key });
                        setConnect(null);
                        setNotice("Account connected.");
                      })
                    }
                  >
                    {busy ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConnect(null)}
            >
              Cancel
            </Button>
            <Button
              className={styles.approve}
              disabled={busy}
              onClick={() => connect && void signIn(connect)}
            >
              {busy ? "Connecting…" : `Sign in to ${connect}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!manage}
        onOpenChange={(open) => {
          if (!open && !busy) setManage(null);
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>
              {manage?.app === "Airtable"
                ? accountName(manage.account.baseName || manage.account.label)
                : manage?.name}
            </DialogTitle>
            <DialogDescription>
              {manage?.app === "Airtable" &&
              manage.account.credentialKind === "shared-pat"
                ? "Previously received access is unaffected. The Airtable credential is not revoked."
                : "Previously received access may remain active at the provider."}
            </DialogDescription>
          </DialogHeader>
          {manage?.app === "Airtable" && (
            <p className={styles.detailNote}>
              {manage.account.credentialKind === "shared-pat"
                ? "Read-only access to the verified base."
                : "Uses the permissions granted during Airtable sign-in."}
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setManage(null)}
            >
              Close
            </Button>
            {!(
              manage?.app === "Airtable" &&
              manage.account.revoked &&
              manage.account.credentialKind === "shared-pat"
            ) && (
              <Button
                className={styles.approve}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!manage) return;
                    if (manage.app === "Slack") {
                      await disconnect({
                        app: "slack",
                        connectionId: manage.id,
                      });
                      setNotice(
                        "Sharing stopped. Previously received access may remain active at Slack.",
                      );
                    } else {
                      const result = await approvalPost<{
                        sharedPat?: boolean;
                        connectRevoked: boolean;
                      }>("revoke", { id: manage.account._id });
                      setNotice(
                        result.sharedPat
                          ? "Sharing stopped. Previously received access is unaffected."
                          : result.connectRevoked
                            ? "Sharing stopped and account disconnected."
                            : "Sharing stopped. Disconnection failed; open Manage to try again.",
                      );
                    }
                    setManage(null);
                  })
                }
              >
                {busy ? "Stopping…" : "Stop sharing"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BoardShell>
  );
}
