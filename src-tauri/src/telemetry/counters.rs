//! Feature-usage counters.
//!
//! Counting happens in memory and is shipped piggy-backed on the next ping,
//! not as a request per use — an HTTP call every time someone opens the map
//! would burn the request budget to learn something a counter already knows.

use std::sync::atomic::{AtomicU32, Ordering};

/// Feature slots, in the order they occupy the Analytics Engine `doubles`
/// array. APPEND ONLY: inserting in the middle or reordering silently
/// reinterprets every data point ever written.
///
/// `worker/src/features.ts` holds the identical list; `test_slots_match_worker`
/// below reads that file and fails if the two drift apart.
pub const FEATURE_SLOTS: [&str; 18] = [
    "fullmap_open",
    "minimap_toggle",
    "waypoint_add",
    "waypoint_delete",
    "trail_view",
    "layer_toggle",
    "basemap_change",
    "islepilot_login",
    "islepilot_garage",
    "dino_tab_open",
    "guide_open",
    "settings_open",
    "hotkey_used",
    "quests_open",
    "coord_resolve",
    "data_fetch",
    "donate_open",
    "language_switch",
];

pub const N: usize = FEATURE_SLOTS.len();

static COUNTS: [AtomicU32; N] = [const { AtomicU32::new(0) }; N];

/// Increment one feature. Unknown names are ignored rather than rejected: the
/// UI should not be able to break because a slot was renamed.
pub fn track(name: &str) {
    if let Some(i) = FEATURE_SLOTS.iter().position(|s| *s == name) {
        COUNTS[i].fetch_add(1, Ordering::Relaxed);
    } else {
        log::debug!("telemetry: unknown feature slot {name}");
    }
}

/// Read and zero. Called by the heartbeat, so counts survive a force-kill by
/// living in the on-disk pending file rather than only in memory.
pub fn drain() -> [u32; N] {
    let mut out = [0u32; N];
    for (i, c) in COUNTS.iter().enumerate() {
        out[i] = c.swap(0, Ordering::Relaxed);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_and_drain() {
        track("fullmap_open");
        track("fullmap_open");
        track("guide_open");
        track("no_such_feature");
        let d = drain();
        assert_eq!(d[0], 2, "fullmap_open is slot 0");
        assert_eq!(d[10], 1, "guide_open is slot 10");
        assert_eq!(drain()[0], 0, "drain must zero the counters");
    }

    #[test]
    fn slots_are_unique() {
        let mut sorted = FEATURE_SLOTS;
        sorted.sort_unstable();
        let mut dedup = sorted.to_vec();
        dedup.dedup();
        assert_eq!(dedup.len(), N, "duplicate slot name");
    }

    /// Pull the double-quoted names out of a slice of TypeScript.
    fn quoted_names(src: &str) -> Vec<String> {
        src.split('"')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }

    fn ts_section(path: &str, after: &str, until: char) -> Option<String> {
        let text = std::fs::read_to_string(path).ok()?;
        let (_, rest) = text.split_once(after)?;
        let (body, _) = rest.split_once(until)?;
        Some(body.to_owned())
    }

    /// The slot list exists in three places, and index -> meaning is baked
    /// into every data point ever written. If they drift, every feature number
    /// on the dashboard silently describes the wrong feature — no crash, no
    /// error, just wrong. This is the only thing that would notice.
    #[test]
    fn slots_match_worker_and_frontend() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/..");

        let worker = ts_section(&format!("{root}/worker/src/features.ts"), "FEATURE_SLOTS = [", ']')
            .expect("FEATURE_SLOTS not found in worker/src/features.ts");
        assert_eq!(
            quoted_names(&worker),
            FEATURE_SLOTS.to_vec(),
            "Rust and worker/src/features.ts disagree",
        );

        let frontend = ts_section(&format!("{root}/src/lib/api.ts"), "export type Feature =", ';')
            .expect("`export type Feature` not found in src/lib/api.ts");
        assert_eq!(
            quoted_names(&frontend),
            FEATURE_SLOTS.to_vec(),
            "Rust and the Feature union in src/lib/api.ts disagree",
        );
    }
}
