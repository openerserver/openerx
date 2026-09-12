import {
  maxPastedAttachmentBytes,
  maxPastedAttachmentCount,
  type PastedFileInput,
  supportedFileExtensions,
} from "@openerx/contracts";

const extensions = new Set(supportedFileExtensions);
const imageExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

export async function serializePastedFiles(files: readonly File[]): Promise<PastedFileInput[]> {
  if (
    files.length > maxPastedAttachmentCount ||
    files.reduce((total, file) => total + file.size, 0) > maxPastedAttachmentBytes
  ) {
    throw new Error("FILE_TOO_LARGE");
  }
  const names = files.map((file, index) => {
    const imageExtension = imageExtensions[file.type];
    const name =
      file.name ||
      (imageExtension ? `剪贴板图片-${Date.now()}-${index + 1}.${imageExtension}` : "");
    if (!extensions.has(name.split(".").at(-1)?.toLowerCase() ?? "")) {
      throw new Error("FILE_UNSUPPORTED");
    }
    return name;
  });
  return await Promise.all(
    files.map(async (file, index) => ({
      displayName: names[index] ?? file.name,
      bytesBase64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string" || !reader.result.includes(",")) {
            reject(new Error("CLIPBOARD_FILE_READ_FAILED"));
            return;
          }
          resolve(reader.result.slice(reader.result.indexOf(",") + 1));
        };
        reader.onerror = () => reject(new Error("CLIPBOARD_FILE_READ_FAILED"));
        reader.onabort = () => reject(new Error("CLIPBOARD_FILE_READ_FAILED"));
        reader.readAsDataURL(file);
      }),
    })),
  );
}

export function pastedAttachmentError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("FILE_TOO_LARGE"))
    return "每次粘贴的附件总大小不能超过 50 MB，最多 100 个文件。";
  if (message.includes("FILE_UNSUPPORTED"))
    return "粘贴的文件类型暂不支持，请选择文档、表格、图片、文本或代码文件。";
  return "无法添加剪贴板附件，请重新复制后粘贴。";
}
