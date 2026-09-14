import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "expire passports",
  { minutes: 1 },
  internal.tables.passports.mutations.expireDue,
  {},
);

export default crons;
