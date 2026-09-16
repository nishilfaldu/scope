import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "expire slices",
  { minutes: 1 },
  internal.tables.slices.mutations.expireDue,
  {},
);

crons.interval(
  "expire access requests",
  { minutes: 1 },
  internal.tables.slices.accessRequests.expireDue,
  {},
);

export default crons;
