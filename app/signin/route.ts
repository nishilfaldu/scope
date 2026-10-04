import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("redirectTo");
  const returnTo =
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
      ? value
      : "/access";
  return NextResponse.redirect(await getSignInUrl({ returnTo }));
}
