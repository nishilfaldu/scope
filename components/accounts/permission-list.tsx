import type { Doc } from "@/convex/_generated/dataModel";
import { formatTime } from "@/lib/format";
import { describeScope, unreportedPermissions } from "@/shared/permissions";

export function PermissionList({
  account,
  heading,
}: {
  account: Doc<"accounts">;
  heading: string;
}) {
  const permissions = account.permissions;
  if (!permissions?.scopes.length)
    return (
      <p className="text-xs text-scope-quiet">
        {unreportedPermissions(account.providerId)}
      </p>
    );
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-scope-quiet">
        {heading}, as of {formatTime(permissions.checkedAt)}:
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {permissions.scopes.map((scope) => (
          <li
            key={scope}
            title={scope}
            className="rounded-md bg-scope-hover px-2 py-0.5 text-xs"
          >
            {describeScope(account.providerId, scope)}
          </li>
        ))}
      </ul>
    </div>
  );
}
