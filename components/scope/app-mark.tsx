import styles from "./scope.module.css";
export function AppMark({ app }: { app: string }) {
  return (
    <span
      aria-hidden
      className={`${styles.appMark} ${app === "Slack" ? styles.slack : styles.genericApp}`}
    >
      {app === "Slack" ? (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M8 3v12M16 9v12M3 8h12M9 16h12"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <span>{app.slice(0, 1)}</span>
      )}
    </span>
  );
}
