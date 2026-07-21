/** Persisted key names are public compatibility contracts shared by extension contexts. */
export const COUNTER_KEY = "save-in-counter";
export const LOG_STORAGE_KEY = "si-log";
export const DIAGNOSTIC_LIFECYCLE_SESSION_KEY = "siDiagnosticLifecycle";
export const HISTORY_STORAGE_KEY = "save-in-history";
export const HISTORY_INDEX_STORAGE_KEY = "save-in-history-index-v2";
export const HISTORY_INDEX_CHUNK_STORAGE_PREFIX = "save-in-history-index-v2:";
export const HISTORY_ENTRY_STORAGE_PREFIX = "save-in-history-entry-v2:";
export const LAST_USED_PATH_STORAGE_KEY = "lastUsedPath";
export const LAST_USED_META_STORAGE_KEY = "lastUsedMeta";
export const PRIVATE_LAST_USED_SESSION_KEY = "siPrivateLastUsed";
export const RECENT_DESTINATIONS_STORAGE_KEY = "recentDestinations";
export const DOWNLOADS_SESSION_KEY = "siDownloads";
export const PENDING_DOWNLOADS_SESSION_KEY = "siPendingDownloads";
// URL-free privacy barrier for Chrome, whose downloads.onCreated event loses
// every Incognito/extension ownership signal across a service-worker restart.
export const PRIVATE_PENDING_DOWNLOADS_SESSION_KEY = "siPrivatePendingDownloads";
export const NOTIFICATION_RECOVERY_SESSION_KEY = "siNotificationRecovery";
export const FINAL_FILENAMES_SESSION_KEY = "siFinalFilenames";
export const DEFERRED_ROUTES_SESSION_KEY = "siDeferredRoutes";
export const ACTIVE_TRANSFERS_SESSION_KEY = "siActiveTransfers";
export const SOURCE_PANEL_OPEN_SESSION_KEY = "sourcePanelOpen";
export const SOURCE_PANEL_SORT_STORAGE_KEY = "sourcePanelSort";
export const SOURCE_PANEL_LAYOUT_STORAGE_KEY = "sourcePanelLayout";
export const SOURCE_RULE_DRAFT_SESSION_KEY = "sourceRuleDraft";
export const EXTERNAL_DOWNLOAD_REJECTIONS_STORAGE_KEY = "externalDownloadRejections";
export const PATH_TRUNCATION_MIGRATION_STORAGE_KEY = "pathTruncationMigrationVersion";
export const PATH_TRUNCATION_MIGRATION_VERSION = 2;
export const WELCOME_PENDING_STORAGE_KEY = "welcomePendingVersion";
export const WELCOME_VERSION = 1;
