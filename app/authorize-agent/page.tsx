import { AgentAuthorization } from "@/components/approvals/agent-authorization";
export default async function AgentAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<{ external_auth_id?: string }>;
}) {
  const params = await searchParams;
  return (
    <AgentAuthorization
      externalAuthId={
        typeof params.external_auth_id === "string" &&
        params.external_auth_id.length <= 300
          ? params.external_auth_id
          : undefined
      }
    />
  );
}
