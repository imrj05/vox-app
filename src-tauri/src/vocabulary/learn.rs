//! Learning from user corrections (spec §17) and personal vocabulary
//! statistics (spec §18, §21).
//!
//! Corrections are stored keyed by (normalized source form, entry id). When a
//! user repeatedly corrects "shad can" → "shadcn", the entry's usage
//! statistics rise, which raises its rank in the context builder — without
//! ever changing the user's explicit priority (spec §21).
//!
//! Privacy: learned corrections stay local (spec §24). Nothing here touches
//! the network, logs contents, or telemetry.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::index::normalize_tokens;
use super::model::VocabularyId;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedCorrection {
    /// Raw ASR source form, e.g. `"shad can"`.
    pub source: String,
    pub target_vocabulary_entry_id: VocabularyId,
    pub occurrence_count: u64,
    /// Running-average confidence of the corrections that produced this map.
    pub confidence: f32,
    pub last_used_at: u64,
}

pub type LearnedCorrections = HashMap<(String, String), LearnedCorrection>;

pub fn correction_key(source: &str, entry_id: &str) -> (String, String) {
    (normalize_tokens(source).join(" "), entry_id.to_string())
}

/// Record a correction. `accepted` reflects whether the user kept the
/// correction (auto-applied and not reverted, or explicitly saved).
pub fn record(
    corrections: &mut LearnedCorrections,
    source: &str,
    entry_id: &str,
    confidence: f32,
    now_secs: u64,
) {
    if source.trim().is_empty() {
        return;
    }
    let key = correction_key(source, entry_id);
    let entry = corrections.entry(key).or_insert_with(|| LearnedCorrection {
        source: source.trim().to_string(),
        target_vocabulary_entry_id: entry_id.to_string(),
        occurrence_count: 0,
        confidence: confidence,
        last_used_at: now_secs,
    });
    // Running average keeps early noisy corrections from dominating later.
    entry.occurrence_count = entry.occurrence_count.saturating_add(1);
    entry.confidence = (entry.confidence * 0.8) + (confidence.clamp(0.0, 1.0) * 0.2);
    entry.last_used_at = entry.last_used_at.max(now_secs);
}

/// How strongly a learned correction boosts ranking. Sub-linear so a single
/// accidental correction can't dominate (spec §28: no aggressive boosts).
pub fn usage_boost(correction: &LearnedCorrection) -> f32 {
    let count_factor = (correction.occurrence_count as f32).min(20.0) / 20.0;
    count_factor * correction.confidence
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_average_confidence() {
        let mut map = LearnedCorrections::new();
        record(&mut map, "shad can", "e1", 0.9, 100);
        record(&mut map, "shad can", "e1", 0.9, 200);
        record(&mut map, "shad can", "e1", 0.9, 300);
        let learned = &map[&correction_key("shad can", "e1")];
        assert_eq!(learned.occurrence_count, 3);
        assert!(learned.confidence > 0.89 && learned.confidence <= 0.9);
        assert_eq!(learned.last_used_at, 300);
    }

    #[test]
    fn keys_ignore_case_and_punctuation() {
        let mut map = LearnedCorrections::new();
        record(&mut map, "Shad, can", "e1", 0.95, 10);
        assert!(map.contains_key(&correction_key("shad can", "e1")));
    }

    #[test]
    fn usage_boost_is_bounded() {
        let mut map = LearnedCorrections::new();
        for i in 0..100 {
            record(&mut map, "x", "e1", 1.0, i);
        }
        let learned = &map[&correction_key("x", "e1")];
        assert_eq!(learned.occurrence_count, 100);
        assert!((usage_boost(learned) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn empty_source_ignored() {
        let mut map = LearnedCorrections::new();
        record(&mut map, "   ", "e1", 0.9, 0);
        assert!(map.is_empty());
    }
}
