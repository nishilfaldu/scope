import { ConnectionsBoard } from "@/components/connections/connections-board";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const returnTo =
    raw && /^\/requests\/(new|token)\/ar_[A-Za-z0-9_-]+$/.test(raw)
      ? raw
      : null;
  return <ConnectionsBoard returnTo={returnTo} />;
}
