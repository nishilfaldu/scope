import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentPassportState, AgentPassportStore } from "./index.js";

/** One file per agent task. Keep it outside the repository and never put it in chat. */
export class FileAgentPassportStore implements AgentPassportStore {
  constructor(private readonly path: string) {}

  async read(): Promise<AgentPassportState> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as AgentPassportState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async write(state: AgentPassportState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }
}
