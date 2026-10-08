import { AuthorizationShell } from "@/components/shared/authorization-shell";
import { PageHeading } from "@/components/shared/page-parts";

export default function NotFound() {
  return (
    <AuthorizationShell>
      <div className="p-6 sm:p-8">
        <PageHeading title="Page not found">
          The link may be incorrect or no longer available.
        </PageHeading>
      </div>
    </AuthorizationShell>
  );
}
