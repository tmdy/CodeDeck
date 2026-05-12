import { describe, expect, it, vi } from "vitest";
import { moveDirectoryWithFileSystem } from "./filesystem.js";

function createFileSystemError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("moveDirectoryWithFileSystem", () => {
  it("falls back to copy and remove when rename is blocked by Windows permissions", async () => {
    const renameError = createFileSystemError("EPERM", "rename blocked");
    const fileSystem = {
      access: vi.fn().mockRejectedValue(createFileSystemError("ENOENT", "missing")),
      cp: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockRejectedValue(renameError),
      rm: vi.fn().mockResolvedValue(undefined),
    };

    await moveDirectoryWithFileSystem(fileSystem, "C:/source/skill", "C:/target/skill");

    expect(fileSystem.mkdir).toHaveBeenCalledWith("C:/target", { recursive: true });
    expect(fileSystem.rename).toHaveBeenCalledWith("C:/source/skill", "C:/target/skill");
    expect(fileSystem.access).toHaveBeenCalledWith("C:/target/skill");
    expect(fileSystem.cp).toHaveBeenCalledWith("C:/source/skill", "C:/target/skill", {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    expect(fileSystem.rm).toHaveBeenCalledWith("C:/source/skill", { recursive: true, force: false });
  });

  it("does not copy over an existing target after a recoverable rename failure", async () => {
    const fileSystem = {
      access: vi.fn().mockResolvedValue(undefined),
      cp: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockRejectedValue(createFileSystemError("EPERM", "rename blocked")),
      rm: vi.fn().mockResolvedValue(undefined),
    };

    await expect(moveDirectoryWithFileSystem(fileSystem, "C:/source/skill", "C:/target/skill"))
      .rejects.toThrow("目标路径已存在");

    expect(fileSystem.cp).not.toHaveBeenCalled();
    expect(fileSystem.rm).not.toHaveBeenCalled();
  });
});
