# Scope

Scope lets a person approve access requests from authorized MCP connections to connected provider accounts.

## Language

**MCP connection**:
An agent's authorization to request access on behalf of a Scope owner. A chosen name identifies the saved connection, without proving which chat is using it.
_Avoid_: Agent lineage, direct agent connection

**Connected account**:
A provider identity verified after successful sign-in, or a verified read-only account binding available to its owner.
_Avoid_: Manually labeled account

**Access request**:
An MCP connection's immutable request to use one connected account, awaiting the owner's decision.
_Avoid_: Slice, slice request

**Sharing window**:
The period in which an approved request can receive access from Scope. Ending it does not establish that access already received has expired at the provider.
_Avoid_: Provider token lifetime

**Receipt**:
The helper's confirmation that it received the approved access. It does not establish that the agent completed its work.
_Avoid_: Task completion

**Stop sharing**:
The owner's withdrawal of future access delivery through Scope. Previously received access may remain active at the provider.
_Avoid_: Provider revocation
