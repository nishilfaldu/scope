# UI review data

These fixtures live only on personal dev `bright-dinosaur-692`, which both localhost and Scope preview use. They contain synthetic identities and fake provider references. The seed does not authorize apps, revoke live grants, send notifications or run commands. Names start with **Demo ·** so they are easy to distinguish from real records.

## What to review

| Page        | States available                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests    | Three pending decisions; short and long reasons; long command wrapping; Approve/Deny; minutes remaining                                            |
| Requests    | Approved and waiting for pickup; delivery started and waiting for receipt; receipt confirmed                                                       |
| Requests    | Denied; expired without a decision; approved but not collected; receipt unconfirmed; received before the window ended                              |
| Requests    | Sharing stopped before/after receipt; account/agent interruptions with recorded timestamps; pending requests whose account or agent is unavailable |
| Requests    | Twenty-nine demo rows, including older history, to expose pagination                                                                               |
| Connections | Two active demo accounts, a long account label, compact Permissions disclosures and Disconnect; completed disconnections are hidden                |
| Agents      | Three active demo agents, a long name and a stopped agent; rename and stop-sharing dialogs                                                         |

Commands remain visible on every request. Decision and delivery outcomes remain visible separately. Use Activity to expand request events; account and agent lifecycle events and sharing actions are omitted. Approve, Deny, rename and stop-sharing operations work on the synthetic records. These are UI fixtures; the fake accounts cannot supply Slack credentials. The existing real account and requests remain separate.

Pending requests follow the normal 30-minute window. Rerun the seed to restore the starting states and refresh their deadlines. Data cannot reproduce loading, sign-in errors or browser notification support; those depend on network and device conditions.

## Refresh

With the existing Convex development login and the current owner's WorkOS user ID:

```sh
node scripts/seed-ui-review.mjs USER_ID
```

The script targets `bright-dinosaur-692` explicitly. The internal preparation mutation rejects every other deployment. It preserves existing records, resets only requests with the `scope-ui-review-v1:` key prefix, and reuses demo account and agent IDs. It appends imported request rows with their original creation times so request activity and pagination are chronological. It verifies the fixture counts after import.

Local validation includes fixture isolation, rerun behavior, target restrictions, normal owner queries/decisions, activity order and coverage of all ten request statuses.
