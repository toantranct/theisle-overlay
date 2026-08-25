// The single typed IPC surface. Mirrors src-tauri/src/commands.rs and
// events.rs — if a shape changes there, it changes here.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------------------------------------------------------------- events ---

/** Which basemap imagery is rendered. One key per calibration-frame x style. */
export type BasemapSource = "vulnona" | "islemaps_light" | "islemaps_dark";

export interface PositionUpdate {
  xCm: number;
  yCm: number;
  zCm: number;
  px: number;
  py: number;
  headingDeg: number | null;
  compassKey: string | null;
  inBounds: boolean;
}

export interface TrailPayload {
  segmentsCm: [number, number][][];
  segmentsPx: [number, number][][];
}

export type Settings = Record<string, unknown> & {
  minimap: {
    visible: boolean;
    require_game: boolean;
    corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    size_px: number;
    margin_px: number;
    opacity: number;
    radius_m: number;
    click_through: boolean;
    show_trail: boolean;
    show_waypoints: boolean;
  };
  hotkeys: Record<string, string>;
  layers: Record<string, boolean>;
  map: { zone_labels: boolean; basemap: BasemapSource };
  trail: {
    enabled: boolean;
    break_after_minutes: number;
    break_after_metres: number;
    min_node_distance_m: number;
  };
  number_format: "auto" | "us" | "eu";
  language: "vi" | "en";
  telemetry: { enabled: boolean };
  islepilot: {
    enabled: boolean;
    /** "token" = one Steam login for every server; "legacy" = per-server cookie. */
    auth_mode: "token" | "legacy";
    domain: string;
    poll_interval_s: number;
    use_map_position: boolean;
    map_pref_user_set: boolean;
    show_overlay_panel: boolean;
    show_quests_panel: boolean;
  };
};

export const onPositionUpdate = (
  cb: (p: PositionUpdate) => void,
): Promise<UnlistenFn> => listen<PositionUpdate>("position://update", (e) => cb(e.payload));

export const onTrailChanged = (
  cb: (t: TrailPayload) => void,
): Promise<UnlistenFn> => listen<TrailPayload>("trail://changed", (e) => cb(e.payload));

export const onSettingsChanged = (
  cb: (s: Settings) => void,
): Promise<UnlistenFn> => listen<Settings>("settings://changed", (e) => cb(e.payload));

export const onWaypointsChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("waypoints://changed", () => cb());

/**
 * Await-safe listener collection. The old pattern — pushing awaited unlisten
 * fns into an array the cleanup closes over — leaked every listener whose
 * `listen()` resolved after the component unmounted (fast tab switching).
 */
export function listenerBag() {
  let disposed = false;
  const fns: UnlistenFn[] = [];
  return {
    async add(p: Promise<UnlistenFn>): Promise<void> {
      const unlisten = await p;
      if (disposed) unlisten();
      else fns.push(unlisten);
    },
    dispose(): void {
      disposed = true;
      for (const fn of fns) fn();
      fns.length = 0;
    },
  };
}

export interface FailedHotkey {
  action: string;
  spec: string;
}

export const onHotkeyFailed = (
  cb: (failed: FailedHotkey[]) => void,
): Promise<UnlistenFn> => listen<FailedHotkey[]>("hotkey://failed", (e) => cb(e.payload));

/** The full-map hotkey just SHOWED the window — switch to the map tab. */
export const onFullmapShow = (cb: () => void): Promise<UnlistenFn> =>
  listen("fullmap://show", () => cb());

// -------------------------------------------------------------- commands ---

export interface Waypoint {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string | null;
  created: string | null;
}

export interface DataStatus {
  basemapMinimap: boolean;
  basemapFullmap: boolean;
  pois: boolean;
}

export const getSettings = () => invoke<Settings>("get_settings");
export const patchSettings = (patch: object) =>
  invoke<Settings>("patch_settings", { patch });

/** Last known position (null before the first sample) — for initial paint. */
export const getCurrentPosition = () =>
  invoke<PositionUpdate | null>("get_current_position");

export type WaypointPx = Waypoint & { px: number; py: number };

export const listWaypoints = () => invoke<Waypoint[]>("list_waypoints");
export const listWaypointsPx = () => invoke<WaypointPx[]>("list_waypoints_px");
export const addWaypointAtPixel = (px: number, py: number, name: string) =>
  invoke<Waypoint>("add_waypoint_at_pixel", { px, py, name });
export const addWaypointHere = (name: string) =>
  invoke<Waypoint | null>("add_waypoint_here", { name });
export const renameWaypoint = (id: string, name: string) =>
  invoke<boolean>("rename_waypoint", { id, name });
export const setWaypointColor = (id: string, color: string | null) =>
  invoke<boolean>("set_waypoint_color", { id, color });
export const deleteWaypoint = (id: string) =>
  invoke<boolean>("delete_waypoint", { id });

export interface ResolvedCoords {
  xCm: number;
  yCm: number;
  px: number;
  py: number;
  inBounds: boolean;
}

/**
 * Parse a MANUALLY pasted coordinate string into world cm + active-basemap
 * px — same Rust parser and number format as the clipboard path.
 */
export const resolveCoordinates = (text: string) =>
  invoke<ResolvedCoords | null>("resolve_coordinates", { text });

export const getPreviousTrail = () => invoke<TrailPayload>("get_previous_trail");
export const getCurrentTrail = () => invoke<TrailPayload>("get_current_trail");

/**
 * Declutter: reset the in-memory trail (both windows repaint via
 * trail://changed) and hide the previous session's dimmed trail. Files on
 * disk keep the full history.
 */
export const clearTrail = () => invoke("clear_trail");

export const getDataStatus = () => invoke<DataStatus>("data_status");

/** Kick off the (re-)download; watch fetch:// events for progress/result. */
export const startFetchData = (force: boolean) => invoke("fetch_data", { force });

export interface FetchProgress {
  file: string;
  index: number;
  total: number;
  status: "downloading" | "done" | "skipped" | "error";
  error: string | null;
}

export interface FetchFinished {
  ok: boolean;
  basemapOk: boolean;
  poisOk: boolean;
  error: string | null;
}

export const onFetchProgress = (
  cb: (p: FetchProgress) => void,
): Promise<UnlistenFn> => listen<FetchProgress>("fetch://progress", (e) => cb(e.payload));

export const onFetchFinished = (
  cb: (f: FetchFinished) => void,
): Promise<UnlistenFn> => listen<FetchFinished>("fetch://finished", (e) => cb(e.payload));
export const getFullscreenMode = () => invoke<number | null>("get_fullscreen_mode");

/** POI layer data, shape produced by fetch_data (px precomputed at fetch). */
export const getPois = () => invoke<unknown>("get_pois");

export interface PoiItem {
  label: string;
  px: number;
  py: number;
  xCm: number;
  yCm: number;
  radiusPx?: number;
  pointsPx?: [number, number][];
  /** Zones: name-label anchor (polygon centroid / circle centre). */
  labelPx?: number;
  labelPy?: number;
}

export interface PoiLayer {
  key: string;
  kind: "point" | "zone" | "label";
  items: PoiItem[];
}

/** POI layers with all coordinates precomputed to basemap pixels by Rust. */
export const getPoisRender = () => invoke<PoiLayer[]>("get_pois_render");

export interface NearestWaypoint {
  id: string;
  name: string;
  bearingDeg: number;
  compassKey: string;
  distanceM: number;
}

export const getNearestWaypoint = () =>
  invoke<NearestWaypoint | null>("nearest_waypoint");

/** True when the spec parses AND the combination is currently free. */
export const checkHotkeyAvailable = (spec: string) =>
  invoke<boolean>("check_hotkey_available", { spec });

/** Re-register all hotkeys from the current settings (after a rebind). */
export const applyHotkeys = () => invoke("apply_hotkeys");

export interface BasemapUrls {
  minimap: string;
  fullmap: string;
  source: BasemapSource;
  /** Decode-time downscale hint for the minimap (set for islemaps PNGs). */
  minimapDecodeWidth: number | null;
}

export async function getBasemapUrls(): Promise<BasemapUrls> {
  const paths = await invoke<BasemapUrls>("get_basemap_paths");
  return {
    ...paths,
    minimap: convertFileSrc(paths.minimap),
    fullmap: convertFileSrc(paths.fullmap),
  };
}

export interface OverlayRender {
  /** Doubles as the layers.* visibility key. */
  key: string;
  /** Ready-to-use asset URL (already through convertFileSrc). */
  url: string;
  /** [left, top, right, bottom] in ACTIVE-calibration basemap px. */
  boundsPx: [number, number, number, number];
}

export interface MapInfo {
  imageWidthPx: number;
  imageHeightPx: number;
  /** Basemap pixels per real-world metre, horizontal / vertical. */
  pxPerMX: number;
  pxPerMY: number;
  source: BasemapSource;
  /** Image overlays present on disk, re-projected to the active basemap. */
  overlays: OverlayRender[];
}

/** Geometry of the ACTIVE basemap — the frontend holds no transform of its own. */
export async function getMapInfo(): Promise<MapInfo> {
  const info = await invoke<Omit<MapInfo, "overlays"> & {
    overlays: { key: string; path: string; boundsPx: [number, number, number, number] }[];
  }>("get_map_info");
  return {
    ...info,
    overlays: info.overlays.map((o) => ({
      key: o.key,
      url: convertFileSrc(o.path),
      boundsPx: o.boundsPx,
    })),
  };
}

/**
 * Switch basemap imagery. Downloads the islemaps PNG on first selection
 * (rejects offline, settings untouched); on success settings are patched
 * (broadcast to every window) and position/trail are resynced.
 */
export const setBasemapSource = (source: BasemapSource) =>
  invoke("set_basemap_source", { source });

// ----------------------------------------------------- "your dino" (IslePilot) ---

export interface DinoStatBar {
  raw: string;
  current: number | null;
  max: number | null;
}

export interface DinoQuest {
  text: string;
  /** Vietnamese translation from the backend; absent when untranslated. */
  textVi?: string | null;
  completed: boolean;
}

export interface DinoNutrition {
  carb: number;
  protein: number;
  lipid: number;
}

export interface DinoPlayer {
  dinoName: string | null;
  online: boolean | null;
  growth: string | null;
  growthPct: number | null;
  health: DinoStatBar | null;
  hunger: DinoStatBar | null;
  thirst: DinoStatBar | null;
  primeQuests: DinoQuest[];
  // Extras only the token-mode JSON API provides (absent in cookie mode).
  stamina?: DinoStatBar | null;
  nutrition?: DinoNutrition | null;
  server?: string | null;
  female?: boolean | null;
}

export interface DinoMap {
  mapDisabled: boolean;
  x: number | null;
  y: number | null;
  headingDeg: number | null;
  viewBox: [number, number, number, number] | null;
  pctX: number | null;
  pctY: number | null;
}

export interface DinoUpdate {
  domain: string;
  fetchedAtMs: number;
  player: DinoPlayer | null;
  map: DinoMap | null;
  layoutChanged: boolean;
  /** Whether the server runs a live map at all; null until probed. */
  liveMapAvailable: boolean | null;
  error: string | null;
}

export interface IslepilotState {
  loggedIn: boolean;
  authMode: "token" | "legacy";
  tokenPresent: boolean;
  lastUpdate: DinoUpdate | null;
}

export const islepilotLogin = (domain: string) =>
  invoke("islepilot_login", { domain });
/** Manual fallback: validate + store a pasted Cookie header. */
export const islepilotSetCookie = (domain: string, cookie: string) =>
  invoke("islepilot_set_cookie", { domain, cookie });
/** Token mode: one Steam login, works on every IslePilot server. */
export const islepilotTokenLogin = () => invoke("islepilot_token_login");
/** Manual fallback for token mode: paste the overlay token (or redirect URL). */
export const islepilotSetToken = (token: string) =>
  invoke("islepilot_set_token", { token });
export const islepilotCancelLogin = () => invoke("islepilot_cancel_login");

// -- token-mode extras: overlay-map POIs + garage (gacha) --

export interface IslepilotPoiCategory {
  id: string;
  name: string;
  color: string | null;
}

export interface IslepilotPoi {
  id: string;
  name: string | null;
  categoryId: string | null;
  color: string | null;
  shape: string | null;
  /** Render pixels on the ACTIVE basemap, one per source point. */
  pointsPx: [number, number][];
}

export interface IslepilotOverlayMap {
  available: boolean;
  /** "not-logged-in" | "disabled" | "discord" | "empty" when unavailable. */
  reason: string | null;
  categories: IslepilotPoiCategory[];
  pois: IslepilotPoi[];
}

/** IslePilot POIs for the full map (token mode; Rust caches ~15 s). */
export const islepilotOverlayMap = () =>
  invoke<IslepilotOverlayMap>("islepilot_overlay_map");

/**
 * Download-and-cache a skinviewer CDN asset (3D model / texture) via Rust
 * (the CDN sends no CORS headers); resolves to a local path for
 * convertFileSrc.
 */
export const islepilotCdnAsset = (url: string) =>
  invoke<string>("islepilot_cdn_asset", { url });

export interface CdnProgress {
  url: string;
  received: number;
  /** 0 when the server sent no Content-Length. */
  total: number;
}

/** Download progress of skinviewer CDN assets (only fires for cache misses). */
export const onCdnProgress = (
  cb: (p: CdnProgress) => void,
): Promise<UnlistenFn> => listen<CdnProgress>("cdn://progress", (e) => cb(e.payload));

/** Fetch a cached CDN asset as raw bytes (through the asset protocol). */
export async function fetchCdnAsset(url: string): Promise<ArrayBuffer> {
  const path = await islepilotCdnAsset(url);
  const resp = await fetch(convertFileSrc(path));
  if (!resp.ok) throw new Error(`asset fetch failed: ${resp.status}`);
  return resp.arrayBuffer();
}

/** Parked-dino record — backend shape, read defensively in the UI. */
export type GarageDino = Record<string, unknown> & { id?: string };

export interface GarageState {
  dinos: GarageDino[];
  sellingEnabled: boolean;
  liveSwap: boolean;
  currencyName: string | null;
}

export const islepilotGarage = () => invoke<GarageState>("islepilot_garage");
/** Park the CURRENT dino (blocks through the server's async command, ~60 s max). */
export const islepilotGaragePark = () => invoke("islepilot_garage_park");
export const islepilotGarageRestore = (id: string) =>
  invoke("islepilot_garage_restore", { id });
export const islepilotGarageSell = (id: string) =>
  invoke("islepilot_garage_sell", { id });
export const islepilotGarageRename = (id: string, name: string) =>
  invoke("islepilot_garage_rename", { id, name });
export const islepilotLogout = () => invoke("islepilot_logout");
export const islepilotApply = () => invoke("islepilot_apply");
export const islepilotState = () => invoke<IslepilotState>("islepilot_state");

export const onDinoUpdate = (cb: (u: DinoUpdate) => void): Promise<UnlistenFn> =>
  listen<DinoUpdate>("dino://update", (e) => cb(e.payload));
export const onDinoAuthExpired = (cb: () => void): Promise<UnlistenFn> =>
  listen("dino://auth-expired", () => cb());
export const onDinoLoginOk = (cb: () => void): Promise<UnlistenFn> =>
  listen("dino://login-ok", () => cb());
export const onDinoLoginFailed = (
  cb: (reason: string) => void,
): Promise<UnlistenFn> => listen<string>("dino://login-failed", (e) => cb(e.payload));

/** Dev builds only. */
export const simulatePosition = (x: number, y: number, z: number) =>
  invoke("simulate_position", { x, y, z });

// ------------------------------------------------------------- telemetry ---

/**
 * Feature names the backend knows about. Mirrors `FEATURE_SLOTS` in
 * `src-tauri/src/telemetry/counters.rs` and `worker/src/features.ts`; a Rust
 * test fails if those two drift, and this union makes a typo here a compile
 * error rather than a silently uncounted feature.
 */
export type Feature =
  | "fullmap_open"
  | "minimap_toggle"
  | "waypoint_add"
  | "waypoint_delete"
  | "trail_view"
  | "layer_toggle"
  | "basemap_change"
  | "islepilot_login"
  | "islepilot_garage"
  | "dino_tab_open"
  | "guide_open"
  | "settings_open"
  | "hotkey_used"
  | "quests_open"
  | "coord_resolve"
  | "data_fetch"
  | "donate_open"
  | "language_switch";

/**
 * Count one use of a feature. Cheap and fire-and-forget: Rust increments an
 * atomic and the total rides along on the next launch's single ping, so this
 * is safe to call from a click handler in a hot path.
 */
export const trackFeature = (name: Feature): void => {
  void invoke("track_feature", { name }).catch(() => {});
};

export type FeedbackCategory = "bug" | "idea" | "other";

/** Rejects with "unavailable" | "send_failed". */
export const submitFeedback = (
  category: FeedbackCategory,
  body: string,
  contact?: string,
) => invoke<void>("submit_feedback", { category, body, contact: contact || null });

/** Report a frontend error. Windows account names are stripped in Rust. */
export const submitCrash = (message: string, stack?: string): void => {
  void invoke("submit_crash", { message, stack: stack ?? null }).catch(() => {});
};
