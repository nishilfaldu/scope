import { ConnectAgent } from "@/components/agents/connect-agent";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ConnectAgent publicToken={token} />;
}
