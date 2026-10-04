export const failureMessages = {
  "reauthorization-required": "Reconnect this account to continue.",
  "retryable-unavailable": "The provider is unavailable. Try again later.",
  "grant-rejected":
    "The account authorization does not match. Reconnect the account.",
  "configuration-invalid":
    "This connection is not configured. Check the setup.",
  "authority-invalid":
    "Access changed or your sign-in expired. Check Access and sign in again if needed.",
  "invalid-input": "Check the request details and try again.",
  "connection-recovery":
    "Disconnect the existing account before removing this unfinished connection.",
};
export function failureMessage(code) {
  return (
    failureMessages[code] ?? "The request could not be completed. Try again."
  );
}
