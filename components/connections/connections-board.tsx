"use client";
import { useEffect, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { BoardSkeleton } from "@/components/layout/workspace-skeleton";
import { AppMark } from "@/components/scope/app-mark";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
import { failureMessage } from "@/shared/failures.mjs";
import type { ConnectorView } from "@/lib/connector-catalog";
export function ConnectionsBoard() {
  const page = usePaginatedQuery(
    api.accounts.forOwner,
    {},
    { initialNumItems: 20 },
  );
  const accounts = page.results;
  const [providers, setProviders] = useState<ConnectorView[]>();
  const integrations = new Map((providers ?? []).map((p) => [p.providerId, p]));
  for (const account of accounts) {
    if (!integrations.has(account.providerId))
      integrations.set(account.providerId, {
        providerId: account.providerId,
        provider: account.providerName,
        available: false,
      });
  }
  const [connectingId, setConnectingId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState<ApprovalAccount | null>(null);
  useEffect(() => {
    let active = true;
    async function loadProvider() {
      try {
        const response = await fetch("/api/accounts/providers", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (active) {
          setProviders(data.providers);
          if (data.providers.some((p: ConnectorView) => !p.available))
            throw new Error("Unavailable");
          toast.close("provider-load");
        }
      } catch {
        if (!active) return;
        setProviders((current) => current ?? []);
        toast.add({
          id: "provider-load",
          timeout: 0,
          title: "Could not load available connections.",
          type: "error",
          priority: "high",
          actionProps: {
            children: "Retry",
            onClick: () => {
              void loadProvider();
            },
          },
        });
      }
    }
    void loadProvider();
    const url = new URL(window.location.href),
      result = url.searchParams.get("connection");
    if (result) {
      toast.add({
        id: "connection-result",
        title:
          result === "connected"
            ? "Account connected."
            : failureMessage(url.searchParams.get("error")),
        type: result === "connected" ? "success" : "error",
        priority: result === "connected" ? "low" : "high",
      });
      url.searchParams.delete("connection");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
    return () => {
      active = false;
      toast.close("provider-load");
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.add({
        title:
          error instanceof Error
            ? error.message
            : "Could not complete this connection. Try again.",
        type: "error",
        priority: "high",
      });
    } finally {
      setBusy(false);
    }
  }
  async function connectAccount(integration: ConnectorView) {
    setConnectingId(integration.providerId);
    await run(async () => {
      const result = await approvalPost<{ url: string }>(
        "/api/accounts/authorize",
        {
          providerId: integration.providerId,
        },
      );
      window.location.assign(result.url);
    });
    setConnectingId(undefined);
  }
  return (
    <>
      <header className={styles.pageHeading}>
        <h1>Connections</h1>
        <p>Your connected accounts.</p>
      </header>
      <div className={styles.connectionList}>
        {page.status === "LoadingFirstPage" ||
        (!providers && !accounts.length) ? (
          <BoardSkeleton kind="connections" />
        ) : (
          [...integrations.values()].map((integration) => {
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
                      disabled={busy || !integration.available}
                      onClick={() => void connectAccount(integration)}
                    >
                      {connectingId === integration.providerId && (
                        <span className={styles.spinner} aria-hidden />
                      )}
                      Connect account
                    </Button>
                  }
                </header>
                {rows.map((a) => (
                  <div className={styles.account} key={a._id}>
                    <div>
                      <h3>{accountName(a.label)}</h3>
                      {a.providerEmail && <p>{a.providerEmail}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      className={styles.actionButton}
                      disabled={busy}
                      onClick={() => setManage(a)}
                    >
                      Disconnect
                    </Button>
                    <Collapsible className={styles.accountPermissions}>
                      <CollapsibleTrigger
                        className={styles.permissionsTrigger}
                        aria-label={`Permissions for ${accountName(a.label)} (${a.grantedScopes.length || "not available"})`}
                      >
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          size={14}
                          aria-hidden
                        />
                        Permissions
                        <span className={styles.permissionsCount}>
                          {a.grantedScopes.length || "—"}
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {a.grantedScopes.length ? (
                          <>
                            <p>Recorded at connection.</p>
                            <ul className={styles.scopeList}>
                              {a.grantedScopes.map((scope) => (
                                <li key={scope}>
                                  <code>{scope}</code>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p>Granted permissions are not available.</p>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                ))}
                {!rows.length && (
                  <p className={styles.empty}>
                    No {integration.provider} accounts connected.
                  </p>
                )}
              </section>
            );
          })
        )}
      </div>
      {(page.status === "CanLoadMore" || page.status === "LoadingMore") && (
        <Button
          variant="outline"
          className="mt-4"
          disabled={page.status === "LoadingMore"}
          onClick={() => page.loadMore(20)}
        >
          Load more accounts
        </Button>
      )}
      <Dialog
        open={!!manage}
        onOpenChange={(open) => {
          if (!open && !busy) setManage(null);
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Disconnect {manage?.providerName}?</DialogTitle>
            <DialogDescription>
              Stop token collection for {accountName(manage?.label)} and revoke
              its connection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setManage(null)}
            >
              Cancel
            </Button>
            <Button
              className={styles.approve}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!manage) return;
                  const result = await approvalPost<{
                    outcome: string;
                    code?: string;
                  }>("/api/accounts/disconnect", {
                    id: manage._id,
                    grantVersion: manage.grantVersion,
                  });
                  toast.add({
                    title:
                      result.outcome === "succeeded"
                        ? "Account disconnected."
                        : failureMessage(result.code),
                    type: result.outcome === "succeeded" ? "success" : "error",
                    priority: result.outcome === "succeeded" ? "low" : "high",
                  });
                  setManage(null);
                })
              }
            >
              {busy && <span className={styles.spinner} aria-hidden />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
