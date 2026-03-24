import { customType } from "drizzle-orm/pg-core";

export const ltree = customType<{ data: string; driverParam: string }>({
  dataType() {
    return "ltree";
  },
  toDriver(value: string) {
    return value;
  },
  fromDriver(value: unknown) {
    return String(value);
  },
});
