"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  accountName,
  approvalPost,
  type ApprovalAccount,
} from "@/lib/approval-display";

export function AirtableAccounts() {
  const accounts = useQuery(api.probe.accountsForOwner, {}) as
    ApprovalAccount[] | undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [options, setOptions] = useState<
    { key: string; label: string }[] | null
  >(null);
  const [label, setLabel] = useState("");
  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
    } catch {
      setError(
        "Could not update this connection. Check your sign-in and account setup, then try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      id="airtable"
      className="mt-8 overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
        <div>
          <h2 className="font-semibold">Airtable</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            Read-only accounts available to the local helper. Every delivery
            needs your approval.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy}
          onClick={() =>
            void run("options", async () => {
              const result = await approvalPost<{
                bindings: { key: string; label: string }[];
              }>("pat-bindings", {});
              setOptions(result.bindings);
            })
          }
        >
          {busy === "options" ? "Loading…" : "Add account"}
        </Button>
      </div>
      {(message || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`border-b px-5 py-4 text-sm leading-6 ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {error || message}
        </p>
      )}
      {options && (
        <div className="space-y-3 border-b bg-muted/30 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Choose an account</h3>
            <Button size="sm" variant="ghost" onClick={() => setOptions(null)}>
              Close
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Adding an account does not approve agent access.
          </p>
          {!options.length && (
            <p className="text-sm">
              No accounts are available to add. Contact your Scope
              administrator.
            </p>
          )}
          {options.map((option) => (
            <div
              key={option.key}
              className="flex flex-col justify-between gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center"
            >
              <span className="break-words text-sm">
                {accountName(option.label)}
              </span>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run(option.key, async () => {
                    await approvalPost("pat", { bindingKey: option.key });
                    setOptions(null);
                    setMessage(
                      "Account verified and added. Each delivery still requires approval.",
                    );
                  })
                }
              >
                {busy === option.key ? "Verifying…" : "Add account"}
              </Button>
            </div>
          ))}
        </div>
      )}
      {!accounts ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !accounts.length ? (
        <EmptyState
          title="No Airtable accounts"
          description="Add an account to start receiving access requests."
        />
      ) : (
        <div className="divide-y">
          {accounts.map((account) => (
            <article key={account._id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-medium">
                    {accountName(account.label)}
                  </h3>
                </div>
                <Badge variant={account.revoked ? "outline" : "secondary"}>
                  {account.revoked
                    ? "Sharing blocked"
                    : account.providerUserId
                      ? "Connected"
                      : "Not verified"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy || account.revoked}
                  onClick={() =>
                    void run(account._id, async () => {
                      await approvalPost("confirm", { id: account._id });
                      setMessage("Connection checked. No access was approved.");
                    })
                  }
                >
                  {busy === account._id ? "Updating…" : "Check connection"}
                </Button>
                {(!account.revoked ||
                  account.credentialKind !== "shared-pat") && (
                  <Dialog>
                    <DialogTrigger
                      render={
                        <Button variant="ghost" size="sm" disabled={!!busy} />
                      }
                    >
                      {account.credentialKind === "shared-pat"
                        ? "Block delivery"
                        : "Disconnect account"}
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {account.credentialKind === "shared-pat"
                            ? "Block future delivery?"
                            : "Disconnect this account?"}
                        </DialogTitle>
                        <DialogDescription>
                          {accountName(account.label)}.{" "}
                          {account.credentialKind === "shared-pat"
                            ? "Stops future sharing through Scope. Access already received is unaffected."
                            : "Stops future sharing through Scope and disconnects the account where possible. Access already received may remain active."}
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose render={<Button variant="outline" />}>
                          Keep account
                        </DialogClose>
                        <DialogClose
                          render={
                            <Button
                              variant="destructive"
                              disabled={!!busy}
                              onClick={() =>
                                void run(account._id, async () => {
                                  const result = await approvalPost<{
                                    sharedPat?: boolean;
                                    connectRevoked: boolean;
                                  }>("revoke", { id: account._id });
                                  setMessage(
                                    result.sharedPat
                                      ? "Future sharing is blocked. Access already received is unaffected."
                                      : result.connectRevoked
                                        ? "Sharing stopped and account disconnected."
                                        : "Sharing stopped. Disconnection failed; try disconnecting again.",
                                  );
                                })
                              }
                            />
                          }
                        >
                          Block delivery
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <details className="border-t px-5 py-4">
        <summary className="w-fit cursor-pointer text-xs text-muted-foreground">
          Other Airtable connection options
        </summary>
        <div className="mt-4 space-y-3">
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">
            Connect another account using Airtable sign-in. Your Scope
            administrator must enable this option.
          </p>
          <label className="block text-sm font-medium" htmlFor="airtable-label">
            Account label
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="airtable-label"
              value={label}
              placeholder="e.g. Work account"
              onChange={(e) => setLabel(e.target.value)}
              className="sm:max-w-xs"
            />
            <Button
              variant="outline"
              disabled={!!busy || !label.trim()}
              onClick={() =>
                void run("oauth", async () => {
                  const result = await approvalPost<{ url: string }>(
                    "authorize",
                    { label: label.trim() },
                  );
                  location.assign(result.url);
                })
              }
            >
              Sign in to Airtable
            </Button>
          </div>
        </div>
      </details>
    </section>
  );
}
