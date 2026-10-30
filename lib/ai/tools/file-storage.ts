import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { describeFile, saveTaskArtifact } from "@/lib/orchestration/artifacts";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { checkpointDue, checkSandboxPath, clipText, setStep, useSandbox } from "@/lib/ai/tools/runtime";
import { storeFile } from "@/lib/storage/files";
import { campaignFolder } from "@/lib/storage/imagekit";

// Files on the agent's own computer: /campaign/research, /campaign/assets and /campaign/output.
// "upload" puts a file on ImageKit for a permanent URL and records it as an artifact of the task, so
// teammates (who have their own computers) can use it; "download" copies a file from a URL onto
// this computer.

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const FileStorage = z.object({
  action: z.enum(["read", "write", "list", "delete", "upload", "download"]),
  path: z.string().describe("A path under /campaign, e.g. /campaign/research/trends.md"),
  content: z.string().max(200_000).nullable().describe("write: the text to save"),
  name: z.string().max(120).nullable().describe("upload: a short display name for the file"),
  description: z.string().max(500).nullable().describe("upload: one line on what the file is"),
  url: z.string().nullable().describe("download: the http(s) URL of the file to copy to path"),
});

export const fileStorage = tool({
  name: "file_storage",
  description:
    "Read, write, list and delete files in your computer's folders (/campaign/research, /campaign/assets, /campaign/output), upload one to get a permanent URL teammates can use, or download a file from a URL (e.g. a teammate's upload) to a path. Save research under /campaign/research, media under /campaign/assets and finished deliverables under /campaign/output.",
  parameters: FileStorage,
  needsApproval: checkpointDue,
  execute: async (input, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const path = checkSandboxPath(input.path);
    const desktop = await useSandbox(context);

    switch (input.action) {
      case "read":
        return clipText(await desktop.files.read(path), 20_000);
      case "write": {
        if (input.content === null) return "write needs content.";
        await setStep(context, `Saving ${path.split("/").pop()}`);
        await desktop.files.write(path, input.content);
        return `Saved ${path}.`;
      }
      case "list": {
        const entries = await desktop.files.list(path, { depth: 2 });
        if (entries.length === 0) return `${path} is empty.`;
        return entries.map((entry) => `${entry.path}${entry.type === "dir" ? "/" : ` (${entry.size} bytes)`}`).join("\n");
      }
      case "delete":
        if (path === "/campaign" || /^\/campaign\/(research|assets|output)\/?$/.test(path)) return "The folders themselves can't be deleted.";
        await desktop.files.remove(path);
        return `Deleted ${path}.`;
      case "download": {
        let url: URL;
        try {
          url = new URL(input.url ?? "");
        } catch {
          return "download needs the file's full URL.";
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http and https URLs can be downloaded.";
        await setStep(context, `Downloading ${path.split("/").pop()}`);
        // Fetched inside the sandbox, never from this server, so a URL can't reach our own network
        const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
        try {
          await desktop.commands.run(
            `mkdir -p ${quote(path.slice(0, path.lastIndexOf("/")) || "/campaign")} && curl -fsSL --max-time 60 --max-filesize ${MAX_UPLOAD_BYTES} -o ${quote(path)} ${quote(url.toString())}`,
            { timeoutMs: 75_000 }
          );
        } catch (error) {
          const failed = error as { stderr?: string; message?: string };
          return `The download failed: ${(failed.stderr || failed.message || "unknown error").trim().slice(0, 300)}`;
        }
        const [entry] = await desktop.files.list(path.slice(0, path.lastIndexOf("/")), { depth: 1 }).then((entries) => entries.filter((file) => file.path === path));
        return `Downloaded ${url.toString()} to ${path}${entry ? ` (${entry.size} bytes)` : ""}.`;
      }
      case "upload": {
        await setStep(context, `Uploading ${path.split("/").pop()}`);
        const data = await desktop.files.read(path, { format: "bytes" });
        if (data.byteLength > MAX_UPLOAD_BYTES) return "That file is over 25MB, too big to upload.";
        const fileName = path.split("/").pop() || "file";
        const { type, mimeType } = describeFile(fileName);
        const folder = campaignFolder(context.scope.campaignId, path.startsWith("/campaign/assets") ? "assets" : path.startsWith("/campaign/research") ? "research" : "output");
        const uploaded = await storeFile(data, { fileName, folder, mimeType });
        await saveTaskArtifact(context, {
          type,
          name: input.name?.trim() || fileName,
          url: uploaded.url,
          imagekitFileId: uploaded.fileId,
          sandboxPath: path,
          mimeType,
          metadata: { size: uploaded.size, storage: uploaded.provider, storageKey: uploaded.key, ...(input.description ? { description: input.description } : {}) },
        });
        return `Uploaded ${path}: ${uploaded.url}`;
      }
    }
  },
});
