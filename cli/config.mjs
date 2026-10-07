import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const configPath =
  process.env.SCOPE_CONFIG ??
  join(homedir(), ".config", "scope", "config.json");

export function validOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && url.hostname === "localhost")
  )
    throw new Error(
      "Use an https origin, or http://localhost for development.",
    );
  return url.origin;
}

export function validToken(value) {
  return typeof value === "string" && /^scope_[a-f0-9]{64}$/.test(value);
}

export async function loadConfig() {
  let info;
  try {
    info = await lstat(configPath);
  } catch {
    throw new Error("Run scope login first.");
  }
  if (
    !info.isFile() ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error(`${configPath} must be a private file owned by you.`);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!validToken(config.token)) throw new Error("Run scope login again.");
  return { origin: validOrigin(config.origin), token: config.token };
}

export async function saveConfig(config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporary, JSON.stringify(config), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, configPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removeConfig() {
  await rm(configPath, { force: true });
}
