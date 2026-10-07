// Ordinary read-only Slack script. Scope does not register provider actions.
const response = await fetch(
  "https://slack.com/api/conversations.list?types=public_channel&limit=100",
  {
    headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  },
);

const body = await response.json();

if (!response.ok || body.ok !== true)
  throw new Error("Slack channel read failed");
console.log(
  JSON.stringify(
    body.channels.map(({ id, name }) => ({ id, name })),
    null,
    2,
  ),
);
