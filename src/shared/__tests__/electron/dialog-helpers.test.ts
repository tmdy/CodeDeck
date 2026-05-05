import { describe, expect, it, vi } from "vitest";
import { pickDirectoryPath } from "../../electron/dialog-helpers.js";

describe("pickDirectoryPath", () => {
  it("returns undefined when the dialog is cancelled", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    const result = await pickDirectoryPath(showOpenDialog, "选择工作目录");

    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("returns the selected path when the dialog completes", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ["C:/workspace"],
    });

    const result = await pickDirectoryPath(showOpenDialog, "选择工作目录");

    expect(result).toBe("C:/workspace");
  });
});
