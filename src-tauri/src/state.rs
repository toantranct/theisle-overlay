//! Shared application state and the debounced settings writer.

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use overlay_core::{Calibration, MapSource, PositionTracker, TrailConfig};
use serde_json::Value;

use crate::hotkeys::HotkeyManager;
use crate::settings;
use crate::store::{self, TrailWriter, Waypoint};

/// Poison-tolerant lock. Every mutex in this app guards a plain value with no
/// cross-field invariant held across a panic point, so recovering the inner
/// value after a poisoning panic risks at worst one lost sample — while a
/// propagated poison would brick the clipboard poller, the supervisor, and
/// the hotkey thread all at once.
pub trait LockExt<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> LockExt<T> for std::sync::Mutex<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T> {
        self.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub struct AppState {
    pub hotkeys: HotkeyManager,
    pub settings: Mutex<Value>,
    pub tracker: Mutex<PositionTracker>,
    /// None when the trail is disabled in settings.
    pub trail_writer: Mutex<Option<TrailWriter>>,
    pub waypoints: Mutex<Vec<Waypoint>>,
    /// The most recent trail file from a PREVIOUS session, captured at startup
    /// before this session writes anything. Mutex<Option>: the clear-trail
    /// action `take()`s it so the dimmed previous trail stays hidden for the
    /// rest of the session (the file itself is untouched).
    pub previous_trail_path: Mutex<Option<PathBuf>>,
    /// Last `get_pois_render` result; see the cache's own doc for the key.
    pub pois_cache: Mutex<Option<crate::commands::PoisCache>>,
    started: Instant,
    save_debouncer: SettingsDebouncer,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        let settings = settings::load_settings();
        let trail_config = TrailConfig {
            enabled: settings::get_bool(&settings, &["trail", "enabled"], true),
            break_after_s: settings::get_f64(&settings, &["trail", "break_after_minutes"], 15.0)
                * 60.0,
            break_after_m: settings::get_f64(&settings, &["trail", "break_after_metres"], 200.0),
            min_node_m: settings::get_f64(&settings, &["trail", "min_node_distance_m"], 5.0),
        };
        let writer = trail_config.enabled.then(TrailWriter::new);
        Self {
            hotkeys: HotkeyManager::new(),
            // Deliberately PINNED to Vulnona, not the selected basemap: the
            // tracker's calibration feeds only bearing_deg's north_offset_deg
            // (0.0 for every current source); trails are stored cm-only and
            // px is derived at emit time with the ACTIVE calibration. If a
            // future source ever ships north_offset_deg != 0, the tracker
            // must resolve its calibration per call instead — recreating the
            // tracker on a basemap switch would drop live trail segments.
            tracker: Mutex::new(PositionTracker::new(
                Calibration::gateway().clone(),
                trail_config,
            )),
            trail_writer: Mutex::new(writer),
            waypoints: Mutex::new(store::load_waypoints()),
            previous_trail_path: Mutex::new(store::latest_trail_path()),
            pois_cache: Mutex::new(None),
            settings: Mutex::new(settings),
            started: Instant::now(),
            save_debouncer: SettingsDebouncer::new(),
        }
    }

    /// Monotonic seconds since app start — the sample clock.
    pub fn now_s(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    /// The basemap imagery the settings currently select. The settings guard
    /// drops at the end of the expression — never held across other locks.
    pub fn active_source(&self) -> MapSource {
        settings::active_source(&self.settings.lock_safe())
    }

    /// Calibration frame of the selected basemap. `&'static` because every
    /// source's calibration is embedded at compile time.
    pub fn active_calibration(&self) -> &'static Calibration {
        self.active_source().calibration()
    }

    /// Queue a debounced settings save (1.2 s after the last change, not at
    /// exit — an overlay running beside a game is more likely to be
    /// force-killed than closed cleanly).
    pub fn request_settings_save(&self) {
        let snapshot = self.settings.lock_safe().clone();
        self.save_debouncer.request(snapshot);
    }
}

struct SettingsDebouncer {
    tx: mpsc::Sender<Value>,
}

impl SettingsDebouncer {
    fn new() -> Self {
        let (tx, rx) = mpsc::channel::<Value>();
        std::thread::spawn(move || {
            let mut pending: Option<Value> = None;
            loop {
                let received = match &pending {
                    Some(_) => match rx.recv_timeout(Duration::from_millis(1200)) {
                        Ok(v) => Some(v),
                        Err(RecvTimeoutError::Timeout) => {
                            if let Some(v) = pending.take() {
                                if let Err(e) = settings::save_settings(&v) {
                                    log::warn!("settings save failed: {e}");
                                }
                            }
                            continue;
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                    },
                    None => match rx.recv() {
                        Ok(v) => Some(v),
                        Err(_) => break,
                    },
                };
                pending = received;
            }
            // Channel gone (app shutting down): flush what is pending.
            if let Some(v) = pending {
                let _ = settings::save_settings(&v);
            }
        });
        Self { tx }
    }

    fn request(&self, snapshot: Value) {
        let _ = self.tx.send(snapshot);
    }
}
