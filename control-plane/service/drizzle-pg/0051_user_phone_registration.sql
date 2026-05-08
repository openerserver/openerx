-- Migration 0051: add E.164 phone number identity for public self-registration.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_number_unique"
  ON "users" ("phone_number");
