// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { useIsMobile } from "../hooks/use-mobile";
afterEach(() => vi.unstubAllGlobals());
function Layout() {
  return <div>{useIsMobile() ? "phone" : "desktop"}</div>;
}
test("hydration starts from the same server snapshot even at a phone viewport", () => {
  const server = renderToStaticMarkup(<Layout />);
  vi.stubGlobal("window", {
    innerWidth: 390,
    matchMedia: () => ({ matches: true }),
  });
  expect(renderToStaticMarkup(<Layout />)).toBe(server);
});
