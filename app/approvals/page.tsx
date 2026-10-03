import { ApprovalsBoard } from "@/components/approvals/approvals-board";
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; view?: string }>;
}) {
  const params = await searchParams;
  return (
    <ApprovalsBoard
      requestId={
        typeof params.request === "string" ? params.request : undefined
      }
    />
  );
}
