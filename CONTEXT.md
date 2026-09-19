# Scope

Scope lets a person grant bounded access to connected provider accounts to an agent.

## Language

**Agent lineage**:
The stable, user-approved identity of one agent across credential rotations and reconnects. Slices and slice requests belong to this lineage.
_Avoid_: Agent connection, credential generation

**Connection generation**:
One replaceable ID and secret pair that authenticates an agent lineage. Rotating or reconnecting swaps the active generation without moving the lineage's grants.
_Avoid_: Agent identity

**Slice**:
A time-bounded grant from a user to an agent lineage for selected provider accounts.
_Avoid_: Connection, credential

**Slice request**:
An agent lineage's request for a new slice, pending a user's decision.
_Avoid_: Approval inbox item
