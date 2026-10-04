import { expect, test, vi } from "vitest";
const authkitProxy = vi.hoisted(() => vi.fn());
vi.mock("@workos-inc/authkit-nextjs", () => ({ authkitProxy }));
test("AuthKit protects browser workspace and provider completion, while CLI authenticates its own bearer", async () => {
  await import("../proxy");
  expect(authkitProxy).toHaveBeenCalledWith({
    middlewareAuth: {
      enabled: true,
      unauthenticatedPaths: [
        "/",
        "/privacy",
        "/terms",
        "/signin",
        "/callback",
        "/api/cli/:path*",
      ],
    },
  });
  expect(
    authkitProxy.mock.calls[0][0].middlewareAuth.unauthenticatedPaths,
  ).not.toContain("/api/accounts/complete");
});
