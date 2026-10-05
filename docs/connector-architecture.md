# Connector architecture

Scope owns approval authority. Vercel Connect owns provider authorization and credentials. Slack is the only enabled service.

## Shared operations

`lib/connector-catalog.ts` is the server-owned allowlist. A browser selects a product key. The server resolves its connector from configuration and checks the service and authorization parameters. A client cannot supply a connector, subject, issuer, installation or scope list.

`lib/connect.ts` handles consent, token retrieval and revocation for saved references. Each account retains the connector, unique subject, issuer, optional installation and explicit authorization parameters. Empty scope lists remain explicit: omitting them would make the SDK send `['*']`. Configuration changes do not rewrite saved references; reconnect to change authorization.

Token collection checks owner, signed CLI session, approval window and account version before Connect IO. After IO, an atomic mutation checks authority and the exact reference again. This prevents release if approval ends, the account disconnects or the reference changes during retrieval. `forceRefresh: true` bypasses the SDK cache. It does not guarantee a newly minted token.

Scope does not independently inspect each delivered token's identity or effective permissions. It relies on Connect for the saved authorization. Delivery returns no claim of verified permissions.

## Setup information

Slack setup uses `lib/connectors/slack-setup.ts` to identify the user and workspace, reject bot grants, check available Connect identity fields, and record available permissions. This runs during setup or unfinished-setup recovery. It does not run during delivery or disconnect.

Connect has no uniform granted-scopes field. Other services can use its identity and display metadata if that identity supports safe duplicate detection and cleanup. Missing identity prevents activation. Unknown permissions remain unknown; requested permissions are never stored as evidence of an actual grant. Connections shows recorded permissions only when expanded.

Duplicate-grant protection and the durable provisional-account flow remain shared. An unfinished duplicate cannot revoke a saved live account's grant. Disconnect blocks collection first, then revokes the saved Connect target. It does not require token retrieval or permission inspection. Completion is monotonic and retries retain the same target.

## Add a service

Add a catalog entry and configure its connector in Connect. Confirm the provider's identity metadata and installation behavior. Add a setup helper only if its metadata is insufficient. Supply an icon and test consent, identity, duplicate cleanup, retrieval and revocation. The approval engine and CLI do not need provider branches. A full adapter framework is unnecessary until actual provider differences require it.

## Development upgrade and verification

On October 5, 2026, personal dev `bright-dinosaur-692` was upgraded with a bounded internal mutation. It normalized eight accounts to the parameters sent by the previous transport and removed permission fields from 44 approval snapshots. No provider grants were changed. The temporary upgrade function was then removed and the final schema compiled successfully.

Automated coverage includes the installed SDK's explicit scope behavior, the catalog allowlist, forged browser targets, exact-reference races, setup identity checks, unknown permission handling, duplicate cleanup, and saved-account management during metadata outages. This does not establish live consent for an additional provider.
