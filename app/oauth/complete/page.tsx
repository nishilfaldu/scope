"use client";

import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isAppId } from "@/convex/domain/apps";

export default function OAuthCompletePage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const complete = useAction(api.tables.oauthStates.finish.complete);
  const [message, setMessage] = useState("Completing connection…");
  const started = useRef(false);
  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state");
    const code = params.get("code");
    const app = params.get("app");
    const error = params.get("error");
    if (!state || !app || !isAppId(app) || error || !code) {
      queueMicrotask(() =>
        setMessage(
          error
            ? "Connection was denied."
            : "Connection callback is incomplete.",
        ),
      );
      return;
    }
    const key = `scope-oauth:${state}`;
    const browserProof = sessionStorage.getItem(key);
    if (!browserProof) {
      queueMicrotask(() =>
        setMessage(
          "This connection must finish in the browser that started it.",
        ),
      );
      return;
    }
    sessionStorage.removeItem(key);
    void complete({ app, state, code, browserProof })
      .then((result) => {
        const url = new URL(result.returnTo);
        url.searchParams.set(app, result.connected ? "connected" : "error");
        if (result.reason) url.searchParams.set("reason", result.reason);
        window.location.replace(url.toString());
      })
      .catch(() =>
        setMessage(
          "Connection could not be verified. Start again from Connections.",
        ),
      );
  }, [complete, isAuthenticated, isLoading]);
  return (
    <main className="mx-auto max-w-lg p-10">
      <h1 className="text-xl font-semibold">Connect account</h1>
      <p className="mt-3 text-sm">
        {!isLoading && !isAuthenticated
          ? "Sign in with the Scope account that started this connection."
          : message}
      </p>
    </main>
  );
}
