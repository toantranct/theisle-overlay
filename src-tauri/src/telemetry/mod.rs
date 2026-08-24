//! Usage analytics, feedback and crash reporting.
//!
//! Design in three lines:
//!   * one request per app launch, fire-and-forget on a background thread;
//!   * feature usage is counted locally and rides along on that request;
//!   * anything that fails, fails silently — no toast, no retry storm, no
//!     feature gated on the server being reachable.
//!
//! What leaves the machine: a random install id, the app version, the Windows
//! build number, the UI locale, and per-feature use counts. Never the IP (the
//! edge supplies a country code and the address is dropped), never a game
//! position, never a file path that still contains an account name.

pub mod attest;
pub mod client;
pub mod counters;

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::settings;
use crate::state::{AppState, LockExt};

const PING_PATH: &str = "/v1/ping";
const FEEDBACK_PATH: &str = "/v1/feedback";
const CRASH_PATH: &str = "/v1/crash";

/// Let the overlay finish starting before touching the network. The first few
/// seconds after launch are the ones a user actually watches.
const PING_DELAY: Duration = Duration::from_secs(5);
/// How often in-memory counters are flushed to disk. This app is far more
/// likely to be force-killed than closed cleanly (same reason settings.rs
/// debounces its writes), so anything living only in RAM is data we will lose.
const HEARTBEAT: Duration = Duration::from_secs(60);

/// Client-side crash caps. The server aggregates by fingerprint and cannot be
/// flooded into a bad state, but a machine stuck in a crash-retry loop would
/// still eat the daily request budget. These are the cheap guard.
const CRASH_PER_PROCESS: u32 = 3;
const CRASH_PER_DAY: u32 = 10;

static CRASHES_THIS_PROCESS: AtomicU32 = AtomicU32::new(0);

fn client_id_path() -> std::path::PathBuf {
    // LOCALAPPDATA, not the roaming settings file. settings.json lives in
    // %APPDATA%, which settings.rs itself warns may be OneDrive-synced — a
    // synced install id would follow the user to a second machine and quietly
    // merge two installs into one row.
    settings::local_dir().join("client_id.json")
}

fn state_path() -> std::path::PathBuf {
    settings::local_dir().join("telemetry.json")
}

fn pending_crash_path() -> std::path::PathBuf {
    settings::local_dir().join("pending_crash.json")
}

fn crash_quota_path() -> std::path::PathBuf {
    settings::local_dir().join("crash_quota.json")
}

/// Random per-install id, created on first use. Not derived from anything
/// about the machine on purpose: a hardware-derived id would survive a
/// deliberate reset, which is the opposite of what it should do.
pub fn client_id() -> Option<String> {
    let path = client_id_path();
    if let Some(id) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("client_id")?.as_str().map(str::to_owned))
    {
        if !id.is_empty() {
            return Some(id);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    match settings::save_json(&path, &json!({ "client_id": id })) {
        Ok(()) => Some(id),
        Err(e) => {
            log::warn!("telemetry: cannot persist client_id: {e}");
            None
        }
    }
}

/// Counters waiting to be reported, held on disk so a force-kill costs at
/// most one heartbeat interval rather than the whole session.
#[derive(Serialize, Deserialize)]
#[serde(default)]
struct Pending {
    launches: u32,
    features: Vec<u32>,
    /// Length of the CURRENT session, updated by the heartbeat. Read at the
    /// next launch, where it is reported as the previous session's length —
    /// the app is usually killed rather than closed, so there is no reliable
    /// moment at the end of a session to send anything.
    session_minutes: u32,
}

impl Default for Pending {
    fn default() -> Self {
        Self {
            launches: 0,
            features: vec![0; counters::N],
            session_minutes: 0,
        }
    }
}

impl Pending {
    fn load() -> Self {
        let mut p: Self = std::fs::read_to_string(state_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        // A build that added feature slots must not panic on an old file.
        p.features.resize(counters::N, 0);
        p
    }

    fn save(&self) {
        if let Err(e) = settings::save_json(&state_path(), &json!(self)) {
            log::debug!("telemetry: cannot save state: {e}");
        }
    }

    fn absorb(&mut self, drained: [u32; counters::N]) {
        for (slot, add) in self.features.iter_mut().zip(drained) {
            *slot = slot.saturating_add(add);
        }
    }
}

/// The daily crash allowance, in its OWN file.
///
/// It cannot live in `Pending`: the heartbeat thread holds an in-memory copy
/// of that struct and rewrites the whole file every minute, so a quota
/// increment written by a crashing thread would be silently clobbered by the
/// next heartbeat — and the cap that exists to stop a crash loop from eating
/// the request budget would quietly stop capping. Separate file, single
/// writer, no race.
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct CrashQuota {
    day: i64,
    count: u32,
}

impl CrashQuota {
    fn load() -> Self {
        std::fs::read_to_string(crash_quota_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn save(&self) {
        let _ = settings::save_json(&crash_quota_path(), &json!(self));
    }
}

fn utc_day() -> i64 {
    chrono::Utc::now().timestamp() / 86_400
}

pub fn enabled(app: &AppHandle) -> bool {
    let s = app.state::<AppState>();
    let s = s.settings.lock_safe();
    settings::get_bool(&s, &["telemetry", "enabled"], true)
}

/// Windows build, e.g. "10.0.26200".
///
/// Read from the registry rather than `GetVersionEx`, which reports 6.2 for
/// anything newer unless the exe carries a matching compatibility manifest,
/// and rather than shelling out to `ver`, which flashes a console window on a
/// fullscreen overlay.
fn os_build() -> Option<String> {
    use windows::core::w;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    const KEY: windows::core::PCWSTR = w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");

    let dword = |name: windows::core::PCWSTR| -> Option<u32> {
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        // SAFETY: value/size describe a live u32; RegGetValueW only writes
        // into it when it returns ERROR_SUCCESS.
        let rc = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
                name,
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut _),
                Some(&mut size),
            )
        };
        rc.is_ok().then_some(value)
    };

    let mut buf = [0u16; 64];
    let mut size = std::mem::size_of_val(&buf) as u32;
    // SAFETY: buf/size describe a live buffer; the API writes at most `size`
    // bytes and updates `size` to the length actually written.
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            KEY,
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    if rc.is_err() {
        return None;
    }
    let chars = (size as usize / 2).saturating_sub(1);
    let build = String::from_utf16_lossy(&buf[..chars.min(buf.len())]);

    let major = dword(w!("CurrentMajorVersionNumber")).unwrap_or(10);
    let minor = dword(w!("CurrentMinorVersionNumber")).unwrap_or(0);
    Some(format!("{major}.{minor}.{build}"))
}

/// Start the background telemetry thread. Returns immediately; nothing here
/// may ever block startup.
pub fn spawn(app: &AppHandle) {
    if !client::is_configured() {
        log::info!("telemetry: no build key, disabled");
        return;
    }
    if !enabled(app) {
        log::info!("telemetry: disabled in settings");
        return;
    }
    let Some(id) = client_id() else { return };
    let ui_language = {
        let state = app.state::<AppState>();
        let s = state.settings.lock_safe();
        settings::get_str(&s, &["language"], "vi").to_string()
    };

    std::thread::spawn(move || {
        let started = Instant::now();

        let mut pending = Pending::load();
        pending.launches = pending.launches.saturating_add(1);
        let previous_session = std::mem::take(&mut pending.session_minutes);
        // Persist the launch BEFORE the network call. Losing a ping costs one
        // data point; losing the record that we already counted this launch
        // would make the same machine re-report forever.
        pending.save();

        std::thread::sleep(PING_DELAY);
        flush_pending_crash(&id);

        let body = json!({
            "client_id": id,
            "launches": pending.launches,
            "session_minutes": previous_session,
            "os_build": os_build(),
            // The app's own UI language, not the system locale: it is the one
            // we would actually act on when deciding what to translate.
            "locale": ui_language,
            "features": pending.features,
        });
        if client::post(PING_PATH, &body) {
            pending = Pending::default();
            pending.save();
        }

        loop {
            std::thread::sleep(HEARTBEAT);
            pending.absorb(counters::drain());
            pending.session_minutes = (started.elapsed().as_secs() / 60) as u32;
            pending.save();
        }
    });
}

/// How many launches a stored crash report may fail to send before it is
/// dropped. Bounded on purpose: a payload the server always rejects must not
/// retry forever, and a report older than a few launches has lost its value.
const CRASH_FLUSH_ATTEMPTS: u64 = 3;

/// Send a crash recorded by the panic hook of a PREVIOUS run. The hook only
/// writes to disk — a panicking process is the worst possible moment to wait
/// on a network round trip, and it may not survive long enough to finish one.
///
/// The file is kept until the send succeeds. Deleting it up front would be
/// simpler, but the most likely moment for this to fail is a laptop whose
/// network has not come up yet five seconds after login — exactly the crash
/// reports worth keeping.
fn flush_pending_crash(client_id: &str) {
    let path = pending_crash_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut v) = serde_json::from_str::<Value>(&text) else {
        let _ = std::fs::remove_file(&path);
        return;
    };

    let attempts = v.get("attempts").and_then(Value::as_u64).unwrap_or(0) + 1;
    if attempts > CRASH_FLUSH_ATTEMPTS {
        log::debug!("telemetry: giving up on a stored crash report");
        let _ = std::fs::remove_file(&path);
        return;
    }

    let mut body = v.clone();
    body["client_id"] = json!(client_id);
    // `attempts` is local bookkeeping, not payload.
    if let Some(obj) = body.as_object_mut() {
        obj.remove("attempts");
    }

    if client::post(CRASH_PATH, &body) {
        let _ = std::fs::remove_file(&path);
    } else {
        v["attempts"] = json!(attempts);
        let _ = settings::save_json(&path, &v);
    }
}

/// Group crashes that are the same bug. Only the first few stack frames are
/// used: deeper frames vary with timing and would split one bug into dozens.
fn fingerprint(message: &str, stack: &str) -> String {
    let head: Vec<&str> = stack.lines().map(str::trim).filter(|l| !l.is_empty()).take(5).collect();
    let kind = message.split(':').next().unwrap_or(message).trim();
    attest::sha256_hex(format!("{kind}\n{}", head.join("\n")).as_bytes())[..32].to_string()
}

fn record_crash(message: &str, stack: &str, send_now: bool) {
    let mut quota = CrashQuota::load();
    let today = utc_day();
    if quota.day != today {
        quota.day = today;
        quota.count = 0;
    }
    // Short-circuit order matters: when the daily cap is already spent the
    // process counter is left alone, so it still measures this process.
    if quota.count >= CRASH_PER_DAY
        || CRASHES_THIS_PROCESS.fetch_add(1, Ordering::Relaxed) >= CRASH_PER_PROCESS
    {
        return;
    }
    quota.count += 1;
    quota.save();

    // Scrub on this side of the wire. Windows crash text is full of
    // C:\Users\<real name>\ and that must never reach the server at all.
    let payload = json!({
        "message": client::scrub(message),
        "stack": client::scrub(stack),
        "fingerprint": fingerprint(message, stack),
    });

    if send_now {
        if let Some(id) = client_id() {
            let mut body = payload;
            body["client_id"] = json!(id);
            client::post(CRASH_PATH, &body);
            return;
        }
    }
    let _ = settings::save_json(&pending_crash_path(), &payload);
}

/// Install a panic hook that leaves a crash report for the next run to send.
pub fn install_panic_hook() {
    if !client::is_configured() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info.to_string();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        record_crash(&message, &backtrace, false);
        previous(info);
    }));
}

// ------------------------------------------------------------- commands ---

/// Count one use of a feature. Cheap enough to call from any click handler:
/// it is a relaxed atomic increment and nothing else.
#[tauri::command]
pub fn track_feature(app: AppHandle, name: String) {
    if enabled(&app) {
        counters::track(&name);
    }
}

/// Deliberately NOT gated on the telemetry toggle: the user pressed a button
/// labelled "send", which is consent for exactly this one message.
#[tauri::command]
pub fn submit_feedback(
    category: String,
    body: String,
    contact: Option<String>,
) -> Result<(), String> {
    if !client::is_configured() {
        return Err("unavailable".into());
    }
    let Some(id) = client_id() else {
        return Err("unavailable".into());
    };
    let payload = json!({
        "client_id": id,
        "category": category,
        // Users paste log excerpts into feedback boxes, so this gets the same
        // scrub as a crash report.
        "body": client::scrub(body.trim()),
        "contact": contact.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()),
    });
    if client::post(FEEDBACK_PATH, &payload) {
        Ok(())
    } else {
        Err("send_failed".into())
    }
}

/// Report a frontend error. The app is still alive here, so unlike the panic
/// hook this one sends immediately.
#[tauri::command]
pub fn submit_crash(app: AppHandle, message: String, stack: Option<String>) {
    if enabled(&app) {
        record_crash(&message, stack.as_deref().unwrap_or(""), true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The varying part of a panic message (an index, an address, a count) is
    /// dropped: only the text before the first colon is kept, so one bug does
    /// not arrive as a hundred separate rows.
    #[test]
    fn fingerprint_ignores_the_variable_part_of_the_message() {
        let a = fingerprint("panic: index out of bounds: 5", "at draw\nat render\nat main");
        let b = fingerprint("panic: index out of bounds: 9", "at draw\nat render\nat main");
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    /// Only the top frames count. Everything below frame 5 varies with timing
    /// and call depth and would split one bug into dozens.
    #[test]
    fn fingerprint_ignores_frames_below_the_fifth() {
        let top = "at draw\nat render\nat tick\nat loop\nat main";
        let a = fingerprint("panic: overflow", top);
        let b = fingerprint("panic: overflow", &format!("{top}\nat spawn\nat start"));
        assert_eq!(a, b);
    }

    #[test]
    fn fingerprint_separates_different_bugs() {
        assert_ne!(
            fingerprint("panic: overflow", "at draw"),
            fingerprint("io error: not found", "at draw"),
        );
        assert_ne!(
            fingerprint("panic: overflow", "at draw"),
            fingerprint("panic: overflow", "at save"),
        );
    }

    #[test]
    fn pending_resizes_when_slots_are_added() {
        let old = serde_json::json!({ "launches": 2, "features": [1, 2] });
        let mut p: Pending = serde_json::from_value(old).unwrap();
        p.features.resize(counters::N, 0);
        assert_eq!(p.features.len(), counters::N);
        assert_eq!(p.features[1], 2);
    }

    /// End-to-end against a local Worker. Ignored by default because it needs
    /// `wrangler dev` running; this is the only test that proves the Rust
    /// signer and the TypeScript verifier agree on the canonical string, and
    /// a mismatch there shows up in production as a wall of 401s.
    ///
    ///   cd worker && npx wrangler dev
    ///   OV_API_BASE=http://127.0.0.1:8787 OV_TELEMETRY_KEY=<K_ver hex> \
    ///     cargo test --lib live_ping_against_local_worker -- --ignored --nocapture
    #[test]
    #[ignore = "needs a local wrangler dev"]
    fn live_ping_against_local_worker() {
        assert!(client::is_configured(), "set OV_TELEMETRY_KEY");
        let body = json!({
            "client_id": "99999999-8888-4777-8666-555555555555",
            "launches": 1,
            "session_minutes": 7,
            "os_build": os_build(),
            "locale": "vi",
            "features": vec![1u32; counters::N],
        });
        assert!(client::post(PING_PATH, &body), "worker rejected a signed ping");
    }

    #[test]
    fn absorb_accumulates() {
        let mut p = Pending::default();
        let mut d = [0u32; counters::N];
        d[0] = 3;
        p.absorb(d);
        p.absorb(d);
        assert_eq!(p.features[0], 6);
    }
}
