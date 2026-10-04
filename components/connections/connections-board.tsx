"use client";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
import styles from "@/components/scope/scope.module.css";
type ProviderView = {
  providerId: string;
  provider: string;
  permissions: string[];
};
export function ConnectionsBoard() {
  const accounts = useQuery(api.accounts.forOwner, {});
  const [provider, setProvider] = useState<ProviderView>();
  const [targetAccountId, setTargetAccountId] = useState<string>();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [connect, setConnect] = useState<ProviderView | null>(null),
    [manage, setManage] = useState<ApprovalAccount | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/accounts/provider", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Unavailable");
        const data = await r.json();
        if (active) setProvider(data);
      })
      .catch(() => {
        if (active)
          setError("Could not load available connections. Try again.");
      });
    const url = new URL(window.location.href),
      result = url.searchParams.get("connection");
    if (result) {
      queueMicrotask(() =>
        result === "connected"
          ? setNotice("Account connected.")
          : setError(
              result === "revocation-unavailable"
                ? "This Slack app cannot confirm full revocation. Connect an app with token rotation disabled."
                : "Sign-in did not complete. Try connecting again.",
            ),
      );
      url.searchParams.delete("connection");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
    return () => {
      active = false;
    };
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
  return (
    <BoardShell title="Connections">
      <header className={styles.pageHeading}>
        <h1>Connections</h1>
        <p>Choose the accounts your agents can ask to use.</p>
      </header>
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
        {!provider || !accounts ? (
          <p className={styles.loading}>Loading accounts…</p>
        ) : (
          [provider].map((integration) => {
            const rows = accounts.filter(
              (a) => a.providerId === integration.providerId,
            );
            return (
              <section className={styles.appGroup} key={integration.providerId}>
                <header>
                  <AppMark app={integration.provider} />
                  <h2>{integration.provider}</h2>
                  {
                    <Button
                      variant="ghost"
                      className={styles.addAccount}
                      disabled={busy}
                      onClick={() => {
                        setConnect(integration);
                        setTargetAccountId(undefined);
                        setError("");
                      }}
                    >
                      Connect account
                    </Button>
                  }
                </header>
                {rows.map((a) => (
                  <div className={styles.account} key={a._id}>
                    <div>
                      <h3>{accountName(a.label)}</h3>
                      {a.providerEmail && <p>{a.providerEmail}</p>}
                      {a.state === "blocked" && (
                        <p className={styles.attention}>
                          {a.disconnectOutcome === "succeeded"
                            ? "Disconnected"
                            : a.disconnectOutcome === "failed"
                              ? "Sharing stopped · disconnect needs retry"
                              : "Sharing stopped · disconnect pending"}
                        </p>
                      )}
                    </div>
                    {(a.state === "active" ||
                      a.disconnectOutcome !== "succeeded") && (
                      <button
                        className={styles.textAction}
                        onClick={() => {
                          setManage(a);
                          setError("");
                        }}
                      >
                        {a.state === "blocked" ? "Retry disconnect" : "Manage"}
                      </button>
                    )}
                    {a.state === "blocked" &&
                      a.disconnectOutcome === "succeeded" && (
                        <button
                          className={styles.textAction}
                          onClick={() => {
                            setConnect(integration);
                            setTargetAccountId(a._id);
                            setError("");
                          }}
                        >
                          Reconnect
                        </button>
                      )}
                  </div>
                ))}
                {!rows.length && (
                  <p className={styles.empty}>No Slack accounts connected.</p>
                )}
              </section>
            );
          })
        )}
      </div>
      <Dialog
        open={!!connect}
        onOpenChange={(open) => {
          if (!open && !busy) setConnect(null);
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Connect {connect?.provider}</DialogTitle>
            <DialogDescription>
              Review the requested access in Slack. Each approved program gets
              this connection&apos;s full permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto">
            <p className={styles.detailNote}>Requested Slack permissions</p>
            <ul className="space-y-2 text-sm">
              {connect?.permissions.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
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
              onClick={() =>
                void run(async () => {
                  if (!connect) return;
                  const result = await approvalPost<{ url: string }>(
                    "/api/accounts/authorize",
                    {
                      providerId: connect.providerId,
                      ...(targetAccountId ? { targetAccountId } : {}),
                    },
                  );
                  window.location.assign(result.url);
                })
              }
            >
              {busy ? "Connecting…" : `Sign in to ${connect?.provider}`}
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
            <DialogTitle>{accountName(manage?.label)}</DialogTitle>
            <DialogDescription>
              Disconnect stops new sharing and revokes this Slack authorization.
              Requests for this connection will no longer work.
            </DialogDescription>
          </DialogHeader>
          <p className={styles.detailNote}>
            Full connection permissions: {manage?.accessDescription}
          </p>
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
            <Button
              className={styles.approve}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!manage) return;
                  const result = await approvalPost<{ outcome: string }>(
                    "/api/accounts/disconnect",
                    { id: manage._id },
                  );
                  setNotice(
                    result.outcome === "succeeded"
                      ? "Slack authorization revoked. Account disconnected."
                      : "Sharing stopped. Slack revocation could not be confirmed; retry disconnect.",
                  );
                  setManage(null);
                })
              }
            >
              {busy
                ? "Stopping…"
                : manage?.state === "blocked"
                  ? "Retry disconnect"
                  : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BoardShell>
  );
}
