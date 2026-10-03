import styles from "./scope.module.css";
export function AppMark({ app }: { app: string }) {
  return (
    <span
      aria-hidden
      className={`${styles.appMark} ${app === "Slack" ? styles.slack : styles.airtable}`}
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
      ) : app === "Airtable" ? (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 3 10 5-10 5L2 8l10-5ZM2 11l8 4v7l-8-4v-7Zm12 4 8-4v7l-8 4v-7Z" />
        </svg>
      ) : (
        <span>{app.slice(0, 1)}</span>
      )}
    </span>
  );
}
