import { ApprovalsInbox } from "@/components/approvals/approvals-inbox";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  return <ApprovalsInbox requestToken={request} />;
}
