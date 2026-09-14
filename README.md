# Agent Passport

Create short-lived GitHub, Google, and Slack tokens for agents. The board issues a passport and an invoke key. The agent posts those to `/api/credentials` and then calls the provider itself.

This board is a single-operator console. It has no login.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Convex HTTP routes live on your deployment's `.convex.site` origin.

## Agent API

- `GET /api/health` returns `{ ok, oauth }` with no secrets.
- `GET /api/credentials` describes `POST`.
- `POST /api/credentials` with `{ passportId, invokeKey, app, refresh? }` returns a Bearer token. Without `refresh: true`, a still-valid live token is reused.
- `GET /api/apps` with `passportId` and `invokeKey` headers lists each app as `on` or `off`.
- Denials are `{ error, code }`. Unknown, off, and unconnected apps share `APP_UNAVAILABLE`.

## Deploy

Set OAuth client ids and secrets on the Convex deployment. Set `BOARD_ORIGIN` to the board's origin (for example `https://your-app.vercel.app`) so OAuth can return there. Localhost stays allowed.

`GET /api/health` reports which OAuth providers have both a client id and a secret. It does not return the values.

If schema deploy fails because `tokenLogs` still has rows, delete those documents in the Convex dashboard, then deploy again. Do not add a wipe mutation.

## Test

```bash
pnpm test
```
