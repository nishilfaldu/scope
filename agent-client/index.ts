/** Small, runtime-owned client for the Agent Passport HTTP protocol. Never log its stored state. */
export type AccessRequest = {
  agentName: string;
  apps: string[];
  ttlMs: number;
  reason?: string;
};

export type SliceCredentials = {
  sliceToken: string;
  sliceSecret: string;
  expiresAt: number;
  apps: string[];
};

export type Credential = {
  accessToken: string;
  tokenType: "Bearer";
  app: string;
  expiresAt: number | null;
  expiresIn: number | null;
};

export type AgentPassportState = {
  request?: {
    payload: AccessRequest;
    idempotencyKey: string;
    claimHandle?: string;
    approvalUrl?: string;
  };
  slice?: SliceCredentials;
  pendingMint?: { app: string; requestId: string; approvalUrl: string };
};

export interface AgentPassportStore {
  read(): Promise<AgentPassportState>;
  write(state: AgentPassportState): Promise<void>;
}

export class AgentPassportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly nextAction?: string,
  ) {
    super(message);
    this.name = "AgentPassportError";
  }
}

type Pending = { status: "approval_required"; approvalUrl: string };
type Ready<T> = { status: "ready"; value: T };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal?.reason); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AgentPassportClient {
  private readonly baseUrl: string;
  private readonly store: AgentPassportStore;
  private readonly transport: typeof fetch;

  constructor(options: { baseUrl: string; store: AgentPassportStore; fetch?: typeof fetch }) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      throw new Error("Agent Passport requires HTTPS outside localhost");
    }
    this.baseUrl = url.origin;
    this.store = options.store;
    this.transport = options.fetch ?? fetch;
  }

  private async post(path: string, body: object, idempotencyKey?: string): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await this.transport(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const raw: unknown = await response.json();
    if (!isRecord(raw)) throw new AgentPassportError("Invalid API response", "INVALID_RESPONSE", true);
    if (!response.ok && response.status !== 202) {
      throw new AgentPassportError(
        typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`,
        typeof raw.code === "string" ? raw.code : "HTTP_ERROR",
        raw.retryable === true,
        typeof raw.nextAction === "string" ? raw.nextAction : undefined,
      );
    }
    return { status: response.status, data: raw };
  }

  async capabilities(): Promise<unknown> {
    const response = await this.transport(`${this.baseUrl}/api/capabilities`);
    if (!response.ok) throw new AgentPassportError("Could not discover capabilities", "HTTP_ERROR", true);
    return response.json();
  }

  async requestAccess(payload: AccessRequest): Promise<Pending | Ready<SliceCredentials>> {
    const state = await this.store.read();
    if (state.request && JSON.stringify(state.request.payload) !== JSON.stringify(payload)) {
      throw new AgentPassportError("A different access request is already stored", "ACTIVE_REQUEST", false, "Use a separate store for each agent task.");
    }
    if (state.slice) {
      if (state.slice.expiresAt <= Date.now()) {
        throw new AgentPassportError("Stored access has expired", "EXPIRED", false, "Start a new task with a fresh private store.");
      }
      return { status: "ready", value: state.slice };
    }
    const request = state.request ?? { payload, idempotencyKey: crypto.randomUUID() };
    if (!state.request) await this.store.write({ ...state, request });
    if (request.claimHandle && request.approvalUrl) {
      return { status: "approval_required", approvalUrl: request.approvalUrl };
    }
    const { data } = await this.post("/api/access-requests", payload, request.idempotencyKey);
    if (typeof data.claimHandle !== "string" || typeof data.approvalUrl !== "string") {
      throw new AgentPassportError("Access request response omitted its handoff", "INVALID_RESPONSE", true);
    }
    await this.store.write({ ...state, request: { ...request, claimHandle: data.claimHandle, approvalUrl: data.approvalUrl } });
    return { status: "approval_required", approvalUrl: data.approvalUrl };
  }

  async waitForAccess(options: { signal?: AbortSignal; pollMs?: number } = {}): Promise<SliceCredentials> {
    const pollMs = Math.max(1000, options.pollMs ?? 2500);
    for (;;) {
      const state = await this.store.read();
      if (state.slice) return state.slice;
      if (!state.request) throw new AgentPassportError("No access request is stored", "INVALID_REQUEST", false);
      if (!state.request.claimHandle) {
        await this.requestAccess(state.request.payload);
        continue;
      }
      const { data } = await this.post("/api/access-requests/status", { claimHandle: state.request.claimHandle });
      if (data.status === "approved" || data.status === "claimed") {
        const claim = await this.post("/api/access-requests/claim", { claimHandle: state.request.claimHandle });
        if (claim.status === 200 && typeof claim.data.sliceToken === "string" &&
          typeof claim.data.sliceSecret === "string" && typeof claim.data.expiresAt === "number" &&
          Array.isArray(claim.data.apps)) {
          const slice: SliceCredentials = {
            sliceToken: claim.data.sliceToken, sliceSecret: claim.data.sliceSecret,
            expiresAt: claim.data.expiresAt, apps: claim.data.apps as string[],
          };
          await this.store.write({ ...state, slice });
          return slice;
        }
      }
      await pause(pollMs, options.signal);
    }
  }

  async getCredential(app: string): Promise<Pending | Ready<Credential>> {
    const state = await this.store.read();
    if (!state.slice) throw new AgentPassportError("Approve and claim access first", "NO_SLICE", false);
    if (state.pendingMint && state.pendingMint.app !== app) {
      throw new AgentPassportError("Another credential approval is pending", "ACTIVE_REQUEST", false);
    }
    const path = state.pendingMint ? "/api/credentials/claim" : "/api/credentials";
    const body = state.pendingMint
      ? { sliceToken: state.slice.sliceToken, sliceSecret: state.slice.sliceSecret, requestId: state.pendingMint.requestId }
      : { sliceToken: state.slice.sliceToken, sliceSecret: state.slice.sliceSecret, app };
    let response: { status: number; data: Record<string, unknown> };
    try {
      response = await this.post(path, body);
    } catch (error) {
      if (state.pendingMint && error instanceof AgentPassportError &&
        ["APPROVAL_DENIED", "APPROVAL_EXPIRED"].includes(error.code)) {
        await this.store.write({ ...state, pendingMint: undefined });
      }
      throw error;
    }
    const { status, data } = response;
    if (status === 202 && typeof data.requestId === "string") {
      const approvalUrl = typeof data.approvalUrl === "string" ? data.approvalUrl : state.pendingMint?.approvalUrl;
      if (!approvalUrl) throw new AgentPassportError("Approval response omitted its URL", "INVALID_RESPONSE", true);
      await this.store.write({ ...state, pendingMint: { app, requestId: data.requestId, approvalUrl } });
      return { status: "approval_required", approvalUrl };
    }
    if (status === 200 && typeof data.accessToken === "string") {
      if (state.pendingMint) await this.store.write({ ...state, pendingMint: undefined });
      return { status: "ready", value: {
        accessToken: data.accessToken, tokenType: "Bearer", app,
        expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
        expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : null,
      } };
    }
    throw new AgentPassportError("Invalid credential response", "INVALID_RESPONSE", true);
  }

  async waitForCredential(app: string, options: { signal?: AbortSignal; pollMs?: number } = {}): Promise<Credential> {
    const pollMs = Math.max(1000, options.pollMs ?? 2500);
    for (;;) {
      const result = await this.getCredential(app);
      if (result.status === "ready") return result.value;
      await pause(pollMs, options.signal);
    }
  }
}
