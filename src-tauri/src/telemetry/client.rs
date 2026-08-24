//! HTTP transport for the analytics endpoints.
//!
//! Everything goes out from Rust, never from the webview. The signing key
//! would sit in a plaintext .js file inside the installer if the frontend
//! called the API itself; going through Rust also means no CORS, no preflight
//! (which would double the request count), and no new capability in
//! `capabilities/default.json`.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use super::attest;

/// Embedded endpoint list, tried in order.
///
/// This URL is baked into every shipped binary, so it can never really be
/// retired — old installs would simply stop reporting. Adding a second entry
/// only helps builds that ship with it, which is the argument for putting a
/// custom domain in this list before the user base grows, not after: today a
/// move off workers.dev would strand every copy already installed.
///
/// The release workflow greps this file for the placeholder subdomain marker
/// and refuses to build a telemetry-enabled binary if it finds one — shipping
/// a key with an unset endpoint would mean every ping fails silently, which is
/// the one failure mode this whole design exists to avoid. Do not write that
/// marker anywhere in this file, including in a comment: the grep cannot tell
/// prose from code, and a false hit blocks every release.
const API_BASES: [&str; 1] = ["https://theisle-overlay-api.toantranct1.workers.dev"];

const TIMEOUT: Duration = Duration::from_secs(5);

/// Circuit breaker. After this many consecutive failures the client goes
/// quiet for a day: an overlay that keeps retrying a dead endpoint while the
/// user is in a match is worse than one with no backend at all.
const FAILURES_BEFORE_SILENCE: u32 = 5;
const SILENCE_SECS: u64 = 24 * 60 * 60;

static FAILURES: AtomicU32 = AtomicU32::new(0);
static SILENT_UNTIL: AtomicU64 = AtomicU64::new(0);

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One client for the whole process. A fresh `reqwest::blocking::Client` per
/// call pays for a schannel handshake and a new connection pool every time —
/// roughly 200 ms on Windows, for a request whose entire job is fire and
/// forget.
fn client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .user_agent(concat!("TheIsleOverlay/", env!("CARGO_PKG_VERSION")))
            .timeout(TIMEOUT)
            .connect_timeout(Duration::from_secs(3))
            .gzip(true)
            .pool_max_idle_per_host(2)
            .build()
            .expect("telemetry http client")
    })
}

fn bases() -> Vec<String> {
    #[cfg(debug_assertions)]
    if let Ok(b) = std::env::var("OV_API_BASE") {
        if !b.is_empty() {
            return vec![b];
        }
    }
    API_BASES.iter().map(|s| s.to_string()).collect()
}

pub fn is_configured() -> bool {
    attest::key_hex().is_some()
}

/// POST a signed JSON body. Returns true on a 2xx.
///
/// Never returns an error to the caller's UI path: telemetry failing is not
/// something a user should ever see or wait on.
pub fn post(path: &str, body: &serde_json::Value) -> bool {
    let Some(key) = attest::key_hex() else {
        return false;
    };
    if now_secs() < SILENT_UNTIL.load(Ordering::Relaxed) {
        return false;
    }

    // serde_json, never format!(): feedback bodies and crash stacks are
    // user-controlled, and hand-built JSON is an injection waiting to happen.
    // reqwest's `json` feature is off in this crate by design, so the body is
    // serialized here and the header set by hand.
    let bytes = match serde_json::to_vec(body) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("telemetry: serialize failed: {e}");
            return false;
        }
    };
    let ts = chrono::Utc::now().timestamp();
    let Some(sig) = attest::sign(&key, ts, path, &bytes) else {
        log::warn!("telemetry: bad build key");
        return false;
    };

    for base in bases() {
        let res = client()
            .post(format!("{base}{path}"))
            .header("content-type", "application/json")
            .header("x-ov-ver", env!("CARGO_PKG_VERSION"))
            .header("x-ov-ts", ts.to_string())
            .header("x-ov-sig", &sig)
            .body(bytes.clone())
            .send();
        match res {
            Ok(r) if r.status().is_success() => {
                FAILURES.store(0, Ordering::Relaxed);
                return true;
            }
            Ok(r) => {
                // A 4xx is our bug, not a network problem, and retrying the
                // next base would just repeat it.
                log::debug!("telemetry: {path} -> HTTP {}", r.status());
                if r.status().is_client_error() {
                    return false;
                }
            }
            Err(e) => log::debug!("telemetry: {path} -> {e}"),
        }
    }

    if FAILURES.fetch_add(1, Ordering::Relaxed) + 1 >= FAILURES_BEFORE_SILENCE {
        log::info!("telemetry: endpoint unreachable, going quiet for 24h");
        SILENT_UNTIL.store(now_secs() + SILENCE_SECS, Ordering::Relaxed);
        FAILURES.store(0, Ordering::Relaxed);
    }
    false
}

/// Strip the Windows account name out of a path.
///
/// Done HERE, before the bytes leave the machine — not on the server. A crash
/// log full of `C:\Users\NguyenVanA\...` is someone's real name, and the only
/// place that can be guaranteed never to have left is the machine it came
/// from.
pub fn scrub(text: &str) -> String {
    use std::sync::LazyLock;
    static USER_PATH: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"(?i)[a-z]:[\\/]users[\\/][^\\/:*?"<>|\r\n]+"#).expect("user path re")
    });
    let mut out = USER_PATH.replace_all(text, "%USERPROFILE%").into_owned();

    // Second pass: the account name also turns up outside a path (window
    // titles, Steam paths on another drive, error text that interpolated it).
    if let Ok(name) = std::env::var("USERNAME") {
        if name.len() >= 3 {
            out = out.replace(&name, "%USERNAME%");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_removes_account_name() {
        assert_eq!(
            scrub(r"at C:\Users\NguyenVanA\AppData\Local\TheIsleOverlay\x.json"),
            r"at %USERPROFILE%\AppData\Local\TheIsleOverlay\x.json"
        );
        assert_eq!(
            scrub("D:/Users/bob/game.log"),
            "%USERPROFILE%/game.log"
        );
        assert_eq!(
            scrub(r"c:\users\Tester\a and C:\Users\Tester\b"),
            r"%USERPROFILE%\a and %USERPROFILE%\b"
        );
    }

    #[test]
    fn scrub_leaves_ordinary_text_alone() {
        let s = "panic: index out of bounds at overlay::minimap::draw";
        assert_eq!(scrub(s), s);
        assert_eq!(scrub(r"C:\Program Files\TheIsle"), r"C:\Program Files\TheIsle");
    }
}
