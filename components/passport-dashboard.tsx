"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  Copy01Icon,
  Delete02Icon,
  File01Icon,
  MoreHorizontalIcon,
  PassportIcon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { api } from "../convex/_generated/api";
import { BoardShell } from "@/components/board-shell";
import { MintPassportForm } from "@/components/mint-passport-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  APP_LABELS,
  TTL_OPTIONS,
  formatRelativeTime,
  formatRemaining,
  type AppId,
} from "@/lib/capabilities";
import { STATUS_LABELS, lastEventLabel } from "@/lib/audit";

const DEFAULT_TTL_MS = TTL_OPTIONS[1]?.ttlMs ?? 60 * 60 * 1000;

export function PassportDashboard() {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const passports = useQuery(api.passports.list, { now });
  const mint = useMutation(api.passports.mint);
  const revoke = useMutation(api.passports.revoke);

  const [name, setName] = useState("");
  const [ttlMs, setTtlMs] = useState<number>(DEFAULT_TTL_MS);
  const [apps, setApps] = useState<AppId[]>([]);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintOpen, setMintOpen] = useState(false);
  const [lastMinted, setLastMinted] = useState<{
    passportId: string;
    invokeKey: string;
    name: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  function toggleApp(app: AppId) {
    setApps((prev) =>
      prev.includes(app) ? prev.filter((item) => item !== app) : [...prev, app],
    );
  }

  async function handleMint(event: FormEvent) {
    event.preventDefault();
    setMintError(null);
    if (apps.length === 0) {
      setMintError("Turn on at least one app.");
      return;
    }
    setMinting(true);
    try {
      const result = await mint({
        name: name.trim() || "Untitled agent",
        ttlMs,
        apps,
      });
      setLastMinted({
        passportId: result.passportId,
        invokeKey: result.invokeKey,
        name: result.name,
      });
      setName("");
      setApps([]);
      setNow(Date.now());
      setMintOpen(false);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  }

  async function handleRevoke(passportId: string) {
    setRevokingId(passportId);
    try {
      await revoke({ passportId });
      setNow(Date.now());
      if (lastMinted?.passportId === passportId) {
        setLastMinted(null);
      }
    } finally {
      setRevokingId(null);
    }
  }

  async function copyText(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <BoardShell title="Passports">
      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
        {lastMinted ? (
          <div className="px-4 lg:px-6">
            <Alert>
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              <AlertTitle>Minted {lastMinted.name}</AlertTitle>
              <AlertDescription>
                Give the agent this passport id and invoke key. The invoke key
                is shown once. Never standing account tokens.
              </AlertDescription>
              <div className="col-start-2 mt-3 flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs">
                    {lastMinted.passportId}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void copyText(lastMinted.passportId, lastMinted.passportId)
                    }
                  >
                    <HugeiconsIcon
                      icon={
                        copiedId === lastMinted.passportId
                          ? Tick02Icon
                          : Copy01Icon
                      }
                      strokeWidth={2}
                      data-icon="inline-start"
                    />
                    {copiedId === lastMinted.passportId ? "Copied" : "Id"}
                  </Button>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs">
                    {lastMinted.invokeKey}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void copyText(lastMinted.invokeKey, lastMinted.invokeKey)
                    }
                  >
                    <HugeiconsIcon
                      icon={
                        copiedId === lastMinted.invokeKey
                          ? Tick02Icon
                          : Copy01Icon
                      }
                      strokeWidth={2}
                      data-icon="inline-start"
                    />
                    {copiedId === lastMinted.invokeKey ? "Copied" : "Key"}
                  </Button>
                </div>
              </div>
            </Alert>
          </div>
        ) : null}

        <div className="px-4 lg:px-6">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Active passports</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">
                {passports === undefined
                  ? "…"
                  : passports.filter((row) => row.lifetimeStatus === "active")
                      .length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Passports</CardTitle>
              <CardDescription>
                {passports === undefined
                  ? "Loading cards…"
                  : passports.length === 0
                    ? "Mint a card to give an agent time-boxed access."
                    : `${passports.filter((row) => row.lifetimeStatus === "active").length} acting as you · ${passports.length} total`}
              </CardDescription>
              <CardAction>
                <Button size="sm" onClick={() => setMintOpen(true)}>
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    strokeWidth={2}
                    data-icon="inline-start"
                  />
                  Mint passport
                </Button>
              </CardAction>
            </CardHeader>
            {passports === undefined ? (
              <div className="flex flex-col gap-3 p-6">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-2/3" />
              </div>
            ) : passports.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={PassportIcon} strokeWidth={2} />
                  </EmptyMedia>
                  <EmptyTitle>No passports</EmptyTitle>
                  <EmptyDescription>
                    Mint a virtual card for a job. Agents get a passport id and
                    invoke key — never standing account tokens.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={() => setMintOpen(true)}>
                    Mint passport
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Apps</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Last event</TableHead>
                    <TableHead>Passport id</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {passports.map((passport) => {
                    const last = passport.lastEvent;
                    return (
                      <TableRow key={passport._id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/passports/${passport._id}`}
                            className="hover:underline"
                          >
                            {passport.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              passport.lifetimeStatus === "active"
                                ? "secondary"
                                : passport.lifetimeStatus === "revoked"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {STATUS_LABELS[passport.lifetimeStatus]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {passport.apps.map((app) => (
                              <Badge key={app} variant="secondary">
                                {APP_LABELS[app]}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {formatRemaining(passport.expiresAt, now)}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-56">
                          {last ? (
                            <div className="min-w-0">
                              <p
                                className={
                                  last.outcome === "allowed"
                                    ? "truncate"
                                    : "truncate text-destructive"
                                }
                              >
                                {lastEventLabel(last)}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {formatRelativeTime(last.occurredAt, now)}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-1">
                            <code className="max-w-28 truncate font-mono text-xs">
                              {passport.token}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                void copyText(passport.token, passport.token)
                              }
                            >
                              <HugeiconsIcon
                                icon={
                                  copiedId === passport.token
                                    ? Tick02Icon
                                    : Copy01Icon
                                }
                                strokeWidth={2}
                              />
                              <span className="sr-only">Copy token</span>
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon-sm" />
                              }
                            >
                              <HugeiconsIcon
                                icon={MoreHorizontalIcon}
                                strokeWidth={2}
                              />
                              <span className="sr-only">Open menu</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(`/passports/${passport._id}`)
                                }
                              >
                                <HugeiconsIcon
                                  icon={File01Icon}
                                  strokeWidth={2}
                                />
                                View history
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  void copyText(passport.token, passport.token)
                                }
                              >
                                <HugeiconsIcon
                                  icon={Copy01Icon}
                                  strokeWidth={2}
                                />
                                Copy token
                              </DropdownMenuItem>
                              {passport.lifetimeStatus === "active" ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={revokingId === passport.token}
                                    onClick={() =>
                                      void handleRevoke(passport.token)
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={Delete02Icon}
                                      strokeWidth={2}
                                    />
                                    {revokingId === passport.token
                                      ? "Revoking…"
                                      : "Revoke"}
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <Sheet open={mintOpen} onOpenChange={setMintOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Mint a passport</SheetTitle>
            <SheetDescription>
              A time-boxed card for one job. Attach any mix of GitHub, Gmail,
              Calendar, Drive, Docs, Sheets, and Slack. Revoke anytime without
              disconnecting accounts.
            </SheetDescription>
          </SheetHeader>
          <div className="px-6 pb-6">
            <MintPassportForm
              name={name}
              ttlMs={ttlMs}
              apps={apps}
              minting={minting}
              mintError={mintError}
              onNameChange={setName}
              onTtlChange={setTtlMs}
              onToggleApp={toggleApp}
              onSubmit={(event) => void handleMint(event)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </BoardShell>
  );
}
