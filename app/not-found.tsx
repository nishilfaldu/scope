import { BoardShell } from "@/components/layout/board-shell";
import styles from "@/components/scope/scope.module.css";

export default function NotFound() {
  return (
    <BoardShell title="Page not found">
      <header className={styles.pageHeading}>
        <h1>Page not found</h1>
        <p>The link may be incorrect or no longer available.</p>
      </header>
    </BoardShell>
  );
}
