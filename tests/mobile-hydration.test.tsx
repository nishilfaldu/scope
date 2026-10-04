// @vitest-environment happy-dom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { useIsMobile } from "../hooks/use-mobile";
afterEach(() => vi.unstubAllGlobals());
function Layout() {
  return <div>{useIsMobile() ? "phone" : "desktop"}</div>;
}
test("phone hydration adopts the client viewport and reacts to media changes", async () => {
  let matches = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) =>
        listeners.delete(fn),
    }),
  });
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Layout />);
  document.body.append(container);
  expect(container.textContent).toBe("desktop");
  const recover = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <Layout />, { onRecoverableError: recover });
  });
  expect(container.textContent).toBe("phone");
  expect(recover).not.toHaveBeenCalled();
  await act(() => {
    matches = false;
    listeners.forEach((fn) => fn());
  });
  expect(container.textContent).toBe("desktop");
  await act(() => root!.unmount());
  expect(listeners.size).toBe(0);
  container.remove();
});
