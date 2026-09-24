export const DEFAULT_SCHEMA = "event_store";
export const DEFAULT_PROJECTION_BATCH_SIZE = 500;
export const DEFAULT_STREAM_LOCK_SEED = 1936024421;
/** Second key of the per-schema, two-integer advisory lock for event writers. */
export const WATERMARK_LOCK_KEY = 19460103;
/** Serializes short certification attempts without waiting for event writers. */
export const WATERMARK_READER_LOCK_KEY = 19460104;
/** Prevents concurrent replicas from racing on catalog DDL at startup. */
export const MIGRATION_LOCK_KEY = 19460105;
