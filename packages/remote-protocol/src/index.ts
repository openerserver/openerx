import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  type RemoteCommand,
  type RemoteCommandPayload,
  remoteCommandPayloadSchema,
  remoteCommandSchema,
} from "@openerx/contracts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type SecureRandom = (length: number) => Uint8Array;

interface PublicKeyBundle {
  version: 1;
  agreement: string;
  signing: string;
}

interface PrivateKeyBundle extends PublicKeyBundle {
  agreementSecret: string;
  signingSecret: string;
}

interface CipherEnvelope {
  version: 1;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export interface RemoteDeviceKeyPair {
  publicKey: string;
  privateKey: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value: unknown): string {
  return base64Url(textEncoder.encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(textDecoder.decode(fromBase64Url(value))) as T;
}

function defaultRandom(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function parsePublicKey(value: string): PublicKeyBundle {
  const key = decodeJson<PublicKeyBundle>(value);
  if (key.version !== 1 || !key.agreement || !key.signing) {
    throw new Error("REMOTE_PUBLIC_KEY_INVALID");
  }
  return key;
}

function parsePrivateKey(value: string): PrivateKeyBundle {
  const key = decodeJson<PrivateKeyBundle>(value);
  if (
    key.version !== 1 ||
    !key.agreement ||
    !key.signing ||
    !key.agreementSecret ||
    !key.signingSecret
  ) {
    throw new Error("REMOTE_PRIVATE_KEY_INVALID");
  }
  return key;
}

function deriveKey(
  privateKey: PrivateKeyBundle,
  publicKey: PublicKeyBundle,
  salt: Uint8Array,
  context: string,
): Uint8Array {
  const shared = x25519.getSharedSecret(
    fromBase64Url(privateKey.agreementSecret),
    fromBase64Url(publicKey.agreement),
  );
  return hkdf(sha256, shared, salt, textEncoder.encode(`openerx-remote-v1:${context}`), 32);
}

export function generateRemoteDeviceKeyPair(
  random: SecureRandom = defaultRandom,
): RemoteDeviceKeyPair {
  const agreementSecret = random(32);
  const signingSecret = random(32);
  const publicKey: PublicKeyBundle = {
    version: 1,
    agreement: base64Url(x25519.getPublicKey(agreementSecret)),
    signing: base64Url(ed25519.getPublicKey(signingSecret)),
  };
  const privateKey: PrivateKeyBundle = {
    ...publicKey,
    agreementSecret: base64Url(agreementSecret),
    signingSecret: base64Url(signingSecret),
  };
  return { publicKey: encodeJson(publicKey), privateKey: encodeJson(privateKey) };
}

export function remotePairingProof(
  challengeId: string,
  oneTimeNonce: string,
  controllerDeviceId: string,
  privateKeyValue: string,
): string {
  const privateKey = parsePrivateKey(privateKeyValue);
  const message = textEncoder.encode(
    canonicalJson({ challengeId, controllerDeviceId, oneTimeNonce, version: 1 }),
  );
  return base64Url(ed25519.sign(message, fromBase64Url(privateKey.signingSecret)));
}

export function verifyRemotePairingProof(
  challengeId: string,
  oneTimeNonce: string,
  controllerDeviceId: string,
  controllerPublicKeyValue: string,
  proof: string,
): boolean {
  const publicKey = parsePublicKey(controllerPublicKeyValue);
  const message = textEncoder.encode(
    canonicalJson({ challengeId, controllerDeviceId, oneTimeNonce, version: 1 }),
  );
  return ed25519.verify(fromBase64Url(proof), message, fromBase64Url(publicKey.signing), {
    zip215: false,
  });
}

export function encryptRemotePayload(
  payload: RemoteCommandPayload | Record<string, unknown>,
  senderPrivateKeyValue: string,
  recipientPublicKeyValue: string,
  context: string,
  random: SecureRandom = defaultRandom,
): string {
  const senderPrivateKey = parsePrivateKey(senderPrivateKeyValue);
  const recipientPublicKey = parsePublicKey(recipientPublicKeyValue);
  const salt = random(32);
  const nonce = random(24);
  const aad = textEncoder.encode(`openerx-remote-v1:${context}`);
  const key = deriveKey(senderPrivateKey, recipientPublicKey, salt, context);
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(
    textEncoder.encode(canonicalJson(payload)),
  );
  return encodeJson({
    version: 1,
    salt: base64Url(salt),
    nonce: base64Url(nonce),
    ciphertext: base64Url(ciphertext),
  } satisfies CipherEnvelope);
}

export function decryptRemotePayload(
  encryptedPayload: string,
  recipientPrivateKeyValue: string,
  senderPublicKeyValue: string,
  context: string,
): RemoteCommandPayload {
  return remoteCommandPayloadSchema.parse(
    decryptRemoteObject(encryptedPayload, recipientPrivateKeyValue, senderPublicKeyValue, context),
  );
}

export function decryptRemoteObject<T = unknown>(
  encryptedPayload: string,
  recipientPrivateKeyValue: string,
  senderPublicKeyValue: string,
  context: string,
): T {
  const envelope = decodeJson<CipherEnvelope>(encryptedPayload);
  if (envelope.version !== 1) throw new Error("REMOTE_CIPHER_VERSION_UNSUPPORTED");
  const recipientPrivateKey = parsePrivateKey(recipientPrivateKeyValue);
  const senderPublicKey = parsePublicKey(senderPublicKeyValue);
  const salt = fromBase64Url(envelope.salt);
  const nonce = fromBase64Url(envelope.nonce);
  const aad = textEncoder.encode(`openerx-remote-v1:${context}`);
  const key = deriveKey(recipientPrivateKey, senderPublicKey, salt, context);
  try {
    const plaintext = xchacha20poly1305(key, nonce, aad).decrypt(
      fromBase64Url(envelope.ciphertext),
    );
    return JSON.parse(textDecoder.decode(plaintext)) as T;
  } catch {
    throw new Error("REMOTE_PAYLOAD_AUTHENTICATION_FAILED");
  }
}

type UnsignedRemoteCommand = Omit<RemoteCommand, "signature">;

export function remoteCommandSigningBytes(command: UnsignedRemoteCommand): Uint8Array {
  return textEncoder.encode(canonicalJson(command));
}

export function signRemoteCommand(
  command: UnsignedRemoteCommand,
  controllerPrivateKeyValue: string,
): RemoteCommand {
  const privateKey = parsePrivateKey(controllerPrivateKeyValue);
  return remoteCommandSchema.parse({
    ...command,
    signature: base64Url(
      ed25519.sign(remoteCommandSigningBytes(command), fromBase64Url(privateKey.signingSecret)),
    ),
  });
}

export function verifyRemoteCommand(
  command: RemoteCommand,
  controllerPublicKeyValue: string,
): boolean {
  const publicKey = parsePublicKey(controllerPublicKeyValue);
  const { signature, ...unsigned } = command;
  return ed25519.verify(
    fromBase64Url(signature),
    remoteCommandSigningBytes(unsigned),
    fromBase64Url(publicKey.signing),
    { zip215: false },
  );
}

export function commandCipherContext(
  command: Pick<RemoteCommand, "commandId" | "pairingId">,
): string {
  return `command:${command.commandId}:${command.pairingId}`;
}

export function encodeRemoteOpaque(value: unknown): string {
  return encodeJson(value);
}

export function decodeRemoteOpaque<T>(value: string): T {
  return decodeJson<T>(value);
}
