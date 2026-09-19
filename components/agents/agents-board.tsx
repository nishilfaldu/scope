"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BoardShell } from "@/components/layout/board-shell";
import { ContentCard } from "@/components/shared/content-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AgentsBoard() {
  const agents = useQuery(api.tables.agentConnections.list);
  const revoke = useMutation(api.tables.agentConnections.revoke);
  const [busy, setBusy] = useState<Id<"agentConnections"> | null>(null);

  async function revokeAgent(id: Id<"agentConnections">) {
    setBusy(id);
    try {
      await revoke({ agentConnectionId: id });
    } finally {
      setBusy(null);
    }
  }

  return (
    <BoardShell title="Agents">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <ContentCard
            title="Connected agents"
            description="Agents you approved to address slice requests to your passport."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents?.map((agent) => (
                  <TableRow key={agent._id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          agent.status === "active" ? "default" : "secondary"
                        }
                      >
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {agent.lastUsedAt
                        ? new Date(agent.lastUsedAt).toLocaleString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {agent.status === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === agent._id}
                          onClick={() => void revokeAgent(agent._id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {agents?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No agents connected.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </ContentCard>
        </div>
      </div>
    </BoardShell>
  );
}
