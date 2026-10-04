import { AuthorizationShell } from "@/components/shared/authorization-shell";
import styles from "@/components/scope/scope.module.css";
export default function NotFound() {
  return (
    <AuthorizationShell>
      <div className="p-6 sm:p-8">
        <header className={styles.pageHeading}>
          <h1>Page not found</h1>
          <p>The link may be incorrect or no longer available.</p>
        </header>
      </div>
    </AuthorizationShell>
  );
}
