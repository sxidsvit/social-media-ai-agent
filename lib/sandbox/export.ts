import "server-only";
import { describeFile, listCampaignSandboxPaths, saveCampaignArtifact } from "@/lib/orchestration/artifacts";
import { listCampaignSandboxes, openAgentSandbox, type SandboxKey } from "@/lib/sandbox/agent-sandbox";
import { storeFile } from "@/lib/storage/files";
import { campaignFolder } from "@/lib/storage/imagekit";

// When a campaign ends, the files the agents left on their computers are uploaded to file storage (as
// campaign artifacts) before the computers are shut down, so nothing is lost with them.

const EXPORT_FOLDERS = ["/campaign/output", "/campaign/assets", "/campaign/research"];
const MAX_FILES = 200;
const MAX_BYTES = 25 * 1024 * 1024;

export type FileToExport = SandboxKey & { path: string };

// Files in every agent's folders that don't have a permanent URL yet
export async function listFilesToExport(campaignId: number): Promise<FileToExport[]> {
  const uploaded = await listCampaignSandboxPaths(campaignId);
  const files: FileToExport[] = [];
  for (const row of await listCampaignSandboxes(campaignId)) {
    const key = { campaignId, agentId: row.agentId };
    const desktop = await openAgentSandbox(key);
    for (const folder of EXPORT_FOLDERS) {
      const entries = await desktop.files.list(folder, { depth: 5 }).catch(() => []);
      for (const entry of entries) {
        if (entry.type === "file" && entry.size <= MAX_BYTES && !uploaded.has(entry.path)) files.push({ ...key, path: entry.path });
      }
    }
  }
  return files.slice(0, MAX_FILES);
}

export async function exportFiles(campaignId: number, userId: string, files: FileToExport[]) {
  let exported = 0;
  for (const file of files) {
    try {
      const desktop = await openAgentSandbox(file);
      const data = await desktop.files.read(file.path, { format: "bytes" });
      const fileName = file.path.split("/").pop() || "file";
      const { type, mimeType } = describeFile(fileName);
      const uploaded = await storeFile(data, { fileName, folder: campaignFolder(campaignId, "exports"), mimeType });
      await saveCampaignArtifact(
        { userId, campaignId },
        {
          type,
          name: fileName,
          url: uploaded.url,
          imagekitFileId: uploaded.fileId,
          sandboxPath: file.path,
          mimeType,
          metadata: { size: uploaded.size, storage: uploaded.provider, storageKey: uploaded.key, exported: true, agentId: file.agentId },
        }
      );
      exported++;
    } catch (error) {
      console.error(`Exporting ${file.path} from campaign ${campaignId} (${file.agentId}) failed`, error);
    }
  }
  return exported;
}
