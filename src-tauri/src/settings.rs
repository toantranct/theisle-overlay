//! Paths and user settings. Port of `app/config.py`.
//!
//! Storage-location rule (important): everything HEAVY or CONSTANTLY CHANGING
//! lives outside any OneDrive-synced folder:
//!
//! ```text
//! %APPDATA%\TheIsleOverlay\        settings, waypoints, trails  (small -> roaming)
//! %LOCALAPPDATA%\TheIsleOverlay\   basemap images, download cache, generated POI data
//! ```
//!
//! Paths and file formats are IDENTICAL to the original Python app so an
//! existing user's settings, waypoints, trails, and downloaded basemap carry
//! over with zero migration.

use std::path::PathBuf;

use serde_json::{json, Value};

pub const APP_DIR_NAME: &str = "TheIsleOverlay";
pub const GAME_PROCESS_NAME: &str = "TheIsleClient-Win64-Shipping.exe";

fn env_dir(var: &str) -> PathBuf {
    std::env::var_os(var)
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn roaming_dir() -> PathBuf {
    env_dir("APPDATA").join(APP_DIR_NAME)
}

pub fn local_dir() -> PathBuf {
    env_dir("LOCALAPPDATA").join(APP_DIR_NAME)
}

pub fn cache_dir() -> PathBuf {
    local_dir().join("cache")
}

pub fn basemap_dir() -> PathBuf {
    local_dir().join("basemap")
}

/// On-demand islemaps.com imagery (light.png / dark.png / meta.json). Not in
/// `ensure_dirs` — the downloader creates it when the user first selects one.
pub fn islemaps_dir() -> PathBuf {
    basemap_dir().join("islemaps")
}

pub fn trails_dir() -> PathBuf {
    roaming_dir().join("trails")
}

pub fn settings_path() -> PathBuf {
    roaming_dir().join("settings.json")
}

pub fn waypoints_path() -> PathBuf {
    roaming_dir().join("waypoints.json")
}

pub fn pois_path() -> PathBuf {
    local_dir().join("pois_gateway.json")
}

pub fn sources_path() -> PathBuf {
    local_dir().join("sources.json")
}

pub fn game_config_path() -> PathBuf {
    env_dir("LOCALAPPDATA")
        .join("TheIsle")
        .join("Saved")
        .join("Config")
        .join("WindowsClient")
        .join("GameUserSettings.ini")
}

pub fn ensure_dirs() -> std::io::Result<()> {
    for d in [
        roaming_dir(),
        local_dir(),
        cache_dir(),
        basemap_dir(),
        trails_dir(),
    ] {
        std::fs::create_dir_all(d)?;
    }
    Ok(())
}

/// Default settings — field-for-field the DEFAULT_SETTINGS dict from
/// config.py, plus `language` (new: bilingual UI). The old code disagreed with
/// itself about the default corner ("top-left" in config.py, "top-right" as
/// main.py's fallback); "top-left" is canonical now.
pub fn default_settings() -> Value {
    json!({
        "minimap": {
            "visible": true,
            "require_game": true,        // auto-hide unless the game is running AND focused
            "corner": "top-left",        // top-left | top-right | bottom-left | bottom-right
            "size_px": 260,
            "margin_px": 16,
            "opacity": 0.85,             // 0.25 - 1.0
            "radius_m": 600,             // real-world radius shown around the player
            "click_through": true,
            "show_trail": true,          // trail lines on the minimap disc
            "show_waypoints": true,      // waypoint dots + nearest-waypoint arrow
        },
        "hotkeys": {
            "toggle_minimap": "Ctrl+Alt+M",
            "toggle_fullmap": "Ctrl+Alt+F",
            "toggle_click_through": "Ctrl+Alt+C",
            "mark_here": "Ctrl+Alt+B",
            "opacity_up": "Ctrl+Alt+Up",
            "opacity_down": "Ctrl+Alt+Down",
            "zoom_in": "Ctrl+Alt+Right",
            "zoom_out": "Ctrl+Alt+Left",
            "toggle_quests": "Ctrl+Alt+Q",
            "reload_ui": "Ctrl+Alt+R",   // rescue: works even when clicks are dead
        },
        // The map starts CLEAN: only the big region-name labels are on, so a
        // first look reads as a map, not a poi soup. Everything else is one
        // click away in the layer panel (and per-user choices persist).
        "layers": {
            "water": false,
            "sanctuary": false,
            "migration": false,
            "saltlick": false,
            "mudwallow": false,
            "food": false,
            "patrol": false,
            "region": true,              // big area-name labels
            "landmark": false,
            "animal": false,             // islemaps.com AI spawn sightings
            "freshwater": false,         // islemaps.com fresh-water overlay
            "islepilot": false,          // live server POIs (token mode only)
        },
        "map": {
            "zone_labels": true,         // names inside zone outlines
            "basemap": "vulnona",        // vulnona | islemaps_light | islemaps_dark
        },
        "trail": {
            "enabled": true,
            "break_after_minutes": 15,
            "break_after_metres": 200,
            "min_node_distance_m": 5,
        },
        // Anonymous usage counts + crash reports. No IP is stored (the
        // edge supplies a country code and the address is dropped), no game
        // position ever leaves the machine, and Windows account names are
        // stripped from crash text before it is sent.
        "telemetry": {
            "enabled": true,
        },
        "number_format": "auto",         // auto | us | eu
        "language": "vi",                // vi | en
        // "Your dino" — IslePilot server-panel integration.
        "islepilot": {
            "enabled": false,
            "auth_mode": "legacy",       // token (one login, every server) | legacy (per-server cookie)
            "domain": "https://mixi.islepilot.eu",
            "poll_interval_s": 10,
            "use_map_position": false,   // auto-managed: on when the server has a live map
            "map_pref_user_set": false,  // true once the USER touches the toggle — stops auto-on
            "show_overlay_panel": true,  // compact stats under the minimap
            "show_quests_panel": false,  // Prime quest list under the stats strip
        },
        "poll": {
            "clipboard_ms": 400,
            "game_rect_ms": 1000,
            "topmost_ms": 2000,
        },
    })
}

/// Nested merge, values in `over` win — lets new options be added to an old
/// settings file without losing the user's choices.
pub fn merge(base: &Value, over: &Value) -> Value {
    match (base, over) {
        (Value::Object(b), Value::Object(o)) => {
            let mut out = b.clone();
            for (k, v) in o {
                let merged = match out.get(k) {
                    Some(existing) => merge(existing, v),
                    None => v.clone(),
                };
                out.insert(k.clone(), merged);
            }
            Value::Object(out)
        }
        _ => over.clone(),
    }
}

/// Load settings. A corrupt or missing file must never stop the app from
/// starting.
pub fn load_settings() -> Value {
    let loaded = std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    match loaded {
        Some(over @ Value::Object(_)) => merge(&default_settings(), &over),
        _ => default_settings(),
    }
}

/// Atomic write: write to a temp file then rename over, so a power cut cannot
/// leave a truncated file.
pub fn save_json(path: &std::path::Path, data: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, serde_json::to_string_pretty(data)?)?;
    std::fs::rename(&tmp, path)
}

pub fn save_settings(settings: &Value) -> std::io::Result<()> {
    save_json(&settings_path(), settings)
}

/// Read FullscreenMode from the game's config.
///
/// 0 = exclusive fullscreen (the overlay CANNOT draw on top)
/// 1 = borderless fullscreen (fine)
/// 2 = windowed              (fine)
///
/// Reads exactly the `FullscreenMode` key, NOT `PreferredFullscreenMode` —
/// the two usually differ and reading the wrong one raises a false alarm.
pub fn read_game_fullscreen_mode() -> Option<i32> {
    let text = std::fs::read_to_string(game_config_path()).ok()?;
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            if key.trim() == "FullscreenMode" {
                return value.trim().parse().ok();
            }
        }
    }
    None
}

/// The basemap imagery the settings select. Lenient: junk or missing values
/// fall back to Vulnona, the imagery guaranteed to exist after first run.
pub fn active_source(settings: &Value) -> overlay_core::MapSource {
    overlay_core::MapSource::from_key(get_str(settings, &["map", "basemap"], "vulnona"))
}

// -- typed accessors into the settings Value --------------------------------

/// Walk a nested key path. `None` when any step is missing — which is also
/// how callers tell "absent" from "present but false", the distinction a
/// patch inspection depends on.
pub fn get_path<'a>(settings: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = settings;
    for key in path {
        cur = cur.get(key)?;
    }
    Some(cur)
}

pub fn get_f64(settings: &Value, path: &[&str], default: f64) -> f64 {
    get_path(settings, path).and_then(Value::as_f64).unwrap_or(default)
}

pub fn get_bool(settings: &Value, path: &[&str], default: bool) -> bool {
    get_path(settings, path).and_then(Value::as_bool).unwrap_or(default)
}

pub fn get_str<'a>(settings: &'a Value, path: &[&str], default: &'a str) -> &'a str {
    get_path(settings, path).and_then(Value::as_str).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_user_choices_and_adds_new_defaults() {
        let base = json!({"a": {"x": 1, "y": 2}, "b": 3});
        let over = json!({"a": {"x": 9}});
        let merged = merge(&base, &over);
        assert_eq!(merged["a"]["x"], 9);
        assert_eq!(merged["a"]["y"], 2);
        assert_eq!(merged["b"], 3);
    }

    #[test]
    fn merge_real_legacy_settings_loses_nothing() {
        // A realistic settings.json written by the old Python app.
        let legacy = json!({
            "minimap": {"corner": "bottom-right", "opacity": 0.5},
            "hotkeys": {"toggle_minimap": "Ctrl+Shift+M"},
            "layers": {"food": true},
            "number_format": "eu",
        });
        let merged = merge(&default_settings(), &legacy);
        assert_eq!(merged["minimap"]["corner"], "bottom-right");
        assert_eq!(merged["minimap"]["opacity"], 0.5);
        assert_eq!(merged["minimap"]["size_px"], 260, "defaults still present");
        assert_eq!(merged["minimap"]["require_game"], true, "new key gets its default");
        assert_eq!(merged["hotkeys"]["toggle_minimap"], "Ctrl+Shift+M");
        assert_eq!(merged["hotkeys"]["toggle_fullmap"], "Ctrl+Alt+F");
        assert_eq!(merged["layers"]["food"], true);
        assert_eq!(merged["number_format"], "eu");
        assert_eq!(merged["language"], "vi", "new key gets its default");
        assert_eq!(merged["map"]["basemap"], "vulnona", "new key gets its default");
        assert_eq!(
            active_source(&merged),
            overlay_core::MapSource::Vulnona,
            "legacy settings resolve to the default imagery"
        );
    }
}
