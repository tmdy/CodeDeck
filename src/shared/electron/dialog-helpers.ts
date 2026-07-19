interface PickDirectoryResult {
  canceled: boolean;
  filePaths: string[];
}

type ShowOpenDialog = (options: {
  title: string;
  properties: Array<"openDirectory" | "createDirectory">;
}) => Promise<PickDirectoryResult>;

export async function pickDirectoryPath(
  showOpenDialog: ShowOpenDialog,
  title: string,
): Promise<string | undefined> {
  const result = await showOpenDialog({
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
}
