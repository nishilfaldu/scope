# Agent Passport

Agent Passport gives agents short-lived access without giving them a user's real credentials.

The model has two layers:

1. A **passport** belongs to the user. It is the long-lived vault that holds the user's connected services and their real upstream tokens.
2. A **slice** belongs to one agent. It is a scoped, expiring grant issued from one passport.

Connect once, mint many. A user can connect GitHub, Google, or Slack once, then give different agents different slices of that access.

## A note on the name

The repo currently calls the agent credential a passport. The `pp_` token and `ps_` secret are what an agent holds today.

In the model described here, that pair is a **slice**. The user-side passport vault is the layer above it. That layer is new design work, so the current code and API still use names like `passportToken` and `passportSecret`.

The name can change later without changing the security model:

- passport: the user's keyring
- slice: one agent's permission slip

## The two layers

### Passport

A passport is owned by a user and stays inside our system. It holds:

- the user's identity
- connected services
- upstream OAuth access and refresh tokens
- every slice issued from the passport
- grant and audit history

The passport does not have an external key and secret. Nothing outside our backend should authenticate as the passport.

The user reaches it through their signed-in dashboard session. Our backend uses its upstream OAuth tokens to talk to GitHub, Slack, Google, and other services.

A user may eventually have more than one passport for separation, such as work and personal accounts. One passport is enough for v1.

### Slice

A slice is issued to one agent for one grant. It contains:

- a public token and secret, currently the `pp_` and `ps_` pair
- the passport and user it belongs to
- the agent it was issued for
- allowed services and actions
- an expiry
- revocation state

A slice never contains an upstream OAuth token. It only proves that a specific grant exists.

When an agent calls the API, Passport finds the slice and checks that it is valid, not expired, not revoked, and allowed to perform the requested action. The agent gets exactly the power in that grant and nothing else from the user's account.

Every agent gets its own slice. Two agents never share one. That keeps revocation and audit history specific to one agent.

## Connect flow

The user connects a service from the dashboard:

1. The signed-in user clicks Connect for GitHub, Slack, Google, or another service.
2. Passport creates a one-time OAuth state value bound to the signed-in user, their passport, the service, and a short expiry.
3. Passport sends the user to the provider's official OAuth consent screen.
4. The provider returns an authorization code and the same state value.
5. Passport verifies the state before exchanging the code.
6. The upstream access and refresh tokens are encrypted and stored on the user's passport.
7. Future slices can use that connection without making the user connect the service again.

There are two different consent screens:

- The provider screen is official. It grants Passport the upstream connection.
- The Passport screen is ours. It grants one agent a slice of that connection.

GitHub does not need to know which agent is using a slice.

## Issuing a slice

An agent can request access, for example: GitHub read access for seven days.

The request opens our consent screen. The user sees the agent, services, actions, and expiry before approving it. Approval creates the slice and locks in that policy.

The duration comes from three places:

1. The agent may request one.
2. The user approves or changes it on the consent screen.
3. Passport uses a product default when no duration was requested.

The link only points to the request. The grant record holds the policy.

## Expiry and renewal

A slice stops working at its expiry.

The agent cannot extend it. It can only request renewal. Renewal goes back through user approval and starts with the same services, actions, and duration as the previous grant. The user can change any of them before approving.

This gives us two useful paths:

- **same-policy renewal:** approve the existing scope for another period
- **changed renewal:** approve a different scope or duration, which creates a new grant

Per-user defaults can come later, including a setting that always asks before any renewal.

## What an agent can never do

Agents spend power. Users grant power. An agent cannot:

1. renew or extend its own slice
2. add services, actions, or time to its own slice
3. issue slices to other agents
4. view, revoke, or change another agent's slice
5. read an upstream OAuth access or refresh token
6. connect or disconnect a service on the user's passport
7. change grant defaults or expiry policy
8. change the user's sign-in methods or authentication factors
9. approve its own request
10. read passports or slices owned by another user

These limits should come from the data model and API boundaries, not from instructions given to the agent.

## What is built today

The current repo has:

- Google sign-in and a dashboard gated behind authentication
- GitHub, Google, and Slack connection work
- `pp_` and `ps_` agent credentials, currently named passport token and passport secret
- time-boxed credentials and app gates
- `/api/credentials` for exchanging the pair for a provider Bearer token
- `/api/apps` for listing the apps available to the credential
- health checks and explicit unavailable-app errors
- an immutable audit trail for credential lifecycle events

The current implementation still treats the `pp_` and `ps_` pair as a passport. It does not yet have the full user-side passport vault and slice model described above.

## Design work still to do

- add the user-owned passport record
- move upstream OAuth tokens onto that passport
- bind every OAuth state to the signed-in user and passport
- add agent identity and grant records
- mint a separate slice for every agent grant
- add our agent consent screen
- enforce slice scope, expiry, and revocation on every action
- add renewal requests and user approval
- settle the final product names and migrate the current API names

## Current agent API

The API below describes the code as it exists now:

- `GET /api/health` returns `{ ok, oauth }` with no secrets.
- `GET /api/credentials` describes `POST`.
- `POST /api/credentials` with `{ passportToken, passportSecret, app, refresh? }` returns a Bearer token. Without `refresh: true`, a still-valid live token is reused.
- `GET /api/apps` with `passportToken` and `passportSecret` headers lists each app as `on` or `off`.
- Denials are `{ error, code }`. Unknown, off, and unconnected apps share `APP_UNAVAILABLE`.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Convex HTTP routes live on the deployment's `.convex.site` origin.

## Deploy

Set OAuth client IDs and secrets on the Convex deployment. Set `BOARD_ORIGIN` to the board's origin, such as `http://localhost:3000` in development, so OAuth can return there.

`GET /api/health` reports which OAuth providers have both a non-empty client ID and secret. It does not return the values.

If schema deploy fails because `tokenLogs` still has rows, delete those documents in the Convex dashboard, then deploy again. Do not add a wipe mutation.

## Test

```bash
pnpm test
```
