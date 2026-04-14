import type { Ref } from "vue";

export function useTaskFilePreviewPanel(args: {
  previewFile: Ref<{ filePath: string; content?: string } | null>;
  handleCloseFilePreview: () => void;
}) {
  return {
    handleCloseFilePreview: args.handleCloseFilePreview,
    previewFile: args.previewFile,
  };
}