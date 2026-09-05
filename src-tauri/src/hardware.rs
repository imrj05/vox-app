//! Hardware awareness (spec §25): detect what this Mac can comfortably run
//! and translate it into simple recommendations — Fast / Balanced / Accurate —
//! instead of asking users to reason about model internals.

use serde::Serialize;

/// Public tier computation, unit-testable. Thresholds are conservative rules
/// of thumb: whisper.cpp loads a model into Metal memory ~1.5–2× its on-disk
/// size, and the OS + app need room to breathe.
pub fn tier_for(total_memory_bytes: u64) -> &'static str {
    const GB: u64 = 1024 * 1024 * 1024;
    if total_memory_bytes >= 32 * GB {
        "accurate"
    } else if total_memory_bytes >= 8 * GB {
        "balanced"
    } else {
        "fast"
    }
}

/// Largest model file this tier should download comfortably.
pub fn max_recommended_model_bytes(tier: &str) -> u64 {
    const MB: u64 = 1024 * 1024;
    match tier {
        "accurate" => u64::MAX,
        "balanced" => 1600 * MB,
        _ => 512 * MB,
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub platform: &'static str,
    pub arch: String,
    pub apple_silicon: bool,
    pub total_memory_bytes: u64,
    pub cpu_cores: usize,
    /// "fast" | "balanced" | "accurate"
    pub tier: &'static str,
    pub max_recommended_model_bytes: u64,
}

pub fn detect() -> HardwareInfo {
    let total_memory_bytes = total_memory_bytes();
    let tier = tier_for(total_memory_bytes);
    let arch = std::env::consts::ARCH.to_string();
    HardwareInfo {
        platform: std::env::consts::OS,
        apple_silicon: cfg!(target_os = "macos") && arch == "aarch64",
        arch,
        cpu_cores: std::thread::available_parallelism()
            .map(|threads| threads.get())
            .unwrap_or(4),
        total_memory_bytes,
        tier,
        max_recommended_model_bytes: max_recommended_model_bytes(tier),
    }
}

/// Cross-platform physical memory without external dependencies.
#[cfg(target_os = "macos")]
fn total_memory_bytes() -> u64 {
    // `hw.memsize` via the sysctl command line — same pattern the codebase
    // already uses for xdg-open and friends; avoids a libc dependency.
    std::process::Command::new("sysctl")
        .arg("-n")
        .arg("hw.memsize")
        .output()
        .ok()
        .and_then(|output| {
            String::from_utf8(output.stdout)
                .ok()
                .and_then(|stdout| stdout.trim().parse().ok())
        })
        .unwrap_or(8 * 1024 * 1024 * 1024)
}

#[cfg(target_os = "linux")]
fn total_memory_bytes() -> u64 {
    if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
        for line in meminfo.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                // "MemTotal:       32768000 kB"
                if let Some(kib) = line_value_kb(rest) {
                    return kib * 1024;
                }
            }
        }
    }
    8 * 1024 * 1024 * 1024
}

#[cfg(target_os = "linux")]
fn line_value_kb(rest: &str) -> Option<u64> {
    rest.trim().trim_end_matches("kB").trim().parse().ok()
}

#[cfg(target_os = "windows")]
fn total_memory_bytes() -> u64 {
    use std::mem;

    #[repr(C)]
    struct MemoryStatus {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }

    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatus) -> i32;
    }

    let mut status = MemoryStatus {
        dw_length: mem::size_of::<MemoryStatus>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };
    // SAFETY: buffer length is declared in dw_length per the API contract.
    unsafe {
        if GlobalMemoryStatusEx(&mut status) != 0 {
            return status.ull_total_phys;
        }
    }
    8 * 1024 * 1024 * 1024
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_track_memory() {
        const GB: u64 = 1024 * 1024 * 1024;
        assert_eq!(tier_for(4 * GB), "fast");
        assert_eq!(tier_for(8 * GB), "balanced");
        assert_eq!(tier_for(16 * GB), "balanced");
        assert_eq!(tier_for(36 * GB), "accurate");
    }

    #[test]
    fn max_model_bytes_follow_tier() {
        assert_eq!(max_recommended_model_bytes("fast"), 512 * 1024 * 1024);
        assert_eq!(max_recommended_model_bytes("balanced"), 1600 * 1024 * 1024);
        assert_eq!(max_recommended_model_bytes("accurate"), u64::MAX);
    }

    #[test]
    fn detect_reports_sane_values() {
        let info = detect();
        assert!(info.total_memory_bytes > 0);
        assert!(info.cpu_cores > 0);
        assert!(matches!(info.tier, "fast" | "balanced" | "accurate"));
    }
}
