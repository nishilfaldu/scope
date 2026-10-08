export function validatePushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid endpoint");
  }
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "fcm.googleapis.com" ||
      url.hostname.endsWith(".push.services.mozilla.com") ||
      url.hostname.endsWith(".push.apple.com")
    ) ||
    url.username ||
    url.password ||
    url.port ||
    endpoint.length > 2048
  )
    throw new Error("Unsupported push service");
}
