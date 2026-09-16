import { ApprovalDetail } from "@/components/approvals/approval-detail";

export default async function ApprovalDeepLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ApprovalDetail publicToken={token} />;
}
