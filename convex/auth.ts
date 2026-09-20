import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import { convexAuth } from "@convex-dev/auth/server";
import { Resend } from "@convex-dev/resend";
import { components } from "./_generated/api";
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
        return String(bytes[0] % 1_000_000).padStart(6, "0");
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
          text: `Your Scope code is ${token}. It expires in 10 minutes. If you did not request it, ignore this email.`,
        });
      }) as unknown as EmailConfig["sendVerificationRequest"],
    }),
  ],
  signIn: { maxFailedAttempsPerHour: 5 },
});
