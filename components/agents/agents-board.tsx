"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import styles from "@/components/scope/scope.module.css";
export function AgentsBoard() {
  const connections = useQuery(api.clientConnections.forOwner, {});
  const update = useMutation(api.clientConnections.update);
  const [editing, setEditing] = useState<{
    _id: Id<"clientConnections">;
    name: string;
    stoppedAt?: number;
  } | null>(null);
  const [name, setName] = useState(""),
    [stopping, setStopping] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await update({
        id: editing._id,
        name: stopping ? undefined : name,
        stop: stopping,
      });
      setEditing(null);
      setNotice(
        stopping
          ? "Further sharing stopped for this authorization."
          : "Name updated. Requests now use this name.",
      );
    } catch {
      setError("Could not update this connection. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      const origin =
        process.env.NEXT_PUBLIC_SCOPE_ORIGIN || window.location.origin;
      await navigator.clipboard.writeText(
        `Connect to Scope through its MCP server at ${origin}/api/mcp. Sign in with my Scope account when prompted. Ask only for the account needed for my task and share the approval link with me. Reuse the same request key on retries. Choose my authorized local helper as the collector. Keep sign-in and provider credentials private; never return them in chat.`,
      );
      setNotice(
        "Connection instructions copied. Send them to the agent you want to use.",
      );
    } catch {
      setNotice("Could not copy instructions. Try again in this browser.");
    }
  }
  return (
    <BoardShell title="Agents">
      <header className={styles.pageHeading}>
        <h1>Agents</h1>
        <p>Recognize who’s asking before you approve.</p>
      </header>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <div className={styles.agentList}>
        {!connections ? (
          <p className={styles.loading}>Loading agents…</p>
        ) : !connections.length ? (
          <p className={styles.empty}>
            When an authorized agent first asks for access, its connection
            appears here.
          </p>
        ) : (
          connections.map((c) => (
            <article className={styles.agent} key={c._id}>
              <span className={styles.avatar}>
                {c.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <div>
                <h2>{c.name}</h2>
                <p>Authorized MCP connection</p>
                {c.stoppedAt !== undefined && <span>Sharing stopped</span>}
              </div>
              <button
                className={styles.textAction}
                onClick={() => {
                  setEditing(c);
                  setName(c.name);
                  setStopping(false);
                  setError("");
                }}
              >
                Edit name
              </button>
            </article>
          ))
        )}
      </div>
      <section className="mt-7">
        <h2 className="font-medium">Connect an agent</h2>
        <Button className="mt-3" variant="outline" onClick={() => void copy()}>
          Copy connection instructions
        </Button>
      </section>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>
              {stopping ? "Stop further sharing?" : "Name this connection"}
            </DialogTitle>
            <DialogDescription>
              {stopping
                ? "Previously received access and the agent’s sign-in are unaffected."
                : "More than one chat may use this authorization."}
            </DialogDescription>
          </DialogHeader>
          {!stopping && (
            <>
              <label htmlFor="agent-name">Connection name</label>
              <Input
                id="agent-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </>
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
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              className={styles.approve}
              disabled={busy || (!stopping && !name.trim())}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : stopping ? "Stop sharing" : "Save name"}
            </Button>
          </DialogFooter>
          {!stopping && editing?.stoppedAt === undefined && (
            <button
              className={styles.textAction}
              disabled={busy}
              onClick={() => setStopping(true)}
            >
              Stop further sharing
            </button>
          )}
        </DialogContent>
      </Dialog>
    </BoardShell>
  );
}
