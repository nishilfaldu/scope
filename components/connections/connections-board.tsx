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
type IntegrationView = {
  id: string;
  provider: string;
  enabled: boolean;
  accessDescription: string;
};
export function ConnectionsBoard() {
  const accounts = useQuery(api.accounts.forOwner, {});
  const [integrations, setIntegrations] = useState<IntegrationView[]>();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [connect, setConnect] = useState<IntegrationView | null>(null),
    [manage, setManage] = useState<ApprovalAccount | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/accounts/integrations", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Unavailable");
        const data = await r.json();
        if (active) setIntegrations(data.integrations);
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
          : setError("Sign-in did not complete. Try connecting again."),
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
        {!integrations || !accounts ? (
          <p className={styles.loading}>Loading accounts…</p>
        ) : (
          integrations.map((integration) => {
            const rows = accounts.filter(
              (a) => a.integrationId === integration.id,
            );
            return (
              <section className={styles.appGroup} key={integration.id}>
                <header>
                  <AppMark app={integration.provider} />
                  <h2>{integration.provider}</h2>
                  {integration.enabled && (
                    <Button
                      variant="ghost"
                      className={styles.addAccount}
                      disabled={busy}
                      onClick={() => {
                        setConnect(integration);
                        setError("");
                      }}
                    >
                      Connect account
                    </Button>
                  )}
                </header>
                {rows.map((a) => (
                  <div className={styles.account} key={a._id}>
                    <div>
                      <h3>{accountName(a.baseName || a.label)}</h3>
                      {a.providerEmail && <p>{a.providerEmail}</p>}
                      {a.state === "blocked" && (
                        <p className={styles.attention}>Sharing stopped</p>
                      )}
                    </div>
                    {(a.state === "active" ||
                      a.disconnectOutcome === "failed") && (
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
                  </div>
                ))}
                {!rows.length && (
                  <p className={styles.empty}>
                    {integration.enabled
                      ? `No ${integration.provider} accounts connected.`
                      : "Connection setup is being verified."}
                  </p>
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
            <DialogDescription>{connect?.accessDescription}</DialogDescription>
          </DialogHeader>
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
                    { integrationId: connect.id },
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
            <DialogTitle>
              {accountName(manage?.baseName || manage?.label)}
            </DialogTitle>
            <DialogDescription>
              Previously received access may remain active at the provider.
            </DialogDescription>
          </DialogHeader>
          <p className={styles.detailNote}>{manage?.accessDescription}</p>
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
                      ? "Sharing stopped and account disconnected."
                      : "Sharing stopped. Disconnection failed; try again.",
                  );
                  setManage(null);
                })
              }
            >
              {busy
                ? "Stopping…"
                : manage?.state === "blocked"
                  ? "Retry disconnect"
                  : "Stop sharing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BoardShell>
  );
}
