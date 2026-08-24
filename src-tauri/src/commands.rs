//! All #[tauri::command] handlers — the whole IPC surface, mirrored by
//! `src/lib/api.ts` on the frontend.

use overlay_core::{
    bearing_to_compass_key, pixel_to_world, world_to_pixel, Calibration, MapSource,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::events::{PositionUpdate, TrailPayload, SETTINGS_CHANGED};
use crate::pipeline;
use crate::settings;
use crate::state::{AppState, LockExt};
use crate::store::{self, Waypoint};
use crate::telemetry;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Value {
    state.settings.lock_safe().clone()
}

/// Count the settings changes that are really feature use.
///
/// Reading the PATCH rather than the merged result is what makes this work:
/// the patch contains exactly the keys someone just touched, so a toggle is
/// counted once whether it came from the Settings screen or a hotkey, and an
/// unrelated save counts nothing.
fn count_settings_features(patch: &Value) {
    let touched = |path: &[&str]| settings::get_path(patch, path).is_some();
    if touched(&["minimap", "visible"]) {
        telemetry::counters::track("minimap_toggle");
    }
    if touched(&["language"]) {
        telemetry::counters::track("language_switch");
    }
    if touched(&["trail", "enabled"]) || touched(&["minimap", "show_trail"]) {
        telemetry::counters::track("trail_view");
    }
    if touched(&["islepilot", "show_quests_panel"]) {
        telemetry::counters::track("quests_open");
    }
    if let Some(layers) = patch.get("layers").and_then(Value::as_object) {
        for _ in layers.keys() {
            telemetry::counters::track("layer_toggle");
        }
    }
}

/// Deep-merge a partial patch into the settings, persist (debounced), and
/// broadcast the full new settings to every window. Shared by the IPC command
/// and the hotkey actions so both paths behave identically.
pub fn apply_settings_patch(app: &AppHandle, patch: Value) -> Value {
    count_settings_features(&patch);
    let state = app.state::<AppState>();
    let (old_language, merged) = {
        let mut s = state.settings.lock_safe();
        let old_language = settings::get_str(&s, &["language"], "vi").to_string();
        *s = settings::merge(&s, &patch);
        (old_language, s.clone())
    };
    state.request_settings_save();
    if settings::get_str(&merged, &["language"], "vi") != old_language {
        crate::tray::rebuild_menu(app);
    }
    crate::events::emit_all(app, SETTINGS_CHANGED, merged.clone());
    merged
}

#[tauri::command]
pub fn patch_settings(app: AppHandle, patch: Value) -> Value {
    apply_settings_patch(&app, patch)
}

/// The last known position, so a (re)loaded webview paints immediately —
/// position otherwise only arrives as an event on the NEXT manual copy.
#[tauri::command]
pub fn get_current_position(state: State<AppState>) -> Option<PositionUpdate> {
    pipeline::current_payload(&state)
}

/// Settings-screen probe: is this key combination valid AND currently free?
/// Registering on a scratch id and immediately unregistering answers both.
#[tauri::command]
pub fn check_hotkey_available(spec: String) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS,
    };
    const PROBE_ID: i32 = 0x3FFF;
    let Some((mods, vk)) = crate::hotkeys::parse_hotkey(&spec) else {
        return false;
    };
    unsafe {
        if RegisterHotKey(None, PROBE_ID, HOT_KEY_MODIFIERS(mods), vk).is_ok() {
            let _ = UnregisterHotKey(None, PROBE_ID);
            true
        } else {
            false
        }
    }
}

/// Re-register all hotkeys from the current settings (after a rebind).
#[tauri::command]
pub fn apply_hotkeys(app: AppHandle, state: State<AppState>) {
    state.hotkeys.restart(app.clone());
}

#[tauri::command]
pub fn list_waypoints(state: State<AppState>) -> Vec<Waypoint> {
    state.waypoints.lock_safe().clone()
}

#[derive(Serialize)]
pub struct WaypointPx {
    #[serde(flatten)]
    pub waypoint: Waypoint,
    pub px: f64,
    pub py: f64,
}

/// Waypoints with render pixels attached — the transform stays in Rust.
#[tauri::command]
pub fn list_waypoints_px(state: State<AppState>) -> Vec<WaypointPx> {
    let cal = state.active_calibration();
    state
        .waypoints
        .lock_safe()
        .iter()
        .map(|wp| {
            let (px, py) = world_to_pixel(wp.x, wp.y, cal);
            WaypointPx {
                waypoint: wp.clone(),
                px,
                py,
            }
        })
        .collect()
}

fn persist_waypoints(app: &AppHandle, waypoints: &[Waypoint]) {
    if let Err(e) = store::save_waypoints(waypoints) {
        log::warn!("saving waypoints failed: {e}");
    }
    // Both windows refresh on this (the minimap draws waypoints too).
    crate::events::emit_all(app, "waypoints://changed", ());
}

/// Right-click on the full map: the frontend sends the clicked PIXEL and Rust
/// converts — the transform stays single-sourced. Stored coords are raw cm.
#[tauri::command]
pub fn add_waypoint_at_pixel(
    app: AppHandle,
    state: State<AppState>,
    px: f64,
    py: f64,
    name: String,
) -> Waypoint {
    telemetry::counters::track("waypoint_add");
    let (x, y) = pixel_to_world(px, py, state.active_calibration());
    let wp = store::new_waypoint(&name, x, y, 0.0, None);
    let mut waypoints = state.waypoints.lock_safe();
    waypoints.push(wp.clone());
    persist_waypoints(&app, &waypoints);
    wp
}

/// The "mark here" hotkey action: drop a waypoint at the current position.
#[tauri::command]
pub fn add_waypoint_here(app: AppHandle, state: State<AppState>, name: String) -> Option<Waypoint> {
    telemetry::counters::track("waypoint_add");
    let current = state.tracker.lock_safe().current?;
    let wp = store::new_waypoint(&name, current.x, current.y, current.z, None);
    let mut waypoints = state.waypoints.lock_safe();
    waypoints.push(wp.clone());
    persist_waypoints(&app, &waypoints);
    Some(wp)
}

#[tauri::command]
pub fn rename_waypoint(app: AppHandle, state: State<AppState>, id: String, name: String) -> bool {
    let mut waypoints = state.waypoints.lock_safe();
    let Some(wp) = waypoints.iter_mut().find(|w| w.id == id) else {
        return false;
    };
    wp.name = name;
    persist_waypoints(&app, &waypoints);
    true
}

/// Set (or clear, with None) a waypoint's colour. Colours live in the same
/// legacy-compatible field the Python app already had.
#[tauri::command]
pub fn set_waypoint_color(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    color: Option<String>,
) -> bool {
    let mut waypoints = state.waypoints.lock_safe();
    let Some(wp) = waypoints.iter_mut().find(|w| w.id == id) else {
        return false;
    };
    wp.color = color;
    persist_waypoints(&app, &waypoints);
    true
}

#[tauri::command]
pub fn delete_waypoint(app: AppHandle, state: State<AppState>, id: String) -> bool {
    let mut waypoints = state.waypoints.lock_safe();
    let before = waypoints.len();
    waypoints.retain(|w| w.id != id);
    let removed = waypoints.len() != before;
    if removed {
        telemetry::counters::track("waypoint_delete");
        persist_waypoints(&app, &waypoints);
    }
    removed
}

/// The previous session's trail (bug fix: the old app wrote trails but never
/// restored them), rendered dimmed on both maps.
#[tauri::command]
pub fn get_previous_trail(state: State<AppState>) -> TrailPayload {
    let cal = state.active_calibration();
    match state.previous_trail_path.lock_safe().as_ref() {
        Some(path) => pipeline::trail_payload(&store::load_trail(path), cal),
        None => TrailPayload::default(),
    }
}

/// "Clear trail": declutter the maps mid-session. Resets the in-memory trail
/// (both windows repaint via trail://changed) and hides the previous
/// session's dimmed trail for the rest of this session. The trail FILES are
/// untouched — history survives on disk; a break record marks the cut.
#[tauri::command]
pub fn clear_trail(app: AppHandle, state: State<AppState>) {
    state.tracker.lock_safe().clear_trail();
    *state.previous_trail_path.lock_safe() = None;
    if let Some(writer) = state.trail_writer.lock_safe().as_mut() {
        writer.add_break();
    }
    let cal = state.active_calibration();
    crate::events::emit_all(&app, crate::events::TRAIL_CHANGED, pipeline::trail_payload(&[], cal));
}

/// The current session's trail so far — for a window opening mid-session.
#[tauri::command]
pub fn get_current_trail(state: State<AppState>) -> TrailPayload {
    // Resolve the calibration BEFORE taking the tracker lock (it briefly
    // takes the settings lock).
    let cal = state.active_calibration();
    let tracker = state.tracker.lock_safe();
    pipeline::trail_payload(&tracker.segments, cal)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataStatus {
    pub basemap_minimap: bool,
    pub basemap_fullmap: bool,
    pub pois: bool,
}

#[tauri::command]
pub fn data_status() -> DataStatus {
    DataStatus {
        basemap_minimap: settings::basemap_dir().join("minimap.webp").exists(),
        basemap_fullmap: settings::basemap_dir().join("fullmap.webp").exists(),
        pois: settings::pois_path().exists(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BasemapPaths {
    pub minimap: String,
    pub fullmap: String,
    /// "vulnona" | "islemaps_light" | "islemaps_dark"
    pub source: String,
    /// Decode-time downscale hint for the minimap's createImageBitmap — set
    /// for the big islemaps PNGs so the always-resident bitmap stays small.
    pub minimap_decode_width: Option<u32>,
}

/// The minimap decode width for islemaps imagery: 1250 px over the 1234-unit
/// world span is slightly sharper than the vulnona minimap tier (975/1112)
/// while keeping the resident bitmap at ~6 MB instead of ~25 MB.
const ISLEMAPS_MINIMAP_DECODE_WIDTH: u32 = 1250;

/// Absolute paths for the frontend to feed through `convertFileSrc()` (asset
/// protocol) — the images are never bundled into the app. For islemaps both
/// roles use the same PNG; the minimap downscales at decode.
#[tauri::command]
pub fn get_basemap_paths(state: State<AppState>) -> BasemapPaths {
    let source = state.active_source();
    match crate::fetch::IslemapsVariant::for_source(source) {
        Some(variant) => {
            let path = variant.dest().to_string_lossy().into_owned();
            BasemapPaths {
                minimap: path.clone(),
                fullmap: path,
                source: source.key().to_string(),
                minimap_decode_width: Some(ISLEMAPS_MINIMAP_DECODE_WIDTH),
            }
        }
        None => BasemapPaths {
            minimap: settings::basemap_dir()
                .join("minimap.webp")
                .to_string_lossy()
                .into_owned(),
            fullmap: settings::basemap_dir()
                .join("fullmap.webp")
                .to_string_lossy()
                .into_owned(),
            source: source.key().to_string(),
            minimap_decode_width: None,
        },
    }
}

/// Switch the basemap imagery. Downloads the islemaps PNG on first selection
/// (blocking work off the async core), then patches settings (which
/// broadcasts `settings://changed`) and resyncs so both windows repaint in
/// the new frame. Settings are only ever patched on success, so "revert on
/// failure" needs no code. Deliberately does NOT emit `fetch://finished` —
/// that channel means "the vulnona+POI bundle finished" and drives first-run.
#[tauri::command]
pub async fn set_basemap_source(app: AppHandle, source: String) -> Result<(), String> {
    let src = MapSource::try_from_key(&source)
        .ok_or_else(|| format!("unknown basemap source {source:?}"))?;
    if let Some(variant) = crate::fetch::IslemapsVariant::for_source(src) {
        if !variant.dest().exists() {
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::fetch::fetch_islemaps_with_events(&app2, variant, false)
            })
            .await
            .map_err(|e| e.to_string())??;
        }
    }
    apply_settings_patch(&app, serde_json::json!({ "map": { "basemap": src.key() } }));
    pipeline::resync(&app);
    // Counted here, not at entry: a failed imagery download leaves settings
    // untouched, so it must leave the counter untouched too.
    telemetry::counters::track("basemap_change");
    Ok(())
}

/// Raw pois_gateway.json (already px+cm normalised by the fetch step).
#[tauri::command]
pub fn get_pois() -> Result<Value, String> {
    let text = std::fs::read_to_string(settings::pois_path()).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiItem {
    pub label: String,
    pub px: f64,
    pub py: f64,
    /// cm, so the minimap can distance-filter without any transform.
    pub x_cm: f64,
    pub y_cm: f64,
    /// Circle zones: radius in basemap pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius_px: Option<f64>,
    /// Polygon zones: vertices in basemap pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points_px: Option<Vec<(f64, f64)>>,
    /// Zones: where to place the name label (polygon centroid, circle
    /// centre) — computed here so the frontend never does geometry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_py: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiLayer {
    pub key: String,
    /// "point" | "zone"
    pub kind: String,
    pub items: Vec<PoiItem>,
}

/// One POI record -> render item, or None when it carries no usable geometry.
///
/// Polygon zones have NO top-level x/y (only `points`), so the world anchor is
/// derived from the vertex centroid. Reading `points` BEFORE the x/y lookup is
/// the whole point: the old order dropped every polygon zone before it ever
/// looked at them.
fn poi_render_item(item: &Value, kind: &str, cal: &Calibration) -> Option<PoiItem> {
    let shape = item.get("shape").and_then(|s| s.as_str());
    // Vertices in world cm first — they double as the anchor for polygons.
    let points_cm: Option<Vec<(f64, f64)>> = (shape == Some("polygon"))
        .then(|| item.get("points").and_then(|p| p.as_array()))
        .flatten()
        .map(|pts| {
            pts.iter()
                .filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?)))
                .collect::<Vec<_>>()
        })
        .filter(|pts: &Vec<_>| pts.len() >= 3);

    let (x, y) = match (
        item.get("x").and_then(|v| v.as_f64()),
        item.get("y").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => (x, y),
        // Vertex centroid is plenty for an anchor (and for name placement).
        _ => {
            let pts = points_cm.as_ref()?;
            let n = pts.len() as f64;
            (
                pts.iter().map(|p| p.0).sum::<f64>() / n,
                pts.iter().map(|p| p.1).sum::<f64>() / n,
            )
        }
    };
    let (px, py) = world_to_pixel(x, y, cal);

    // Same metres->basemap-pixels factor the original layers.py used.
    let radius_px = (shape == Some("circle"))
        .then(|| item.get("radius_m").and_then(|r| r.as_f64()))
        .flatten()
        .map(|r_m| r_m * 100.0 / 1000.0 / cal.span_y() * cal.image_width_px as f64)
        .filter(|r| *r > 0.0);
    let points_px = points_cm
        .map(|pts| pts.iter().map(|p| world_to_pixel(p.0, p.1, cal)).collect::<Vec<_>>());

    let (label_px, label_py) = if kind == "zone" {
        match &points_px {
            Some(pts) => {
                let n = pts.len() as f64;
                (
                    Some(pts.iter().map(|p| p.0).sum::<f64>() / n),
                    Some(pts.iter().map(|p| p.1).sum::<f64>() / n),
                )
            }
            None => (Some(px), Some(py)),
        }
    } else {
        (None, None)
    };

    Some(PoiItem {
        label: item
            .get("label")
            .and_then(|l| l.as_str())
            .unwrap_or_default()
            .to_string(),
        px,
        py,
        x_cm: x,
        y_cm: y,
        radius_px,
        points_px,
        label_px,
        label_py,
    })
}

/// POI layers with every coordinate already converted to basemap pixels —
/// the frontend renders, it never transforms.
#[tauri::command]
pub fn get_pois_render(state: State<AppState>) -> Result<Vec<PoiLayer>, String> {
    let cal = state.active_calibration();
    let text = std::fs::read_to_string(settings::pois_path()).map_err(|e| e.to_string())?;
    let raw: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let Some(layers) = raw.get("layers").and_then(|l| l.as_object()) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for (key, layer) in layers {
        let kind = layer
            .get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("point")
            .to_string();
        let items = layer
            .get("items")
            .and_then(|i| i.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| poi_render_item(item, &kind, cal))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        out.push(PoiLayer {
            key: key.clone(),
            kind,
            items,
        });
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearestWaypoint {
    pub id: String,
    pub name: String,
    pub bearing_deg: f64,
    pub compass_key: &'static str,
    pub distance_m: f64,
}

/// Closest saved waypoint to the current position, with bearing — geometry
/// stays in Rust like every other transform.
#[tauri::command]
pub fn nearest_waypoint(state: State<AppState>) -> Option<NearestWaypoint> {
    let tracker = state.tracker.lock_safe();
    let waypoints = state.waypoints.lock_safe();
    let mut best: Option<NearestWaypoint> = None;
    for wp in waypoints.iter() {
        let Some((bearing, dist)) = tracker.bearing_to(wp.x, wp.y) else {
            return None; // no current position yet
        };
        if best.as_ref().is_none_or(|b| dist < b.distance_m) {
            best = Some(NearestWaypoint {
                id: wp.id.clone(),
                name: wp.name.clone(),
                bearing_deg: bearing,
                compass_key: bearing_to_compass_key(bearing),
                distance_m: dist,
            });
        }
    }
    best
}

/// 0 = exclusive fullscreen (overlay cannot draw) -> the UI shows a warning
/// banner. None = game config not found.
#[tauri::command]
pub fn get_fullscreen_mode() -> Option<i32> {
    settings::read_game_fullscreen_mode()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCoords {
    pub x_cm: f64,
    pub y_cm: f64,
    pub px: f64,
    pub py: f64,
    pub in_bounds: bool,
}

/// Parse a MANUALLY pasted coordinate string (friend's Discord message, own
/// notes) into world cm + active-basemap px, with the same parser and number
/// format the clipboard path uses. Manual input only — never wired to any
/// automatic source.
#[tauri::command]
pub fn resolve_coordinates(state: State<AppState>, text: String) -> Option<ResolvedCoords> {
    let format = {
        let s = state.settings.lock_safe();
        overlay_core::NumberFormat::from_setting(settings::get_str(&s, &["number_format"], "auto"))
    };
    let (x, y, _z) = overlay_core::parse_coordinates(&text, format)?;
    telemetry::counters::track("coord_resolve");
    let cal = state.active_calibration();
    let (px, py) = world_to_pixel(x, y, cal);
    Some(ResolvedCoords {
        x_cm: x,
        y_cm: y,
        px,
        py,
        in_bounds: overlay_core::is_in_bounds(px, py, cal),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapInfo {
    pub image_width_px: u32,
    pub image_height_px: u32,
    /// Basemap pixels per real-world metre, horizontal / vertical.
    pub px_per_m_x: f64,
    pub px_per_m_y: f64,
    /// "vulnona" | "islemaps_light" | "islemaps_dark"
    pub source: String,
    /// Image overlays drawn over the basemap (only those present on disk).
    pub overlays: Vec<OverlayRender>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRender {
    /// Doubles as the layers.* visibility key.
    pub key: &'static str,
    /// Absolute path — the frontend feeds it through convertFileSrc.
    pub path: String,
    /// [left, top, right, bottom] in ACTIVE-calibration basemap px. The
    /// overlay image is stretched over this rect, so its own pixel size is
    /// irrelevant and it stays aligned on every basemap.
    pub bounds_px: [f64; 4],
}

/// Scale constants both windows need for their geometry maths — derived from
/// the ACTIVE calibration in Rust so the frontend holds no transform of its
/// own.
#[tauri::command]
pub fn get_map_info(state: State<AppState>) -> MapInfo {
    let source = state.active_source();
    let cal = source.calibration();
    let mut overlays = Vec::new();
    let freshwater = crate::fetch::freshwater_dest();
    if freshwater.exists() {
        // The overlay is painted in the islemaps frame; re-project its world
        // rect into the active basemap's px space.
        let frame = MapSource::IslemapsLight.calibration();
        let (left, top) = world_to_pixel(frame.min_x * 1000.0, frame.min_y * 1000.0, cal);
        let (right, bottom) = world_to_pixel(frame.max_x * 1000.0, frame.max_y * 1000.0, cal);
        overlays.push(OverlayRender {
            key: "freshwater",
            path: freshwater.to_string_lossy().into_owned(),
            bounds_px: [left, top, right, bottom],
        });
    }
    MapInfo {
        image_width_px: cal.image_width_px,
        image_height_px: cal.image_height_px,
        px_per_m_x: cal.image_width_px as f64 / (cal.span_y() * 10.0),
        px_per_m_y: cal.image_height_px as f64 / (cal.span_x() * 10.0),
        source: source.key().to_string(),
        overlays,
    }
}

/// Start the first-run / re-download data fetch on a worker thread. Progress
/// arrives as `fetch://progress` events, completion as `fetch://finished`.
#[tauri::command]
pub fn fetch_data(app: AppHandle, force: bool) {
    telemetry::counters::track("data_fetch");
    std::thread::spawn(move || {
        crate::fetch::run(&app, force);
    });
}

/// Open the trails folder in Explorer (legacy-compatible path under
/// %APPDATA%\TheIsleOverlay).
#[tauri::command]
pub fn open_trails_folder(app: AppHandle) -> Result<(), String> {
    let dir = settings::trails_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open the IslePilot login window; completion arrives as dino:// events.
/// MUST be async: building a webview window inside a synchronous command is
/// a documented deadlock/blank-window hazard on Windows.
#[tauri::command]
pub async fn islepilot_login(app: AppHandle, domain: String) -> Result<(), String> {
    telemetry::counters::track("islepilot_login");
    crate::islepilot::start_login(&app, domain)
}

#[tauri::command]
pub fn islepilot_cancel_login(app: AppHandle) {
    crate::islepilot::cancel_login(&app);
}

/// Manual fallback: validate + store a pasted Cookie header.
#[tauri::command]
pub async fn islepilot_set_cookie(
    app: AppHandle,
    domain: String,
    cookie: String,
) -> Result<(), String> {
    // Blocking HTTP validation happens off the async runtime's core threads.
    tauri::async_runtime::spawn_blocking(move || {
        crate::islepilot::manual_cookie(&app, domain, cookie)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One-time Steam login against the CENTRAL overlay API (token mode — one
/// login works on every IslePilot server). Async for the same webview-
/// creation deadlock reason as islepilot_login.
#[tauri::command]
pub async fn islepilot_token_login(app: AppHandle) -> Result<(), String> {
    telemetry::counters::track("islepilot_login");
    crate::islepilot::start_token_login(&app)
}

/// Manual fallback for token mode: validate + store a pasted overlay token
/// (or a whole isle-overlay:// redirect URL).
#[tauri::command]
pub async fn islepilot_set_token(app: AppHandle, token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::islepilot::manual_token(&app, token)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// IslePilot POIs (sanctuaries, migration/patrol zones, ...) as render
/// pixels for the full map. Token mode only; cached ~15 s in Rust.
#[tauri::command]
pub async fn islepilot_overlay_map(
    app: AppHandle,
) -> Result<crate::islepilot::OverlayMapRender, String> {
    tauri::async_runtime::spawn_blocking(move || crate::islepilot::overlay_map_render(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// Download-and-cache a skinviewer CDN asset (3D model / texture); returns
/// the local file path for convertFileSrc. Public CDN, no auth — routed
/// through Rust because the CDN sends no CORS headers.
#[tauri::command]
pub async fn islepilot_cdn_asset(app: AppHandle, url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::islepilot::cdn_asset(&app, &url))
        .await
        .map_err(|e| e.to_string())?
}

/// Garage (gacha) listing: parked dinos + server flags. Token mode only.
#[tauri::command]
pub async fn islepilot_garage(
) -> Result<crate::islepilot::api::GarageState, String> {
    tauri::async_runtime::spawn_blocking(crate::islepilot::garage_fetch)
        .await
        .map_err(|e| e.to_string())?
}

/// Park the CURRENT dino into the garage. Blocks through the async-command
/// status poll (up to ~60 s), so the frontend should show a busy state.
#[tauri::command]
pub async fn islepilot_garage_park() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::islepilot::garage_action(
            "/api/overlay/garage/park",
            serde_json::json!({ "step": "start" }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn islepilot_garage_restore(id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::islepilot::garage_action(
            &format!("/api/overlay/garage/{id}/restore"),
            serde_json::json!({}),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn islepilot_garage_sell(id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::islepilot::garage_action(
            &format!("/api/overlay/garage/{id}/sell"),
            serde_json::json!({}),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn islepilot_garage_rename(id: String, name: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::islepilot::garage_action(
            &format!("/api/overlay/garage/{id}/rename"),
            serde_json::json!({ "name": name }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn islepilot_logout(app: AppHandle) -> Result<(), String> {
    crate::islepilot::logout(&app)
}

/// Re-read islepilot settings and (re)start/stop the poller accordingly —
/// the Dino tab calls this after toggling enabled/interval/map-position.
#[tauri::command]
pub fn islepilot_apply(app: AppHandle) {
    crate::islepilot::restart_poller(&app);
}

#[tauri::command]
pub fn islepilot_state(app: AppHandle) -> crate::islepilot::IslepilotState {
    crate::islepilot::current_state(&app)
}

/// Dev-only: feed a fake sample through the real pipeline.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn simulate_position(app: AppHandle, x: f64, y: f64, z: f64) {
    pipeline::ingest_sample(&app, x, y, z);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cal() -> &'static Calibration {
        Calibration::gateway()
    }

    /// The regression this module exists for: zone polygons carry `points`
    /// and NO top-level x/y, and used to be dropped before `points` was read.
    #[test]
    fn polygon_zone_without_xy_still_renders() {
        let item = json!({
            "shape": "polygon",
            "label": "Swamp",
            "points": [[228_100.0, -31_000.0], [361_000.0, -31_000.0],
                       [361_000.0, 141_000.0], [228_100.0, 141_000.0]],
        });
        let out = poi_render_item(&item, "zone", cal()).expect("polygon must survive");
        let pts = out.points_px.expect("points_px");
        assert_eq!(pts.len(), 4);
        // Anchor and label both sit on the vertex centroid (the two are
        // computed either side of the projection, so compare with a tolerance).
        assert!((out.px - out.label_px.unwrap()).abs() < 1e-6);
        assert!((out.py - out.label_py.unwrap()).abs() < 1e-6);
        let (cx, cy) = world_to_pixel(294_550.0, 55_000.0, cal());
        assert!((out.px - cx).abs() < 1e-6 && (out.py - cy).abs() < 1e-6);
        assert!(out.radius_px.is_none());
    }

    #[test]
    fn circle_zone_is_unchanged() {
        let item = json!({
            "shape": "circle", "label": "Tide Beach",
            "x": -37_105.64, "y": 450_363.68, "radius_m": 625.72,
        });
        let out = poi_render_item(&item, "zone", cal()).expect("circle must survive");
        assert_eq!((out.x_cm, out.y_cm), (-37_105.64, 450_363.68));
        assert!(out.radius_px.unwrap() > 0.0);
        assert!(out.points_px.is_none());
        // Circle label sits at the centre.
        assert_eq!((out.label_px, out.label_py), (Some(out.px), Some(out.py)));
    }

    /// Under three vertices is not a polygon; with no x/y there is nothing
    /// left to anchor on, so the item is still skipped.
    #[test]
    fn degenerate_polygon_without_xy_is_skipped() {
        let item = json!({
            "shape": "polygon", "label": "sliver",
            "points": [[0.0, 0.0], [1000.0, 1000.0]],
        });
        assert!(poi_render_item(&item, "zone", cal()).is_none());
    }

    /// Against the real on-disk database, not a fixture: every zone item must
    /// survive into a render item. Before the fix 48 of them silently did not.
    ///
    /// `cargo test -- --ignored real_pois`
    #[test]
    #[ignore = "needs the downloaded pois_gateway.json"]
    fn real_pois_lose_no_zone() {
        let text = std::fs::read_to_string(settings::pois_path()).unwrap();
        let raw: Value = serde_json::from_str(&text).unwrap();
        for (key, layer) in raw["layers"].as_object().unwrap() {
            let kind = layer["kind"].as_str().unwrap();
            if kind != "zone" {
                continue;
            }
            let items = layer["items"].as_array().unwrap();
            let rendered = items
                .iter()
                .filter(|i| poi_render_item(i, kind, cal()).is_some())
                .count();
            assert_eq!(rendered, items.len(), "{key} lost zones");
        }
    }

    #[test]
    fn point_poi_gets_no_zone_label_anchor() {
        let item = json!({ "label": "", "x": 1000.0, "y": 2000.0 });
        let out = poi_render_item(&item, "point", cal()).expect("point must survive");
        assert_eq!((out.label_px, out.label_py), (None, None));
    }
}
