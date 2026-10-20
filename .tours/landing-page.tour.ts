import { expect, test } from "pro-tour";

test("Try Scope from the landing page", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const preview = page.getByRole("region", { name: "Scope preview" });
  const previewNav = preview.getByRole("navigation", { name: "Preview" });

  await test.step("Approve the waiting request for 15 minutes", async () => {
    await expect(
      page.getByRole("heading", { name: /Connect once/ }),
      "The hero says Connect once",
    ).toBeVisible();
    await expect(
      preview.getByText("1 request needs your decision."),
      "The preview has one request waiting",
    ).toBeVisible();
    await preview.getByRole("button", { name: "15 min" }).click();
    await preview.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(
      preview.getByText("Approved for 15 minutes"),
      "The request is approved for 15 minutes",
    ).toBeVisible();
  });

  await test.step("See the approval in Activity, then end it", async () => {
    await previewNav.getByRole("button", { name: "Activity" }).click();
    await expect(
      preview.getByText("Approved by you and ran", { exact: true }),
      "Activity shows the call was approved and ran",
    ).toBeVisible();
    await previewNav.getByRole("button", { name: "Requests" }).click();
    await preview.getByRole("button", { name: "End approval" }).click();
    await expect(
      preview.getByText("You ended the approval."),
      "The approval has ended",
    ).toBeVisible();
  });

  await test.step("Block merges for Cursor in Apps", async () => {
    await preview.getByRole("button", { name: "Replay this request" }).click();
    await previewNav.getByRole("button", { name: "Apps" }).click();
    await preview
      .getByRole("radiogroup", { name: "Merge a pull request rule" })
      .getByRole("radio", { name: "Block" })
      .click();
    await previewNav.getByRole("button", { name: /^Requests/ }).click();
    await expect(
      preview.getByText(
        "Merge a pull request is blocked, so Scope refused the call.",
      ),
      "Scope refuses the blocked call without asking",
    ).toBeVisible();
  });

  await test.step("Disconnect GitHub and ask again", async () => {
    await previewNav.getByRole("button", { name: "Apps" }).click();
    await preview
      .getByRole("radiogroup", { name: "Merge a pull request rule" })
      .getByRole("radio", { name: "Ask me" })
      .click();
    await previewNav.getByRole("button", { name: "Accounts" }).click();
    await preview.getByRole("button", { name: "Disconnect" }).click();
    await expect(
      preview.getByText("Not connected"),
      "No account is connected now",
    ).toHaveCount(4);
    await previewNav.getByRole("button", { name: /^Requests/ }).click();
    await expect(
      preview.getByRole("button", { name: "Connect a GitHub account" }),
      "The request asks you to connect GitHub first",
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Connect a GitHub account" })
      .click();
    await expect(
      preview.getByRole("button", { name: "Approve", exact: true }),
      "Approve is back after connecting GitHub",
    ).toBeVisible();
  });

  await test.step("Approve from the browser notification", async () => {
    await preview
      .getByRole("button", { name: "Also sent to your phone and browser" })
      .click();
    await expect(
      preview.getByRole("heading", { name: "In your browser" }),
      "The notification preview is open",
    ).toBeVisible();
    await preview.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(
      preview.getByText("Active approvals"),
      "The request moves to Active approvals",
    ).toBeVisible();
  });

  await test.step("Jump to How it works and copy the server URL", async () => {
    await page.getByRole("button", { name: "See how it works" }).click();
    await expect(
      page.getByRole("heading", { name: "How it works" }),
      "The page scrolled to How it works",
    ).toBeInViewport();
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(
      page.getByRole("button", { name: "Copied" }),
      "The button says Copied",
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        message: "The clipboard holds the MCP server URL",
      })
      .toMatch(/\/mcp$/);
  });

  await test.step("Scroll to the accounts and the sign-in button", async () => {
    await page
      .getByRole("heading", { name: "The accounts you already use." })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("heading", { name: "The accounts you already use." }),
      "The supported accounts are listed",
    ).toBeInViewport();
    const signIn = page
      .getByRole("main")
      .getByRole("button", { name: "Sign in to Scope" })
      .last();
    await signIn.scrollIntoViewIfNeeded();
    await signIn.hover();
    await expect(
      signIn,
      "Sign in sends you to Requests after sign-in",
    ).toHaveAttribute("href", "/signin?redirectTo=/requests");
  });
});
