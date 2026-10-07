"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  Empty,
  PageHeading,
  Section,
  Spinner,
} from "@/components/shared/page-parts";
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
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { errorMessage, formatTime, initials } from "@/lib/format";

type Agent = FunctionReturnType<typeof api.agents.list>[number];

export function AgentsBoard() {
  const agents = useQuery(api.agents.list, {});
  const create = useMutation(api.agents.create),
    remove = useMutation(api.agents.remove);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string>();
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.add({
        title: errorMessage(error),
        type: "error",
        priority: "high",
      });
    } finally {
      setBusy(false);
    }
  }
  function closeCreate() {
    setCreating(false);
    setName("");
    setToken(undefined);
  }
  return (
    <>
      <PageHeading title="Agents">
        Each agent signs in to the Scope CLI with its own token. Requests show
        the agent name.
      </PageHeading>
      <Section
        action={
          <Button
            variant="ghost"
            className="rounded-lg text-scope-green hover:bg-scope-hover"
            onClick={() => setCreating(true)}
          >
            New agent
          </Button>
        }
      >
        {agents === undefined ? (
          <ListSkeleton />
        ) : agents.length ? (
          agents.map((agent) => (
            <div key={agent._id} className="flex items-center gap-3 px-6 py-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-scope-hover text-xs font-semibold text-scope-green">
                {initials(agent.name)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium">{agent.name}</h2>
                <p className="text-xs text-scope-quiet">
                  {agent.lastUsedAt
                    ? `Last used ${formatTime(agent.lastUsedAt)}`
                    : `Created ${formatTime(agent._creationTime)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                className="rounded-lg text-scope-quiet hover:bg-scope-hover"
                onClick={() => setDeleting(agent)}
              >
                Delete
              </Button>
            </div>
          ))
        ) : (
          <Empty>Create an agent to use the Scope CLI.</Empty>
        )}
      </Section>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open && !busy) closeCreate();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {token ? "Copy the agent token" : "New agent"}
            </DialogTitle>
            <DialogDescription>
              {token
                ? "Scope shows this token only once. Paste it when the CLI asks."
                : "Use a name you will recognize in approval requests."}
            </DialogDescription>
          </DialogHeader>
          {token ? (
            <div className="space-y-3">
              <code className="block rounded-lg bg-scope-wash p-3 text-xs break-all">
                {token}
              </code>
              <code className="block rounded-lg bg-scope-wash p-3 text-xs">
                pnpm scope login --origin {window.location.origin}
              </code>
            </div>
          ) : (
            <Input
              autoFocus
              placeholder="Research assistant"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <DialogFooter>
            {token ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(token)
                      .then(() => toast.add({ title: "Token copied." }))
                  }
                >
                  Copy token
                </Button>
                <Button onClick={closeCreate}>Done</Button>
              </>
            ) : (
              <Button
                className="bg-scope-green text-white hover:bg-scope-green-dark"
                disabled={busy || !name.trim()}
                onClick={() =>
                  void run(async () => {
                    setToken((await create({ name })).token);
                  })
                }
              >
                {busy && <Spinner />}
                Create agent
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Its token stops working and its open requests and approvals end.
              Tokens it already collected stay valid until the provider expires
              them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!deleting) return;
                  await remove({ id: deleting._id });
                  setDeleting(null);
                })
              }
            >
              {busy && <Spinner />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
