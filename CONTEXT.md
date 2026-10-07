# Scope

Scope lets a person give an AI agent a provider token for a limited time.

## Language

**Person**:
The owner, signed in to the web app with WorkOS AuthKit. Their WorkOS user ID is also their Vercel Connect subject.

**Agent**:
A record the person creates. It has a name and a secret token that the CLI saves. Scope stores only the token's hash. Two agents never share approvals.

**Account**:
A connected provider grant. Vercel Connect holds its credentials. A person has at most one account per provider. Connecting again replaces it.

**Request**:
An agent's ask for a token from one provider, with a reason. It waits up to 30 minutes. The reason is display text and does not restrict the token.

**Approval**:
The person's yes to a request. The person picks the account and a 15-, 30- or 60-minute window. The window starts at approval. During the window the same agent can collect tokens for that provider without another prompt.

**Token collection**:
One release of a provider token to the agent. Scope counts collections and records the last time. Collection does not extend the window.

**End approval**:
Stops further collection. Tokens that were already released stay valid.

**Disconnect**:
Revokes the grant in Vercel Connect, then deletes the account and ends its approvals.
