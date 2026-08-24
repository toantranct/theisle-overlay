//! Global hotkeys via RegisterHotKey. Port of `app/hotkeys.py`.
//!
//! Why RegisterHotKey and not SetWindowsHookEx(WH_KEYBOARD_LL): low-level
//! keyboard hooks are exactly what anti-cheat systems watch for (AutoHotkey
//! has been flagged over this). RegisterHotKey only registers with the window
//! manager — no hooks, no touching other processes. Windows posts WM_HOTKEY
//! straight to the registering THREAD's queue.
//!
//! And absolutely never SEND keys to the game — reading the user's presses is
//! normal, injecting keys into the game is cheating.
//!
//! A dedicated thread holds the GetMessageW loop and idles at 0% CPU.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    MOD_SHIFT, MOD_WIN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_HOTKEY, WM_QUIT, WM_USER,
};

use crate::commands::apply_settings_patch;
use crate::settings;
use crate::state::{AppState, LockExt};
use crate::store;

const OPACITY_MIN: f64 = 0.25;
const OPACITY_MAX: f64 = 1.0;
const OPACITY_STEP: f64 = 0.1;
const RADIUS_MIN_M: f64 = 150.0;
const RADIUS_MAX_M: f64 = 3000.0;
const RADIUS_STEP: f64 = 1.35;

/// "Ctrl+Alt+M" -> (modifier flags, virtual key). None when not understood.
/// At least one modifier is REQUIRED so a hotkey cannot steal a bare game key.
pub fn parse_hotkey(spec: &str) -> Option<(u32, u32)> {
    let mut mods: u32 = 0;
    let mut vk: Option<u32> = None;
    for part in spec.split('+') {
        let token = part.trim().to_lowercase();
        if token.is_empty() {
            continue;
        }
        match token.as_str() {
            "ctrl" | "control" => mods |= MOD_CONTROL.0,
            "alt" => mods |= MOD_ALT.0,
            "shift" => mods |= MOD_SHIFT.0,
            "win" | "meta" => mods |= MOD_WIN.0,
            "left" => vk = Some(0x25),
            "up" => vk = Some(0x26),
            "right" => vk = Some(0x27),
            "down" => vk = Some(0x28),
            "space" => vk = Some(0x20),
            "tab" => vk = Some(0x09),
            "enter" | "return" => vk = Some(0x0D),
            "insert" => vk = Some(0x2D),
            "delete" => vk = Some(0x2E),
            "home" => vk = Some(0x24),
            "end" => vk = Some(0x23),
            "pageup" => vk = Some(0x21),
            "pagedown" => vk = Some(0x22),
            "plus" => vk = Some(0xBB),
            "minus" => vk = Some(0xBD),
            t if t.chars().count() == 1 => {
                vk = Some(t.chars().next().unwrap().to_ascii_uppercase() as u32);
            }
            t if t.starts_with('f') && t[1..].chars().all(|c| c.is_ascii_digit()) => {
                if let Ok(n) = t[1..].parse::<u32>() {
                    if (1..=24).contains(&n) {
                        vk = Some(0x70 + n - 1);
                    }
                }
            }
            _ => {}
        }
    }
    // MOD_NOREPEAT is mandatory: without it a held key floods the queue.
    match (vk, mods) {
        (Some(vk), m) if m != 0 => Some((m | MOD_NOREPEAT.0, vk)),
        _ => None,
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedHotkey {
    pub action: String,
    pub spec: String,
}

/// Restartable so the Settings screen can rebind live.
pub struct HotkeyManager {
    thread: Mutex<Option<HotkeyThread>>,
}

/// The join handle matters as much as the id: `stop()` must WAIT for the old
/// thread to unregister its keys, or the next `restart()` races it and every
/// RegisterHotKey fails with "already registered".
struct HotkeyThread {
    thread_id: u32,
    handle: std::thread::JoinHandle<()>,
}

impl Default for HotkeyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl HotkeyManager {
    pub fn new() -> Self {
        Self {
            thread: Mutex::new(None),
        }
    }

    /// (Re)register everything from the current settings. Failures are
    /// aggregated into ONE `hotkey://failed` event (the old app popped a
    /// single QMessageBox for the same reason).
    pub fn restart(&self, app: AppHandle) {
        self.stop();
        let bindings: Vec<(String, String)> = {
            let state = app.state::<AppState>();
            let s = state.settings.lock_safe();
            s.get("hotkeys")
                .and_then(|h| h.as_object())
                .map(|h| {
                    h.iter()
                        .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                        .collect()
                })
                .unwrap_or_default()
        };

        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<u32>();
        let thread_app = app.clone();
        let handle = std::thread::spawn(move || {
            // Force-create this thread's message queue BEFORE announcing the
            // thread id: a WM_QUIT posted to a queueless thread is silently
            // LOST, which used to orphan the thread together with every
            // hotkey it had registered — hotkeys dead until the process died.
            let mut msg = MSG::default();
            unsafe {
                let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
            }
            let thread_id = unsafe { GetCurrentThreadId() };
            let _ = ready_tx.send(thread_id);

            let mut registered: Vec<(i32, String)> = Vec::new();
            let mut failed: Vec<FailedHotkey> = Vec::new();
            for (index, (action, spec)) in bindings.iter().enumerate() {
                let id = index as i32 + 1;
                match parse_hotkey(spec) {
                    Some((mods, vk)) => unsafe {
                        // One retry: right after a rebind the OS may not have
                        // finished releasing the previous registration.
                        let mut ok = RegisterHotKey(None, id, HOT_KEY_MODIFIERS(mods), vk).is_ok();
                        if !ok {
                            std::thread::sleep(Duration::from_millis(100));
                            ok = RegisterHotKey(None, id, HOT_KEY_MODIFIERS(mods), vk).is_ok();
                        }
                        if ok {
                            registered.push((id, action.clone()));
                        } else {
                            // Usually another app holds this combination.
                            failed.push(FailedHotkey {
                                action: action.clone(),
                                spec: spec.clone(),
                            });
                        }
                    },
                    None => failed.push(FailedHotkey {
                        action: action.clone(),
                        spec: spec.clone(),
                    }),
                }
            }
            if !failed.is_empty() {
                let _ = thread_app.emit("hotkey://failed", failed);
            }

            // Actions run on a worker thread: dispatch can block (tauri
            // window calls), and a blocked pump would stop processing
            // WM_HOTKEY *and* WM_QUIT — the "every hotkey dead" state. The
            // worker exits when the pump drops the sender.
            let (work_tx, work_rx) = std::sync::mpsc::channel::<String>();
            let worker_app = thread_app.clone();
            std::thread::spawn(move || {
                // WM_HOTKEY auto-repeats while the keys stay held. For a
                // toggle that means fire-twice = toggle right back (field
                // report: "the minimap unticked itself"). Repeats only make
                // sense for the stepped actions, so everything else gets a
                // sliding debounce: held keys fire once, not per repeat.
                const DEBOUNCE_MS: u128 = 350;
                const REPEATABLE: [&str; 4] =
                    ["opacity_up", "opacity_down", "zoom_in", "zoom_out"];
                let mut last: Option<(String, Instant)> = None;
                while let Ok(action) = work_rx.recv() {
                    let is_repeat = !REPEATABLE.contains(&action.as_str())
                        && last.as_ref().is_some_and(|(prev, at)| {
                            *prev == action && at.elapsed().as_millis() < DEBOUNCE_MS
                        });
                    last = Some((action.clone(), Instant::now()));
                    if !is_repeat {
                        dispatch(&worker_app, &action);
                    }
                }
            });

            unsafe {
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    if msg.message == WM_HOTKEY {
                        let id = msg.wParam.0 as i32;
                        if let Some((_, action)) =
                            registered.iter().find(|(rid, _)| *rid == id)
                        {
                            let _ = work_tx.send(action.clone());
                        }
                    }
                }
                for (id, _) in &registered {
                    let _ = UnregisterHotKey(None, *id);
                }
            }
        });

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(thread_id) => {
                *self.thread.lock_safe() = Some(HotkeyThread { thread_id, handle });
            }
            // Queue-then-send ordering makes this practically unreachable; a
            // thread we cannot signal must not be tracked as the live one.
            Err(_) => log::error!("hotkey thread did not report ready"),
        }
    }

    pub fn stop(&self) {
        let Some(t) = self.thread.lock_safe().take() else {
            return;
        };
        unsafe {
            let _ = PostThreadMessageW(t.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        // Wait for the old thread to unregister its keys — registering the
        // new bindings while it still holds them fails every one of them.
        let deadline = Instant::now() + Duration::from_secs(2);
        while !t.handle.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if t.handle.is_finished() {
            let _ = t.handle.join();
        } else {
            log::error!("hotkey thread did not exit within 2s; its keys may stay held");
        }
    }
}

/// A hotkey action. Everything routes through the settings patch path so
/// every window (and the debounced save) reacts the same way regardless of
/// whether the change came from a hotkey or the Settings screen.
fn dispatch(app: &AppHandle, action: &str) {
    log::info!("hotkey: {action}");
    // Counted here rather than at each call site so the hotkey and the UI
    // path to the same action stay one number.
    crate::telemetry::counters::track("hotkey_used");
    match action {
        "toggle_minimap" => toggle_setting(app, "visible"),
        "toggle_click_through" => toggle_setting(app, "click_through"),
        // Lives under "islepilot", not "minimap", so toggle_setting can't
        // serve it. Default false must match settings.rs.
        "toggle_quests" => {
            let current = {
                let state = app.state::<AppState>();
                let s = state.settings.lock_safe();
                settings::get_bool(&s, &["islepilot", "show_quests_panel"], false)
            };
            apply_settings_patch(
                app,
                serde_json::json!({ "islepilot": { "show_quests_panel": !current } }),
            );
        }
        "toggle_fullmap" => match app.get_webview_window("main") {
            Some(window) => {
                // A minimized window reports visible == true, and so does one
                // buried BEHIND a borderless game — in both cases the user
                // cannot see it, so for them the hotkey means "bring it up".
                // Only a window the user is actually looking at (foreground)
                // gets hidden; same reasoning as the minimap's main_in_front
                // check. Registry reads, never the blocking tauri getters,
                // on this thread.
                let on_screen = crate::win::vis::is_visible("main").unwrap_or(false)
                    && !crate::win::vis::is_minimized("main").unwrap_or(false)
                    && crate::win::vis::is_foreground("main");
                if on_screen {
                    log::info!("main window: hide (hotkey)");
                    let _ = window.hide();
                    crate::webview_mem::on_hidden(&window);
                } else {
                    crate::tray::show_main(app);
                    // The hotkey means "show me the MAP": mid-game the user
                    // wants the map, not whichever tab was left open. Only
                    // this hotkey path switches — tray/second-instance keep
                    // the current tab.
                    crate::events::emit_all(app, "fullmap://show", ());
                }
            }
            None => {
                // The user closed it with the X button — recreate it from
                // the same config it was born with.
                if let Some(config) = app.config().app.windows.first().cloned() {
                    match tauri::WebviewWindowBuilder::from_config(app, &config) {
                        Ok(builder) => match builder.build() {
                            Ok(window) => {
                                if let Ok(hwnd) = window.hwnd() {
                                    crate::win::vis::register("main", hwnd.0 as isize);
                                }
                                let _ = window.set_focus();
                                // Freshly recreated webview may not have its
                                // listeners up yet — best effort only.
                                crate::events::emit_all(app, "fullmap://show", ());
                            }
                            Err(e) => log::warn!("recreating main window failed: {e}"),
                        },
                        Err(e) => log::warn!("main window config invalid: {e}"),
                    }
                }
            }
        },
        "mark_here" => mark_here(app),
        // Rescue for any webview whose input died: a global hotkey needs no
        // clicks, and a reload rebuilds the page (state comes back through
        // get_current_position/resync).
        "reload_ui" => {
            for label in ["main", "minimap"] {
                if let Some(window) = app.get_webview_window(label) {
                    crate::webview_mem::on_shown(&window);
                    let _ = window.eval("location.reload()");
                }
            }
            log::info!("UI reloaded by hotkey");
        }
        "opacity_up" => adjust_opacity(app, OPACITY_STEP),
        "opacity_down" => adjust_opacity(app, -OPACITY_STEP),
        "zoom_in" => adjust_radius(app, 1.0 / RADIUS_STEP),
        "zoom_out" => adjust_radius(app, RADIUS_STEP),
        _ => {}
    }
}

fn toggle_setting(app: &AppHandle, key: &str) {
    let current = {
        let state = app.state::<AppState>();
        let s = state.settings.lock_safe();
        settings::get_bool(&s, &["minimap", key], true)
    };
    apply_settings_patch(app, serde_json::json!({ "minimap": { key: !current } }));
}

fn adjust_opacity(app: &AppHandle, delta: f64) {
    let current = {
        let state = app.state::<AppState>();
        let s = state.settings.lock_safe();
        settings::get_f64(&s, &["minimap", "opacity"], 0.85)
    };
    let next = ((current + delta).clamp(OPACITY_MIN, OPACITY_MAX) * 100.0).round() / 100.0;
    apply_settings_patch(app, serde_json::json!({ "minimap": { "opacity": next } }));
}

fn adjust_radius(app: &AppHandle, factor: f64) {
    let current = {
        let state = app.state::<AppState>();
        let s = state.settings.lock_safe();
        settings::get_f64(&s, &["minimap", "radius_m"], 600.0)
    };
    let next = (current * factor).clamp(RADIUS_MIN_M, RADIUS_MAX_M).round();
    apply_settings_patch(app, serde_json::json!({ "minimap": { "radius_m": next } }));
}

/// Drop a waypoint at the current position. The waypoint NAME is data (it is
/// stored in the user's file), so it is localised at creation time.
fn mark_here(app: &AppHandle) {
    let state = app.state::<AppState>();
    let current = {
        let tracker = state.tracker.lock_safe();
        tracker.current
    };
    let Some(current) = current else { return };
    let name = {
        let s = state.settings.lock_safe();
        match settings::get_str(&s, &["language"], "vi") {
            "en" => "My position",
            _ => "Vị trí của tôi",
        }
    };
    let wp = store::new_waypoint(name, current.x, current.y, current.z, None);
    {
        let mut waypoints = state.waypoints.lock_safe();
        waypoints.push(wp);
        if let Err(e) = store::save_waypoints(&waypoints) {
            log::warn!("saving waypoints failed: {e}");
        }
    }
    crate::events::emit_all(app, "waypoints://changed", ());
}

#[cfg(test)]
mod tests {
    use super::parse_hotkey;

    #[test]
    fn parses_the_default_table() {
        // (mods | MOD_NOREPEAT, vk)
        assert_eq!(parse_hotkey("Ctrl+Alt+M"), Some((0x2 | 0x1 | 0x4000, b'M' as u32)));
        assert_eq!(parse_hotkey("Ctrl+Alt+Up"), Some((0x2 | 0x1 | 0x4000, 0x26)));
        assert_eq!(parse_hotkey("Ctrl+Shift+F5"), Some((0x2 | 0x4 | 0x4000, 0x74)));
        assert_eq!(parse_hotkey("Win+Plus"), Some((0x8 | 0x4000, 0xBB)));
    }

    #[test]
    fn requires_a_modifier() {
        assert_eq!(parse_hotkey("M"), None, "bare keys would steal game input");
        assert_eq!(parse_hotkey("F5"), None);
    }

    #[test]
    fn rejects_nonsense() {
        assert_eq!(parse_hotkey(""), None);
        assert_eq!(parse_hotkey("Ctrl+"), None);
        assert_eq!(parse_hotkey("Ctrl+NotAKey"), None);
        assert_eq!(parse_hotkey("F99+Ctrl"), None);
    }
}
