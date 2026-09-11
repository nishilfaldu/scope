"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../convex/_generated/api";
import {
  ALL_APPS,
  APP_HINTS,
  APP_LABELS,
  TTL_OPTIONS,
  type AppId,
  formatRelativeTime,
  formatRemaining,
} from "../lib/capabilities";

const INVOKE_URL = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/api/invoke`;
const GITHUB_CONNECT_URL = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/api/github/connect`;
const DEFAULT_TTL_MS = TTL_OPTIONS[1]?.ttlMs ?? 60 * 60 * 1000;

export default function ActingAsYouPage() {
  const [now, setNow] = useState(() => Date.now());
  const passports = useQuery(api.passports.listActive, { now });
  const github = useQuery(api.connections.status, { provider: "github" });
  const mint = useMutation(api.passports.mint);
  const revoke = useMutation(api.passports.revoke);
  const disconnectGithub = useAction(api.connections.disconnect);

  const [name, setName] = useState("");
  const [ttlMs, setTtlMs] = useState<number>(DEFAULT_TTL_MS);
  const [apps, setApps] = useState<AppId[]>(["demo"]);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [lastMinted, setLastMinted] = useState<{
    passportId: string;
    name: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const githubParam = url.searchParams.get("github");
    if (!githubParam) {
      return;
    }
    if (githubParam === "denied") {
      setConnectError("GitHub access was denied.");
    } else if (githubParam !== "connected") {
      const reason = url.searchParams.get("reason");
      const messages: Record<string, string> = {
        token:
          "GitHub did not issue a token. The App callback URL must be this Convex site’s /api/github/callback.",
        state: "Connect session expired. Flip the toggle again.",
        code: "GitHub did not return an authorization code.",
        config: "GitHub App client id/secret are missing on Convex.",
      };
      setConnectError(
        (reason && messages[reason]) ||
          "GitHub connect failed. Flip the toggle again.",
      );
    }
    url.searchParams.delete("github");
    url.searchParams.delete("reason");
    const search = url.searchParams.toString();
    window.history.replaceState(
      {},
      "",
      search.length > 0 ? `${url.pathname}?${search}` : url.pathname,
    );
  }, []);

  const curlSnippet = useMemo(() => {
    if (!lastMinted) return null;
    return `curl -sS -X POST '${INVOKE_URL}' \\
  -H 'Content-Type: application/json' \\
  -d '{"passportId":"${lastMinted.passportId}","action":"demo.echo","args":{"message":"hello"}}'`;
  }, [lastMinted]);

  async function handleGithubToggle() {
    if (github === undefined || disconnecting) {
      return;
    }
    if (github.connected) {
      setDisconnecting(true);
      try {
        await disconnectGithub({ provider: "github" });
      } finally {
        setDisconnecting(false);
      }
      return;
    }
    setConnectError(null);
    const connect = new URL(GITHUB_CONNECT_URL);
    connect.searchParams.set("returnTo", window.location.origin);
    window.location.assign(connect.toString());
  }

  function toggleApp(app: AppId) {
    setApps((prev) =>
      prev.includes(app) ? prev.filter((item) => item !== app) : [...prev, app],
    );
  }

  async function handleMint(e: FormEvent) {
    e.preventDefault();
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
      setLastMinted({ passportId: result.passportId, name: result.name });
      setName("");
      setApps(["demo"]);
      setNow(Date.now());
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Agent passport
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Acting as you
        </h1>
        <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Mint a virtual passport for a job. Agents send passportId + action —
          your real GitHub token never leaves the server. Revoke anytime without
          logging out of GitHub.
        </p>
        <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="min-w-0">
            <p className="text-sm font-medium">GitHub</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {github === undefined
                ? "Checking…"
                : github.connected
                  ? `Connected as ${github.login}`
                  : "One click. Full access. Token stays on the server."}
            </p>
            {connectError && github?.connected !== true ? (
              <p className="mt-1 text-xs text-rose-500">{connectError}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-zinc-500">
              {github?.connected === true ? "On" : "Off"}
            </span>
            <button
              type="button"
              role="switch"
              aria-label="GitHub connection"
              aria-checked={github?.connected === true}
              disabled={github === undefined || disconnecting}
              onClick={() => void handleGithubToggle()}
              className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                github?.connected === true
                  ? "justify-end bg-emerald-500"
                  : "justify-start bg-zinc-800 ring-1 ring-white/20"
              }`}
            >
              <span className="size-6 rounded-full bg-white shadow" />
            </button>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="shrink-0 text-zinc-500">Invoke</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800 dark:text-zinc-200">
            {INVOKE_URL}
          </code>
          <button
            type="button"
            onClick={() => void copyText(INVOKE_URL, "invoke")}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {copiedId === "invoke" ? "Copied" : "Copy"}
          </button>
        </div>
      </header>

      <section className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Active passports</h2>
            <span className="shrink-0 text-sm text-zinc-500">
              {passports === undefined
                ? "Loading…"
                : `${passports.length} acting as you`}
            </span>
          </div>

          {passports === undefined ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              Loading passports…
            </div>
          ) : passports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              No active passports. Mint one to give an agent a time-boxed card.
            </div>
          ) : (
            <ul className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              {passports.map((passport) => (
                <li
                  key={passport._id}
                  className="flex min-w-0 flex-col gap-4 rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 to-zinc-800 p-5 text-zinc-50 shadow-sm dark:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-zinc-400">
                        Virtual passport
                      </p>
                      <h3 className="mt-1 truncate text-lg font-semibold">
                        {passport.name}
                      </h3>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      {formatRemaining(passport.expiresAt, now)}
                    </span>
                  </div>

                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-black/30 px-2.5 py-2 font-mono text-[11px] leading-4">
                    <span className="min-w-0 flex-1 truncate">
                      {passport.token}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(passport.token, passport.token)
                      }
                      className="shrink-0 rounded px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-zinc-300 hover:bg-white/10"
                    >
                      {copiedId === passport.token ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {passport.apps.map((app) => (
                      <span
                        key={app}
                        className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-zinc-200"
                      >
                        {APP_LABELS[app]}
                      </span>
                    ))}
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5 text-xs text-zinc-400">
                    {passport.logs.length === 0 ? (
                      <p>No transactions yet</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {passport.logs.map((log) => (
                          <li key={log._id} className="min-w-0">
                            <p className="truncate">
                              <span
                                className={
                                  log.ok ? "text-emerald-300" : "text-rose-300"
                                }
                              >
                                {log.action}
                              </span>
                              <span>
                                {` · ${formatRelativeTime(log._creationTime, now)}`}
                              </span>
                            </p>
                            {log.error ? (
                              <p className="truncate text-rose-300/90">
                                {log.error}
                              </p>
                            ) : log.argsPreview !== "{}" ? (
                              <p className="truncate font-mono text-[11px] text-zinc-500">
                                {log.argsPreview}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={revokingId === passport.token}
                    onClick={() => void handleRevoke(passport.token)}
                    className="mt-auto rounded-lg bg-rose-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
                  >
                    {revokingId === passport.token ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="flex h-fit min-w-0 w-full flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:max-w-none dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Mint a passport</h2>
          <form onSubmit={(e) => void handleMint(e)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. PR agent"
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Time to live
              </span>
              <select
                value={ttlMs}
                onChange={(e) => setTtlMs(Number(e.target.value))}
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
              >
                {TTL_OPTIONS.map((opt) => (
                  <option key={opt.ttlMs} value={opt.ttlMs}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Apps
              </legend>
              {ALL_APPS.map((app) => (
                <label
                  key={app}
                  className="flex min-w-0 items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <input
                    type="checkbox"
                    checked={apps.includes(app)}
                    onChange={() => toggleApp(app)}
                    className="mt-0.5 size-4 shrink-0 rounded border-zinc-400"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{APP_LABELS[app]}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {APP_HINTS[app]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {mintError ? (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {mintError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={minting}
              className="rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {minting ? "Minting…" : "Mint passport"}
            </button>
          </form>

          {curlSnippet ? (
            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Try demo.echo</p>
                <button
                  type="button"
                  onClick={() => void copyText(curlSnippet, "curl")}
                  className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  {copiedId === "curl" ? "Copied" : "Copy curl"}
                </button>
              </div>
              <pre className="max-w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-200">
                {curlSnippet}
              </pre>
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
