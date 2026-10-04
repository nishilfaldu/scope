# Timed access acceptance

Observed on 2026-10-04 against localhost:3000 and personal dev `bright-dinosaur-692`. Production was not changed. These checks used the existing Slack acceptance app and workspace. No Slack messages were sent. No provider credentials were recorded.

## Live checks

- WorkOS device login completed. The CLI listed the browser owner's saved accounts.
- Slack reconnect completed with `channels:read` and implicit `identify` permissions.
- A pending request was approved for 15 minutes. The CLI collected a credential and ran `examples/slack-channels.mjs`, exit 0. It returned three public channel names.
- A second command in the same CLI session reused the same approval. The record showed two collections. Its expiry stayed exactly 15 minutes after approval.
- Reusing the first local invocation ID was rejected before execution.
- End approval moved the row to History. A subsequent delivery call returned `ended` without a token.
- A new command created a new pending request. Denying it stopped the CLI with exit 1. The command did not run.

## UI and local verification

Desktop and phone layouts were checked. History loaded past its first 20 rows. Saved connections displayed collapsed permission counts and expanded the granted permissions for the selected account. The Disconnect confirmation opened and cancelled without changing the connection. A signed-in unknown URL rendered Page not found without workspace context errors.

The repeatable UI seed provides three pending requests, three active approvals and 36 history entries. They include long reasons and collection/receipt examples. Synthetic references cannot release live credentials.

All 70 tests, ESLint, TypeScript and the production build passed. Tests cover session/owner/grant isolation, concurrent reuse, expiry scheduling, provider-IO fences, durable setup recovery, safe errors, pagination, bounded CLI shutdown, notification key replacement and the SDK's exact Connect DELETE call.

Connect revocation is covered by the SDK test in this pass. No new live provider-revocation or physical-device notification-arrival claim is made here. Earlier user-confirmed phone delivery is recorded in [historical acceptance](slack-acceptance.md).
