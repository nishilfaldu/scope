"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AppMark } from "@/components/shared/app-mark";
import { PageHeading, Section, Spinner } from "@/components/shared/page-parts";
import { ListSkeleton } from "@/components/layout/workspace-skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { postJson } from "@/lib/format";
import { failureMessage } from "@/shared/failures.mjs";

type Account = FunctionReturnType<typeof api.accounts.list>[number];
type Provider = { providerId: string; provider: string; available: boolean };

export function AccountsBoard({ providers }: { providers: Provider[] }) {
  const accounts = useQuery(api.accounts.list, {});
  const [busy, setBusy] = useState<string>();
  const [disconnecting, setDisconnecting] = useState<Account | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href),
      result = url.searchParams.get("connection");
    if (!result) return;
    toast.add({
      title:
        result === "connected"
          ? "Account connected."
          : failureMessage(url.searchParams.get("error")),
      type: result === "connected" ? "success" : "error",
      priority: result === "connected" ? "low" : "high",
    });
    window.history.replaceState({}, "", url.pathname);
  }, []);
  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.add({
        title: error instanceof Error ? error.message : failureMessage(),
        type: "error",
        priority: "high",
      });
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <>
      <PageHeading title="Accounts">
        Agents can ask for tokens from these accounts. You approve each request.
        One account per provider.
      </PageHeading>
      <Section>
        {accounts === undefined ? (
          <ListSkeleton rows={3} />
        ) : (
          providers.map((provider) => {
            const account = accounts.find(
              (a) => a.providerId === provider.providerId,
            );
            return (
              <div
                key={provider.providerId}
                className="flex items-center gap-3 px-6 py-5"
              >
                <AppMark providerId={provider.providerId} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium">{provider.provider}</h2>
                  <p className="truncate text-xs text-scope-quiet">
                    {account?.label ??
                      (provider.available ? "Not connected" : "Not configured")}
                  </p>
                </div>
                {account && (
                  <Button
                    variant="ghost"
                    className="rounded-lg text-scope-quiet hover:bg-scope-hover"
                    disabled={!!busy}
                    onClick={() => setDisconnecting(account)}
                  >
                    Disconnect
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="rounded-lg text-scope-green hover:bg-scope-hover"
                  disabled={!!busy || !provider.available}
                  onClick={() =>
                    void run(provider.providerId, async () => {
                      const { url } = await postJson<{ url: string }>(
                        "/api/accounts/connect",
                        { providerId: provider.providerId },
                      );
                      window.location.assign(url);
                    })
                  }
                >
                  {busy === provider.providerId && <Spinner />}
                  {account ? "Reconnect" : "Connect"}
                </Button>
              </div>
            );
          })
        )}
      </Section>
      <Dialog
        open={!!disconnecting}
        onOpenChange={(open) => {
          if (!open && !busy) setDisconnecting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {disconnecting?.label}?</DialogTitle>
            <DialogDescription>
              Scope asks Vercel Connect to revoke this grant and ends active
              approvals for it. Tokens already given to agents can stay valid if
              the provider does not support revocation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => setDisconnecting(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-scope-green text-white hover:bg-scope-green-dark"
              disabled={!!busy}
              onClick={() =>
                void run("disconnect", async () => {
                  if (!disconnecting) return;
                  await postJson("/api/accounts/disconnect", {
                    id: disconnecting._id,
                  });
                  toast.add({
                    title: "Account disconnected.",
                    type: "success",
                  });
                  setDisconnecting(null);
                })
              }
            >
              {busy === "disconnect" && <Spinner />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
