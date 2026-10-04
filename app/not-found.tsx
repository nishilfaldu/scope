import { withAuth } from "@workos-inc/authkit-nextjs";
import { BoardShell } from "@/components/layout/board-shell";
import { AuthorizationShell } from "@/components/shared/authorization-shell";
import styles from "@/components/scope/scope.module.css";

export default async function NotFound() {
  const content = (
    <header className={styles.pageHeading}>
      <h1>Page not found</h1>
      <p>The link may be incorrect or no longer available.</p>
    </header>
  );
  if (!(await withAuth()).user) {
    return (
      <AuthorizationShell>
        <div className="p-6 sm:p-8">{content}</div>
      </AuthorizationShell>
    );
  }
  return <BoardShell title="Page not found">{content}</BoardShell>;
}
