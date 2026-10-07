export const failureMessages = {
  "authority-invalid":
    "Access changed or your sign-in expired. Check Scope and sign in again if needed.",
  "invalid-input": "Check the request details and try again.",
  "no-account": "Connect an account for this provider in Scope first.",
  "reconnect-required": "Reconnect this account in Scope to continue.",
  "provider-unavailable": "The provider is unavailable. Try again later.",
  "configuration-invalid": "This provider is not configured. Check the setup.",
  "connection-failed": "The connection did not finish. Try again.",
};

export function failureMessage(code) {
  return (
    failureMessages[code] ?? "The request could not be completed. Try again."
  );
}
