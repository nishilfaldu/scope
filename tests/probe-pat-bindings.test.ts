import { expect, test } from "vitest";
import {
  patBindings,
  patBindingForKey,
  requirePatAccount,
} from "../lib/probe-pat-bindings";
const bindings = [
  { key: "a", label: "Account A", connectorId: "scl_A", baseId: "appBaseA" },
  { key: "b", label: "Account B", connectorId: "scl_B", baseId: "appBaseB" },
];
test("configured PAT metadata contains one or two distinct named connector/base bindings", () => {
  expect(patBindings.length).toBeGreaterThanOrEqual(1);
  expect(patBindings.length).toBeLessThanOrEqual(2);
  for (const field of ["key", "connectorId", "baseId"] as const)
    expect(new Set(patBindings.map((b) => b[field])).size).toBe(
      patBindings.length,
    );
  for (const binding of patBindings) {
    expect(binding.key).toMatch(/^[a-z0-9-]+$/);
    expect(binding.connectorId).toMatch(/^scl_[A-Za-z0-9]+$/);
    expect(binding.baseId).toMatch(/^app[A-Za-z0-9]+$/);
    expect(binding.label.trim()).not.toBe("");
  }
});
test("only named bindings can be selected, with no arbitrary connector or inherited-key lookup", () => {
  expect(patBindingForKey("b", bindings)).toEqual(bindings[1]);
  for (const key of [
    undefined,
    "",
    "__proto__",
    "constructor",
    "scl_B",
    { connectorId: "scl_B" },
  ])
    expect(() => patBindingForKey(key, bindings)).toThrow(
      "Test binding unavailable",
    );
});
test("owner and exact connector/base pairing apply independently to both PAT accounts", () => {
  for (const binding of bindings)
    expect(() =>
      requirePatAccount({ userId: "owner", ...binding }, "owner", bindings),
    ).not.toThrow();
  for (const account of [
    { userId: "other", connectorId: "scl_A", baseId: "appBaseA" },
    { userId: "owner", connectorId: "scl_A", baseId: "appBaseB" },
    { userId: "owner", connectorId: "scl_B", baseId: "appBaseA" },
    { userId: "owner", connectorId: "scl_Unknown", baseId: "appBaseA" },
    { userId: "owner", connectorId: "scl_A" },
  ])
    expect(() => requirePatAccount(account, "owner", bindings)).toThrow(
      "Test account unavailable",
    );
});
