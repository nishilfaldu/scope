import { connection } from "next/server";
import { AccountsBoard } from "@/components/accounts/accounts-board";
import { availableProviders } from "@/lib/connect";

export default async function AccountsPage() {
  await connection();
  return <AccountsBoard providers={availableProviders()} />;
}
