import { redirect } from "next/navigation";

// Keep existing notification links and the registered WorkOS sign-in URI valid.
export default async function LegacyLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const external =
    typeof params.external_auth_id === "string"
      ? params.external_auth_id
      : undefined;
  const account =
    typeof params.account === "string" ? params.account : undefined;
  const request =
    typeof params.request === "string" ? params.request : undefined;
  if (external)
    redirect(
      `/authorize-agent?external_auth_id=${encodeURIComponent(external)}`,
    );
  if (account)
    redirect(`/connections?account=${encodeURIComponent(account)}#airtable`);
  redirect(
    request
      ? `/approvals?request=${encodeURIComponent(request)}`
      : "/approvals",
  );
}
