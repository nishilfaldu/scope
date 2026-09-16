import { SliceDetail } from "@/components/slices/slice-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SliceDetail sliceId={id} />;
}
