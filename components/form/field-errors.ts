export function fieldIsInvalid(field: {
  state: { meta: { errors: unknown[] } };
}) {
  return field.state.meta.errors.length > 0;
}

export function fieldErrorItems(errors: unknown[]) {
  return errors.flatMap((error) => {
    if (error == null) return [];
    if (typeof error === "string") return [{ message: error }];
    if (
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return [{ message: error.message }];
    }
    return [{ message: String(error) }];
  });
}
