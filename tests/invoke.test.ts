import { describe, expect, test } from "vitest";
import { lookupAction, runAction } from "../convex/invoke";

describe("demo.echo", () => {
  test("echoes args and passport name", async () => {
    const spec = lookupAction("demo.echo");
    expect(spec).not.toBeNull();
    expect(spec?.app).toBe("demo");
    const result = await runAction(
      spec!,
      { ping: "pong" },
      { passportName: "Echo" },
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { echo: { ping: "pong" }, passport: "Echo" },
      error: null,
    });
  });
});

describe("github invoke actions are gone", () => {
  test.each([
    "github.repos.list",
    "github.repos.get",
    "github.issues.list",
    "github.issues.comment",
    "github.git.createBranch",
    "github.pulls.create",
  ])("%s is not an invoke action", (action) => {
    expect(lookupAction(action)).toBeNull();
  });
});
