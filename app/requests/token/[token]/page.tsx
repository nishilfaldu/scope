import { RequestDecision } from "@/components/requests/request-decision";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <RequestDecision kind="token" publicToken={token} />;
}
