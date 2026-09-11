import { describe, expect, test } from "vitest";
import { lookupAction, runAction } from "../convex/invoke";

describe("github.issues.comment args", () => {
  test("accepts a JSON number for issue_number", async () => {
    const spec = lookupAction("github.issues.comment");
    expect(spec).not.toBeNull();
    const result = await runAction(
      spec!,
      { owner: "o", repo: "r", issue_number: 12, body: "hi" },
      { passportName: "g", githubToken: null },
    );
    expect(result.status).toBe(503);
    expect(result.error).toBe("GitHub not connected");
  });

  test("still accepts a string issue_number", async () => {
    const spec = lookupAction("github.issues.comment");
    expect(spec).not.toBeNull();
    const result = await runAction(
      spec!,
      { owner: "o", repo: "r", issue_number: "12", body: "hi" },
      { passportName: "g", githubToken: null },
    );
    expect(result.status).toBe(503);
    expect(result.error).toBe("GitHub not connected");
  });
});
