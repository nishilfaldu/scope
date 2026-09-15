import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";
import { env } from "./_generated/server";
import { ensurePassport } from "./tables/passports";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await ensurePassport(ctx, userId);
    },
  },
});
