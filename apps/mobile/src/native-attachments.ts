import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { attachmentDraft, type PendingAttachment } from "./attachments";

export async function pickAttachments(
  source: "files" | "photos" | "camera",
): Promise<PendingAttachment[]> {
  if (source === "files") {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return [];
    return result.assets.map((asset) =>
      attachmentDraft({
        id: Crypto.randomUUID(),
        uri: asset.uri,
        displayName: asset.name,
        sizeBytes: asset.size ?? new File(asset.uri).size,
      }),
    );
  }
  if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
    throw new Error("CAMERA_PERMISSION_REQUIRED");
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          selectionLimit: 10,
          quality: 1,
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const file = new File(asset.uri);
    // A compatible picker can transcode HEIC; use the returned file's actual extension.
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    const name = asset.fileName ?? file.name;
    const displayName =
      extension && name.includes(".")
        ? `${name.slice(0, name.lastIndexOf("."))}.${extension}`
        : name;
    return attachmentDraft({
      id: Crypto.randomUUID(),
      uri: asset.uri,
      displayName,
      sizeBytes: asset.fileSize ?? file.size,
    });
  });
}

export async function readAttachment(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await new File(uri).arrayBuffer());
}
export async function attachmentChecksum(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
