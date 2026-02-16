/**
 * Types for Readeck integration
 * API docs: https://readeck.org/en/docs/api/
 */

/** Readeck settings stored in system settings */
export interface ReadeckSettings {
  enabled: boolean;
  serverUrl: string; // e.g., "https://readeck.example.com"
  apiToken: string; // Bearer token from Readeck profile/tokens
  autoArchive: boolean; // Archive on Readeck when finished reading
  syncIntervalMinutes: number; // How often to check for new articles (default: 30)
}
