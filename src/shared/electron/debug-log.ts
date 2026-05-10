import { promises as fs } from "node:fs";
import path from "node:path";

export interface DebugLogFileSystem {
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  appendFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
}

export interface DebugLogWriterOptions {
  getDirectory: () => string;
  fileName?: string;
  fileSystem?: DebugLogFileSystem;
  now?: () => Date;
}

export interface DebugLogWriter {
  write: (message: string) => void;
  flush: () => Promise<void>;
}

export function createDebugLogWriter({
  getDirectory,
  fileName = "unlock-debug.log",
  fileSystem = fs,
  now = () => new Date(),
}: DebugLogWriterOptions): DebugLogWriter {
  let writeChain = Promise.resolve();

  return {
    write(message: string): void {
      let dir: string;
      let file: string;
      let line: string;

      try {
        dir = getDirectory();
        file = path.join(dir, fileName);
        line = `[${now().toISOString()}] ${message}\n`;
      } catch {
        return;
      }

      writeChain = writeChain
        .then(async () => {
          await fileSystem.mkdir(dir, { recursive: true });
          await fileSystem.appendFile(file, line, "utf-8");
        })
        .catch(() => {
          // Debug logging must never affect app behavior, and the chain must remain usable.
        });
    },
    async flush(): Promise<void> {
      await writeChain;
    },
  };
}
