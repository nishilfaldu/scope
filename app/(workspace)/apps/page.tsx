import { connection } from "next/server";
import { AppsBoard } from "@/components/apps/apps-board";
import { mcpResource } from "@/lib/gateway";

export default async function AppsPage() {
  await connection();
  return <AppsBoard mcpUrl={mcpResource()} />;
}
