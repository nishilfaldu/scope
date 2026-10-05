# Scope

Scope lets a person allow a verified CLI session to collect tokens for a connected provider account for a limited time.

## Language

**CLI session**:
An existing WorkOS login, bound to its verified owner, issuer, client and session claims. Agent names are display labels. Two chats using the same login share its active approval.

**Connected account**:
A saved provider identity and grant. Vercel Connect holds its credentials. Scope selects connectors through a server-owned catalog and retains the exact authorization parameters. Permission information is recorded at setup, when available; Scope does not independently inspect each delivered token. A provisional account retains setup references until activation or confirmed cleanup.

**Access request**:
A CLI session's request to collect tokens for one account and grant. It waits up to 30 minutes for the owner's decision. A reason describes the intended use, but does not restrict the token.

**Approval window**:
The 15-, 30- or 60-minute period that starts when the owner approves. The same session may collect tokens without another prompt. Collection does not extend it. It does not set the provider token lifetime.

**Receipt**:
The CLI's confirmation that a credential arrived. It does not prove successful work, extend the window or end approval.

**End approval**:
The owner's withdrawal of future token collection under that approval. It does not revoke existing tokens or stop running programs. A later attempt can request a new approval.

**Disconnect**:
Block collection for the account immediately, then ask Vercel Connect to revoke its exact subject and installation. Provider revocation depends on support. Confirmed completion hides the account, while approval history remains.

**Invocation**:
A local command execution recorded by the CLI. Multiple invocations may use one approval. A command that started cannot automatically rerun under the same invocation ID.
