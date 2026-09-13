import { PassportDetail } from "@/components/passports/passport-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PassportDetail passportId={id} />;
}
