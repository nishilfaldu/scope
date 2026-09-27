import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import { convexAuth } from "@convex-dev/auth/server";
import { Resend } from "@convex-dev/resend";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { type ActionCtx, type MutationCtx, env } from "./_generated/server";
import { v } from "convex/values";

const resend = new Resend(components.resend, { testMode: false });

const authFunctions = convexAuth({
  providers: [
    Email({
      id: "email-otp",
      maxAge: 10 * 60,
      generateVerificationToken: async () => {
        const bytes = new Uint32Array(1);
        const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
        do {
          crypto.getRandomValues(bytes);
        } while (bytes[0] >= limit);
        return (bytes[0] % 1_000_000).toString().padStart(6, "0");
      },
      normalizeIdentifier: (email) => email.trim().toLowerCase(),
      sendVerificationRequest: (async (
        { identifier, token }: { identifier: string; token: string },
        ctx: ActionCtx,
      ) => {
        await resend.sendEmail(ctx, {
          from: env.RESEND_FROM ?? "Scope <login@nishilfaldu.site>",
          to: identifier,
          subject: "Your Scope sign-in code",
          text: `Your Scope code is:\n\n${token}\n\nIt expires in 10 minutes. If you did not request it, ignore this email.`,
        });
      }) as unknown as EmailConfig["sendVerificationRequest"],
    }),
  ],
  signIn: { maxFailedAttempsPerHour: 5 },
});

export const { auth, signIn, signOut, isAuthenticated } = authFunctions;
const libraryStore = authFunctions.store as unknown as {
  _handler: (ctx: MutationCtx, args: { args: unknown }) => Promise<unknown>;
};

export const store = internalMutation({
  args: { args: v.any() },
  handler: async (ctx, args) => {
    const request = args.args;
    if (
      request.type === "verifyCodeAndSignIn" &&
      request.provider === "email-otp" &&
      typeof request.params?.email === "string" &&
      typeof request.params?.code === "string"
    ) {
      const email = request.params.email.trim().toLowerCase();
      const account = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "email-otp").eq("providerAccountId", email),
        )
        .unique();
      if (!account) return null;
      if (account) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(request.params.code),
        );
        const codeHash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const collisions = await ctx.db
          .query("authVerificationCodes")
          .withIndex("code", (q) => q.eq("code", codeHash))
          .collect();
        const otherAccounts = collisions.filter(
          (row) => row.accountId !== account._id,
        );
        for (const row of otherAccounts) {
          await ctx.db.patch("authVerificationCodes", row._id, {
            code: `${codeHash}:${row._id}`,
          });
        }
        try {
          return await libraryStore._handler(ctx, args);
        } finally {
          for (const row of otherAccounts) {
            await ctx.db.patch("authVerificationCodes", row._id, {
              code: codeHash,
            });
          }
        }
      }
    }
    return await libraryStore._handler(ctx, args);
  },
});
