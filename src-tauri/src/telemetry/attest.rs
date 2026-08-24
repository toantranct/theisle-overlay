//! Request signing.
//!
//! WHAT THIS IS NOT: authentication. The key sits inside a binary on the
//! user's own machine, so anyone willing to open a disassembler has it. Never
//! put something valuable behind a signature check.
//!
//! WHAT IT IS: a filter that stops drive-by curl and scripted floods before
//! they reach the database, and — because the key is derived per app version
//! (`K_ver = HKDF(MASTER, info="app:<semver>")`, done in CI, master never
//! ships) — a credential that can be revoked one release at a time.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Per-version key, hex, injected at build time by the release workflow.
/// `option_env!` rather than `env!` so a local `cargo build` with no secret
/// still compiles; telemetry simply stays off in that build.
const BUILD_KEY: Option<&str> = option_env!("TELEMETRY_KEY");

pub fn key_hex() -> Option<String> {
    // Debug builds can point at a local Worker without a rebuild.
    #[cfg(debug_assertions)]
    if let Ok(k) = std::env::var("OV_TELEMETRY_KEY") {
        if !k.is_empty() {
            return Some(k);
        }
    }
    BUILD_KEY.filter(|k| !k.is_empty()).map(str::to_owned)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

/// The exact string both sides sign. `worker/src/attest.ts` builds the same
/// one; if these ever diverge every request 401s, so the format is pinned by
/// `canonical_format_is_pinned` below.
pub fn canonical(ts: i64, path: &str, body_hash: &str) -> String {
    format!("{ts}\n{path}\n{body_hash}")
}

pub fn sign(key_hex: &str, ts: i64, path: &str, body: &[u8]) -> Option<String> {
    let key = unhex(key_hex)?;
    let mut mac = HmacSha256::new_from_slice(&key).ok()?;
    mac.update(canonical(ts, path, &sha256_hex(body)).as_bytes());
    Some(hex(&mac.finalize().into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_format_is_pinned() {
        assert_eq!(canonical(1700000000, "/v1/ping", "abc"), "1700000000\n/v1/ping\nabc");
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// RFC 4231 test case 1. Guards the HMAC construction itself, so a broken
    /// crate upgrade fails here rather than as a wall of 401s in production.
    #[test]
    fn hmac_matches_rfc4231() {
        let key = "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b";
        let mut mac = HmacSha256::new_from_slice(&unhex(key).unwrap()).unwrap();
        mac.update(b"Hi There");
        assert_eq!(
            hex(&mac.finalize().into_bytes()),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn sign_is_stable_and_key_sensitive() {
        let a = sign("00112233", 1, "/v1/ping", b"{}").unwrap();
        let b = sign("00112233", 1, "/v1/ping", b"{}").unwrap();
        let c = sign("00112234", 1, "/v1/ping", b"{}").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn sign_rejects_bad_key() {
        assert!(sign("nothex", 1, "/v1/ping", b"{}").is_none());
        assert!(sign("abc", 1, "/v1/ping", b"{}").is_none());
    }
}
