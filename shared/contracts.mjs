/** @typedef {{argv: string[], cwd: string, envVar: string}} CommandContext */
/** @param {unknown} value @returns {value is CommandContext} */
export function validCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = /** @type {Record<string, unknown>} */ (value);
  return (
    Object.keys(command).length === 3 &&
    Object.keys(command).every((key) =>
      ["argv", "cwd", "envVar"].includes(key),
    ) &&
    Array.isArray(command.argv) &&
    command.argv.length >= 1 &&
    command.argv.length <= 128 &&
    typeof command.argv[0] === "string" &&
    command.argv[0].length > 0 &&
    command.argv.every(
      (arg) =>
        typeof arg === "string" && arg.length <= 4096 && !arg.includes("\0"),
    ) &&
    typeof command.cwd === "string" &&
    command.cwd.length >= 1 &&
    command.cwd.length <= 2048 &&
    !command.cwd.includes("\0") &&
    typeof command.envVar === "string" &&
    /^[A-Z_][A-Z0-9_]{0,63}$/.test(command.envVar) &&
    new TextEncoder().encode(JSON.stringify(command)).length <= 16384
  );
}
/** @param {unknown} scopes @returns {string[]} */
export function canonicalScopes(scopes) {
  if (
    !Array.isArray(scopes) ||
    !scopes.length ||
    scopes.length > 128 ||
    scopes.some(
      (scope) =>
        typeof scope !== "string" ||
        !scope.length ||
        scope.length > 128 ||
        scope.trim() !== scope,
    )
  )
    throw new Error("Invalid scopes");
  return [...new Set(scopes)].sort();
}
