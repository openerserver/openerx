export function normalizeInternationalPhoneNumber(value: string) {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeAuthIdentifier(value: string) {
  const phoneNumber = normalizeInternationalPhoneNumber(value);
  return phoneNumber ?? value.trim().toLowerCase();
}

export function generatedUsernameFromPhone(phoneNumber: string, userId: string) {
  const digits = phoneNumber.replace(/^\+/, "");
  return `phone_${digits}_${userId.slice(0, 8)}`;
}
