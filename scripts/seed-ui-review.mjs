import { spawnSync } from "node:child_process";
const ownerId = process.argv[2];
if (!/^user_[A-Za-z0-9]+$/.test(ownerId ?? ""))
  throw new Error("Usage: node scripts/seed-ui-review.mjs USER_ID");
console.log("target: dev (bright-dinosaur-692, personal dev)");
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "convex",
    "run",
    "uiReview:seed",
    JSON.stringify({ ownerId }),
    "--deployment",
    "bright-dinosaur-692",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
