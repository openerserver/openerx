-- Migration 0042: align execution_status enum with runtime queued state.

ALTER TYPE "execution_status" ADD VALUE IF NOT EXISTS 'queued';