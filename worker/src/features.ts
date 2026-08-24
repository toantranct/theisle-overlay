/**
 * Feature usage slots.
 *
 * Each feature occupies a FIXED position in the Analytics Engine `doubles`
 * array, which is why this list may only ever be APPENDED to. Inserting in
 * the middle or reordering silently reinterprets all historical data.
 *
 * `src-tauri/src/telemetry/counters.rs` holds the identical list and a test
 * asserts the two stay in sync by length + order. Change one, change both.
 *
 * A data point has at most 20 doubles; slots 0 and 1 are launches and session
 * minutes, so there is room for exactly 18 features.
 */
export const FEATURE_SLOTS = [
  "fullmap_open",
  "minimap_toggle",
  "waypoint_add",
  "waypoint_delete",
  "trail_view",
  "layer_toggle",
  "basemap_change",
  "islepilot_login",
  "islepilot_garage",
  "dino3d_view",
  "guide_open",
  "settings_open",
  "hotkey_used",
  "quests_open",
  "coord_resolve",
  "data_fetch",
  "donate_open",
  "language_switch",
] as const;

export const DOUBLE_LAUNCHES = 0;
export const DOUBLE_SESSION_MINUTES = 1;
export const DOUBLE_FEATURE_BASE = 2;

if (FEATURE_SLOTS.length + DOUBLE_FEATURE_BASE > 20) {
  throw new Error("FEATURE_SLOTS exceeds the 20-double limit of a data point");
}
