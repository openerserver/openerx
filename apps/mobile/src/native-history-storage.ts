import {
  decryptRemoteObject,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  type RemoteDeviceKeyPair,
} from "@openerx/remote-protocol";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import type { HistoryStorage } from "./history";

/** Large history stays in an encrypted file; only its device-local key goes into SecureStore. */
export function nativeHistoryStorage(accountId: string): HistoryStorage {
  const directory = new Directory(Paths.document, "openerx-history");
  const file = new File(directory, `${accountId}.sealed`);
  const keyName = `openerx.history.${accountId}`;
  const context = `mobile-history:${accountId}`;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  let keys: Promise<RemoteDeviceKeyPair> | null = null;
  const key = (): Promise<RemoteDeviceKeyPair> => {
    keys ??= (async () => {
      const stored = await SecureStore.getItemAsync(keyName, options);
      if (stored) return JSON.parse(stored) as RemoteDeviceKeyPair;
      const generated = generateRemoteDeviceKeyPair(Crypto.getRandomBytes);
      await SecureStore.setItemAsync(keyName, JSON.stringify(generated), options);
      return generated;
    })();
    return keys;
  };
  return {
    async load() {
      if (!file.exists) return null;
      const stored = await SecureStore.getItemAsync(keyName, options);
      if (!stored) {
        file.delete();
        return null;
      }
      try {
        const pair = JSON.parse(stored) as RemoteDeviceKeyPair;
        return decryptRemoteObject(await file.text(), pair.privateKey, pair.publicKey, context);
      } catch {
        // A corrupt cache can be reconstructed from the account feed.
        file.delete();
        await SecureStore.deleteItemAsync(keyName, options);
        keys = null;
        return null;
      }
    },
    async save(state) {
      const pair = await key();
      const sealed = encryptRemotePayload(
        state,
        pair.privateKey,
        pair.publicKey,
        context,
        Crypto.getRandomBytes,
      );
      directory.create({ idempotent: true, intermediates: true });
      const temporary = new File(directory, `${accountId}.${Crypto.randomUUID()}.tmp`);
      try {
        temporary.write(sealed);
        await temporary.move(file, { overwrite: true });
      } finally {
        // move updates the File object's URI; never remove the committed destination.
        if (temporary.uri !== file.uri && temporary.exists) temporary.delete();
      }
    },
    async clear() {
      if (file.exists) file.delete();
      await SecureStore.deleteItemAsync(keyName, options);
      keys = null;
    },
  };
}
