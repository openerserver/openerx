import { z } from "zod";

export const entityIdSchema = z.uuid();
export const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO timestamp",
});
