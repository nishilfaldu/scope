import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { authenticatedAction } from "../../functions";
import {
  appValidator,
  providerForApp,
  isGoogleApp,
  googleScopesAreBounded,
} from "../../domain/apps";
import { exchangeAuthorizationCode } from "../../oauth";

export const complete = authenticatedAction({
  args: {
    app: appValidator,
    state: v.string(),
    code: v.string(),
    browserProof: v.string(),
  },
  returns: v.object({
    returnTo: v.string(),
    connected: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ returnTo: string; connected: boolean; reason?: string }> => {
    const origin: {
      userId: typeof ctx.userId;
      app: typeof args.app;
      returnTo: string;
      pkceVerifier?: string;
    } | null = await ctx.runMutation(
      internal.tables.oauthStates.mutations.consume,
      {
        state: args.state,
        userId: ctx.userId,
        browserProof: args.browserProof,
      },
    );
    if (!origin || origin.app !== args.app)
      throw new Error("OAuth browser proof or session mismatch");
    const provider = providerForApp(args.app);
    let grant;
    try {
      grant = await exchangeAuthorizationCode(
        provider,
        args.code,
        args.state,
        args.app,
        origin.pkceVerifier,
      );
    } catch {
      return {
        returnTo: origin.returnTo,
        connected: false,
        reason: "identity",
      };
    }
    if ("error" in grant || !grant.providerUserId.trim()) {
      return {
        returnTo: origin.returnTo,
        connected: false,
        reason: "error" in grant ? grant.error : "identity",
      };
    }
    if (
      isGoogleApp(args.app) &&
      !googleScopesAreBounded(args.app, grant.grantedScopes)
    ) {
      return { returnTo: origin.returnTo, connected: false, reason: "scope" };
    }
    await ctx.runMutation(
      internal.tables.connections.mutations.saveConnection,
      {
        userId: ctx.userId,
        provider,
        app: args.app,
        accessToken: grant.accessToken,
        login: grant.login,
        providerUserId: grant.providerUserId,
        refreshToken: grant.refreshToken,
        tokenExpiresAt: grant.tokenExpiresAt,
        grantedScopes: grant.grantedScopes,
      },
    );
    return { returnTo: origin.returnTo, connected: true };
  },
});
