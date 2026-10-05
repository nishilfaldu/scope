export class ProviderFailure extends Error {
  constructor(
    public readonly kind:
      | "reauthorization-required"
      | "configuration-invalid"
      | "retryable-unavailable"
      | "grant-rejected",
    public readonly authorizationAbsent = false,
  ) {
    super(kind);
  }
}
