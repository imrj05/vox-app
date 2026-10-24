//! ASR engine adapters (spec §10–§12, §27).
//!
//! The vocabulary layer never depends on an engine. Engines consume an
//! [`ActiveVocabularyContext`] through one of these adapters, each translating
//! the same context into engine-appropriate biasing:
//!
//! * **Whisper** → a compact contextual prompt string (spec §10). Whisper
//!   treats prompts as soft hints — never as constraints — and huge prompts
//!   hurt transcription, so the prompt is short and capped.
//! * **Parakeet** → hotword/boost pairs (spec §11). Boosts derive from
//!   priority with a conservative ceiling; the sidecar protocol decides when
//!   they can actually be applied.
//! * **Apple Speech** → contextual strings, capped to what
//!   `SFSpeechURLRecognitionRequest` handles well (spec §12).

use serde::Serialize;

use super::model::{ActiveVocabularyContext, Priority};

/// Output of an adapter: exactly what one engine needs, nothing else.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineVocabulary {
    /// Whisper: contextual prompt body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Parakeet: hotwords with boost weights.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub hotwords: Vec<Hotword>,
    /// Apple Speech: contextual strings.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub contextual_strings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotword {
    pub term: String,
    pub boost: f32,
}

/// Adapter selection by engine id ("whisper" | "parakeet" | "apple").
pub fn adapt(engine_id: &str, context: &ActiveVocabularyContext) -> EngineVocabulary {
    match engine_id {
        "whisper" => whisper(context),
        "parakeet" => parakeet(context),
        "apple" => apple_speech(context),
        _ => EngineVocabulary::default(),
    }
}

// ── Whisper (spec §10) ───────────────────────────────────────────────────────

/// Cap: whisper.cpp prompts beyond a couple of hundred tokens stop helping and
/// start costing decode time. 24 terms is well inside the useful range.
const WHISPER_MAX_TERMS: usize = 24;

pub fn whisper(context: &ActiveVocabularyContext) -> EngineVocabulary {
    if context.entries.is_empty() {
        return EngineVocabulary::default();
    }
    // Terms with pronunciation variants carry them into the prompt — the
    // same affordance the legacy personal dictionary provided ("word
    // (pronounced hint)") and the vehicle by which migrated dictionary hints
    // keep biasing Whisper.
    let terms: Vec<String> = context
        .entries
        .iter()
        .take(WHISPER_MAX_TERMS)
        .map(|entry| match entry.pronunciation_variants.first() {
            Some(variant) if !variant.trim().is_empty() => {
                format!("{} (pronounced \"{}\")", entry.canonical, variant.trim())
            }
            _ => entry.canonical.clone(),
        })
        .collect();
    EngineVocabulary {
        // Soft hint phrasing: Whisper does not treat prompts as deterministic
        // vocabulary constraints (spec §10, §28). The correction pass is what
        // guarantees canonical output.
        prompt: Some(format!(
            "Technical terms relevant to this dictation: {}.",
            terms.join(", ")
        )),
        hotwords: Vec::new(),
        contextual_strings: Vec::new(),
    }
}

// ── Parakeet (spec §11) ─────────────────────────────────────────────────────

/// Conservative boost ceiling (spec §11: avoid aggressive boosts that bend
/// unrelated speech into technical terms). Weights are configured here, not in
/// the vocabulary model, so they can change without a data migration.
const PARAKEET_MAX_HOTWORDS: usize = 32;
const PARAKEET_BASE_BOOST: f32 = 1.0;
const PARAKEET_MAX_BOOST: f32 = 2.0;

pub fn parakeet(context: &ActiveVocabularyContext) -> EngineVocabulary {
    let hotwords = context
        .entries
        .iter()
        .take(PARAKEET_MAX_HOTWORDS)
        .map(|entry| {
            let boost = entry
                .confidence_boost
                .unwrap_or_else(|| {
                    PARAKEET_BASE_BOOST
                        + (entry.priority as f32 / Priority::Critical.weight() as f32)
                            * (PARAKEET_MAX_BOOST - PARAKEET_BASE_BOOST)
                })
                .clamp(0.0, PARAKEET_MAX_BOOST);
            Hotword {
                term: entry.canonical.clone(),
                boost,
            }
        })
        .collect();
    EngineVocabulary {
        prompt: None,
        hotwords,
        contextual_strings: Vec::new(),
    }
}

// ── Apple Speech (spec §12) ─────────────────────────────────────────────────

/// `SFSpeechURLRecognitionRequest.contextualStrings` performs well with a
/// small list; beyond ~10 strings the benefit flattens (spec §12: send only
/// the highest-value terms).
const APPLE_MAX_STRINGS: usize = 10;

pub fn apple_speech(context: &ActiveVocabularyContext) -> EngineVocabulary {
    let contextual_strings = context
        .entries
        .iter()
        .take(APPLE_MAX_STRINGS)
        .map(|e| e.canonical.clone())
        .collect();
    EngineVocabulary {
        prompt: None,
        hotwords: Vec::new(),
        contextual_strings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocabulary::context::build_context;
    use crate::vocabulary::model::{PackCategory, Priority, VocabularyEntry, VocabularyPack};

    fn context_with(n: usize) -> ActiveVocabularyContext {
        let mut pack = VocabularyPack {
            id: "p".into(),
            name: "P".into(),
            description: String::new(),
            category: PackCategory::Developer,
            is_built_in: true,
            enabled: true,
            entries: (0..n)
                .map(|i| {
                    let mut e = VocabularyEntry::new(format!("Term {i}"));
                    e.priority = Priority::Critical.weight();
                    e
                })
                .collect(),
            target_applications: Vec::new(),
            priority: Priority::High.weight(),
        };
        let context = build_context(std::slice::from_ref(&mut pack), None, 0);
        context
    }

    #[test]
    fn whisper_prompt_is_compact_and_capped() {
        let vocabulary = whisper(&context_with(100));
        let prompt = vocabulary.prompt.expect("prompt");
        assert!(prompt.starts_with("Technical terms relevant to this dictation: "));
        assert!(prompt.contains("Term 0"));
        assert!(!prompt.contains("Term 50"), "prompt must be capped");
    }

    #[test]
    fn whisper_prompt_includes_pronunciation_hints() {
        let mut pack = VocabularyPack {
            id: "p".into(),
            name: "P".into(),
            description: String::new(),
            category: PackCategory::Developer,
            is_built_in: true,
            enabled: true,
            entries: vec![
                {
                    let mut e = VocabularyEntry::new("Next.js");
                    e.pronunciation_variants = vec!["next jay ess".into()];
                    e
                },
                VocabularyEntry::new("React"),
            ],
            target_applications: Vec::new(),
            priority: Priority::High.weight(),
        };
        let context = build_context(std::slice::from_ref(&mut pack), None, 0);
        let prompt = whisper(&context).prompt.expect("prompt");
        assert!(prompt.contains("Next.js (pronounced \"next jay ess\")"));
        assert!(prompt.contains(", React."));
    }

    #[test]
    fn parakeet_boosts_are_capped_and_derive_from_priority() {
        let vocabulary = parakeet(&context_with(40));
        assert_eq!(vocabulary.hotwords.len(), 32);
        assert!(vocabulary
            .hotwords
            .iter()
            .all(|h| h.boost > PARAKEET_BASE_BOOST - f32::EPSILON
                && h.boost <= PARAKEET_MAX_BOOST + f32::EPSILON));
    }

    #[test]
    fn apple_strings_capped_at_api_limit() {
        let vocabulary = apple_speech(&context_with(50));
        assert_eq!(vocabulary.contextual_strings.len(), APPLE_MAX_STRINGS);
        assert_eq!(vocabulary.contextual_strings[0], "Term 0");
    }

    #[test]
    fn unknown_engine_gets_empty_payload() {
        assert_eq!(
            adapt("nonsense", &context_with(3)),
            EngineVocabulary::default()
        );
    }
}
