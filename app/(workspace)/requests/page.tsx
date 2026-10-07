import { RequestsBoard } from "@/components/requests/requests-board";

export default async function RequestsPage({
  searchParams,
}: PageProps<"/requests">) {
  const { request } = await searchParams;
  return (
    <RequestsBoard
      focusId={typeof request === "string" ? request : undefined}
    />
  );
}
