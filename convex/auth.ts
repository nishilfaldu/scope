import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import { convexAuth } from "@convex-dev/auth/server";
import { Resend } from "@convex-dev/resend";
import { components, internal } from "./_generated/api";
import { type ActionCtx, env } from "./_generated/server";

const resend = new Resend(components.resend, { testMode: false });

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      id: "email-otp",
      maxAge: 10 * 60,
      generateVerificationToken: async () => {
        const bytes = new Uint32Array(1);
        crypto.getRandomValues(bytes);
        return String(bytes[0] % 100_000_000).padStart(8, "0");
      },
      normalizeIdentifier: (email) => email.trim().toLowerCase(),
      sendVerificationRequest: (async (
        { identifier, token }: { identifier: string; token: string },
        ctx: ActionCtx,
      ) => {
        await resend.sendEmail(ctx, {
          from: env.RESEND_FROM ?? "Agent Passport <login@nishilfaldu.site>",
          to: identifier,
          subject: "Your Agent Passport sign-in code",
          text: `Your Agent Passport code is ${token}. It expires in 10 minutes. If you did not request it, ignore this email.`,
        });
      }) as unknown as EmailConfig["sendVerificationRequest"],
    }),
  ],
  signIn: { maxFailedAttempsPerHour: 5 },
  callbacks: {
    afterUserCreatedOrUpdated: async (ctx, args) => {
      if (args.type !== "email" || !args.profile.email) return;
      // This runs before Convex Auth replaces the active code for the address.
      const allowed = await ctx.runMutation(internal.otp.allowSend, {
        email: args.profile.email,
      });
      if (!allowed)
        throw new Error("Please wait before requesting another code");
    },
  },
});
