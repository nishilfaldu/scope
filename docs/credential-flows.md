# Credential delivery

An owner chooses Connect Slack. The server reads requested permissions from the configured Vercel Connect connector. Slack presents its OAuth consent screen. Scope has no custom permission picker or editor. A temporary connection attempt binds the owner, private browser proof, configured scopes, opaque Connect subject and ten-minute deadline. Slack `auth.test` identifies the user/workspace and returns effective scopes in `x-oauth-scopes`. Completion requires the exact configured permissions, with no missing or extra access.

The provider-independent account record stores identity, label, immutable effective permissions, Connect reference and grant generation. It stores no bearer or refresh token. Only Slack is implemented. Standard user tokens are supported because their revocation resets authorization. Rotated grants are rejected: revoking a rotated access token alone leaves the underlying authorization active. [Slack rotation behavior](https://docs.slack.dev/authentication/using-token-rotation/), [OAuth scope accumulation](https://docs.slack.dev/authentication/installing-with-oauth/#appending-scopes).

## CLI identity and approval

The browser and first-party CLI use WorkOS AuthKit in one environment, with hosted Magic Auth email codes. The browser uses the managed Next.js SDK and `/callback`. The public CLI uses native device authorization and rotating refresh at `api.workos.com/user_management`; no API key, client secret or loopback server exists in the CLI. [AuthKit CLI flow](https://workos.com/docs/authkit/cli-auth).

Verification requires RS256 signature, the exact modern issuer `https://api.workos.com/user_management/<default Web client ID>`, expiry, immutable `user_` subject, signed intended application `client_id` and `session_` session. Public keys come from the default application's `/sso/jwks/<client ID>`. Modern first-party AuthKit tokens have no Scope API resource audience; we enforce the signed application and environment instead. Browser owner APIs require the Web application; CLI service APIs require the CLI application. Ownership uses the verified subject directly, with no local user table, email mapping or external-auth bridge. The issuer/subject/client/session tuple identifies each separate CLI connection. Refresh cannot switch its user or session.

Each invocation freezes an account/generation, authenticated requester, stable key, purpose, command argv, working directory, credential environment variable. It receives the account's full permissions. No caller-supplied request scopes or operation profile exists. Reusing a key with changed context fails. The owner approves or denies in Scope. The deadline stays thirty minutes from request creation.

## Release and execution

The CLI calls `/api/cli/deliver`. Preflight rejects pending, denied, cancelled, expired or unavailable requests. Connect resolves the exact frozen subject/installation/full scopes with `forceRefresh: true`. Slack identity and effective scopes must match the connection. After provider IO, a Convex transaction rechecks time, owner, requester liveness, active account, scopes and generation. Only then does the server release the bearer privately to the same requester.

No provider tokens, encrypted replay or delivery leases enter the database. A private stable receipt proof survives credential-delivery retries and stays out of browser queries. A receipt records arrival, not successful work. Concurrent collection cannot change authority or extend the deadline. A lost credential response can be collected again before execution; an arbitrary command is never retried automatically.

The CLI confirms receipt, records `running` in a private metadata journal, then directly spawns argv. It injects the bearer into one environment variable and excludes broker credentials. The journal blocks repeated execution once a command started, including crashes with an uncertain result. There is no shell unless explicitly requested and no separate execution server.

Known-secret output masking covers literal and common encoded forms across chunks. Output and execution time are bounded. Native coding-host restrictions apply. A bearer-bearing child can deliberately write or transmit its credential; masking is not isolation. Tests use fake secrets to show both masking and file/network disclosure limits.

## Disconnect and reconnect

Blocking an account immediately prevents decisions, requests and release for its generation. The server retains the reference while revocation is pending or failed. It gets the exact user's standard token, checks identity, calls Slack `auth.revoke`, verifies that `auth.test` rejects the token, then removes that exact subject/installation from Connect. Success requires provider evidence, not just an SDK response. [Slack revoke](https://docs.slack.dev/reference/methods/auth.revoke/), [Connect revocation limits](https://vercel.com/docs/connect/concepts/tokens#revocation).

Reconnect requires confirmed prior disconnect and creates a new opaque subject and generation. Old approvals cannot use it. Slack OAuth permissions accumulate on surviving grants, so reducing scopes without revocation is rejected. A connector/user/workspace authorization is unique across owners while active or awaiting revocation. This avoids one connection revoking another live record's upstream authorization. The application/connector itself is never uninstalled across other users.

Stopping a request or CLI connection prevents future release but does not revoke Slack. Account disconnect performs upstream revocation. WorkOS session changes are observed through access-token expiry; a local connection stop is immediate.

## Notifications

Push endpoints use a service allowlist. Action Retrier handles bounded retries and crash recovery. Each send checks current cancellation, expiry, account generation and requester authority. Notification tags make at-least-once delivery replace the same request notification. The owner-only test returns counts, not subscription secrets. Provider acceptance does not prove physical device receipt. Notification clicks open the exact authenticated request.

## Removed architecture

Hosted AuthKit replaced Convex Auth, Resend, the private `store._handler` patch, auth tables, and the WorkOS Connect Standalone bridge. The obsolete Connect helper application's tokens are no longer accepted. Disposable development data was reset rather than migrated. Magic Auth uses WorkOS email delivery and its documented sending/rate limits; no unlimited email claim is made.

Action Retrier replaced the custom notification-job table, leases, completion fencing and watchdog. Workpool's queue/concurrency policy would add machinery this application does not need. Script hashing was removed: approvals retain argv, working directory, environment variable, account and purpose without claiming code attestation.
