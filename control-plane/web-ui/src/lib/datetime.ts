const LEGACY_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function parseApiDateTime(value: string) {
  if (LEGACY_DATETIME_PATTERN.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`);
  }
  return new Date(value);
}

export function formatApiDateTime(value: string) {
  if (!value) return "-";
  return parseApiDateTime(value).toLocaleString();
}
