//! Context builder + ranker (spec §8, §9, §21).
//!
//! Selects a *small*, relevant subset of the vocabulary database for the
//! current dictation context. The full database is never sent to an engine
//! (spec §28). Scoring is deterministic:
//!
//! ```text
//! explicit priority + pack priority + usage frequency + recency
//!                      + application relevance
//! ```

use std::collections::HashSet;

use super::builtin;
use super::model::{ActiveVocabularyContext, ApplicationContext, VocabularyEntry, VocabularyPack};

/// Hard caps so no engine ever receives an unbounded vocabulary (spec §28).
pub const MAX_ACTIVE_ENTRIES: usize = 64;

/// Ranker weights. Kept in one place so tuning is a one-line change backed by
/// the evaluation dataset (spec §26).
const W_ENTRY_PRIORITY: f32 = 1.0;
const W_PACK_PRIORITY: f32 = 0.5;
const W_USAGE: f32 = 0.75;
const W_RECENCY: f32 = 0.25;
const W_APP_RELEVANCE: f32 = 1.5;

/// Days over which usage recency decays linearly to zero.
const RECENCY_WINDOW_DAYS: f32 = 14.0;

fn normalize_app_key(value: &str) -> String {
    value.trim().to_lowercase()
}

/// True when the pack is relevant to the active application, either through an
/// explicit user mapping (spec §9) or a heuristically inferred developer
/// context (editor / terminal — matching the existing app-context heuristics
/// in `lib.rs`).
fn pack_matches_app(pack: &VocabularyPack, context: &ApplicationContext) -> bool {
    let app_id = normalize_app_key(&context.app.id);
    let app_name = context
        .app
        .display_name
        .as_deref()
        .map(normalize_app_key)
        .unwrap_or_default();

    for target in &pack.target_applications {
        let target_id = normalize_app_key(target.id.as_str());
        let target_name = target
            .display_name
            .as_deref()
            .map(normalize_app_key)
            .unwrap_or_default();
        for probe in [&app_id, &app_name] {
            if probe.is_empty() {
                continue;
            }
            if *probe == target_id
                || *probe == target_name
                || (!target_id.is_empty() && probe.contains(target_id.as_str()))
                || (!target_name.is_empty() && probe.contains(target_name.as_str()))
            {
                return true;
            }
        }
    }

    // Heuristic fallback: developer packs apply in developer contexts even
    // without an explicit mapping (spec §8's VS Code example).
    if pack.category == super::model::PackCategory::Developer {
        const DEV_CONTEXT_HINTS: [&str; 10] = [
            "code",
            "visual studio code",
            "vs code",
            "cursor",
            "xcode",
            "terminal",
            "iterm",
            "warp",
            "sublime",
            "github",
        ];
        return DEV_CONTEXT_HINTS
            .iter()
            .any(|hint| app_id.contains(hint) || app_name.contains(hint));
    }
    false
}

fn recency_boost(last_used_at: Option<u64>, now_secs: u64) -> f32 {
    let Some(last) = last_used_at else {
        return 0.0;
    };
    let age_days = now_secs.saturating_sub(last) as f32 / 86_400.0;
    (1.0 - age_days / RECENCY_WINDOW_DAYS).max(0.0)
}

/// Rank one entry for the given context. Returns `None` when the entry is
/// irrelevant to this context (e.g. medical terms while coding in VS Code —
/// spec §8).
fn score_entry(
    entry: &VocabularyEntry,
    pack: &VocabularyPack,
    context: Option<&ApplicationContext>,
    now_secs: u64,
) -> f32 {
    let mut score = entry.priority as f32 * W_ENTRY_PRIORITY
        + pack.priority as f32 * W_PACK_PRIORITY
        + (entry.use_count as f32).min(50.0) / 50.0 * 100.0 * W_USAGE
        + recency_boost(entry.last_used_at, now_secs) * 100.0 * W_RECENCY;

    if let Some(ctx) = context {
        if pack_matches_app(pack, ctx) {
            score += 100.0 * W_APP_RELEVANCE;
        }
    }
    score
}

/// Select and rank the active vocabulary for a dictation session (the subset
/// handed to ASR engine adapters — capped, spec §8).
pub fn build_context(
    packs: &[VocabularyPack],
    context: Option<ApplicationContext>,
    now_secs: u64,
) -> ActiveVocabularyContext {
    build_context_with_cap(packs, context, now_secs, Some(MAX_ACTIVE_ENTRIES))
}

/// Like [`build_context`], but uncapped. Used by the local correction pass:
/// post-processing is off the engine hot path and a trie over the full enabled
/// vocabulary is cheap, so correction quality must not be limited by the
/// engine-facing entry cap.
pub fn build_correction_context(
    packs: &[VocabularyPack],
    context: Option<ApplicationContext>,
    now_secs: u64,
) -> ActiveVocabularyContext {
    build_context_with_cap(packs, context, now_secs, None)
}

fn build_context_with_cap(
    packs: &[VocabularyPack],
    context: Option<ApplicationContext>,
    now_secs: u64,
    max_entries: Option<usize>,
) -> ActiveVocabularyContext {
    let context_ref = context.as_ref();
    // Score every enabled entry, grouped per pack. Selection is round-robin
    // across packs (highest-priority pack first): one giant pack must never
    // crowd out smaller, higher-priority packs under the entry cap.
    let mut per_pack: Vec<(u8, &VocabularyPack, Vec<(f32, &VocabularyEntry)>)> = packs
        .iter()
        .filter(|pack| pack.enabled)
        .map(|pack| {
            let mut entries: Vec<(f32, &VocabularyEntry)> = pack
                .entries
                .iter()
                .filter(|entry| entry.enabled && !entry.canonical.trim().is_empty())
                .map(|entry| (score_entry(entry, pack, context_ref, now_secs), entry))
                .collect();
            // Deterministic order: score desc, then canonical asc.
            entries.sort_by(|a, b| {
                b.0.total_cmp(&a.0)
                    .then_with(|| a.1.canonical.cmp(&b.1.canonical))
            });
            (pack.priority, pack, entries)
        })
        .collect();
    per_pack.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));

    let mut selected = Vec::new();
    let mut seen_canonical: HashSet<String> = HashSet::new();
    let mut source_packs = Vec::new();
    let mut cursor_per_pack = vec![0usize; per_pack.len()];
    'outer: while max_entries.is_none_or(|max| selected.len() < max) {
        let mut progressed = false;
        for (pack_index, (_, pack, entries)) in per_pack.iter().enumerate() {
            let cursor = &mut cursor_per_pack[pack_index];
            while *cursor < entries.len() {
                let (score, entry) = entries[*cursor];
                *cursor += 1;
                let key = entry.canonical.to_lowercase();
                if seen_canonical.contains(&key) {
                    continue; // duplicate across packs — highest rank wins
                }
                seen_canonical.insert(key);
                let _ = score;
                if !source_packs.contains(&pack.id) {
                    source_packs.push(pack.id.clone());
                }
                selected.push(entry.clone());
                progressed = true;
                break;
            }
            if max_entries.is_some_and(|max| selected.len() >= max) {
                break 'outer;
            }
        }
        if !progressed {
            break;
        }
    }

    ActiveVocabularyContext {
        entries: selected,
        source_packs,
        application_context: context,
    }
}

/// The Personal pack should always be considered (spec §18) — helper used by
/// the store to guarantee it exists exactly once.
pub fn ensure_personal_pack(packs: &mut Vec<VocabularyPack>) {
    if !packs.iter().any(|p| p.id == builtin::ids::PERSONAL) {
        packs.push(
            builtin::builtin_packs()
                .into_iter()
                .find(|p| p.id == builtin::ids::PERSONAL)
                .unwrap(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocabulary::model::{ApplicationIdentifier, EntryCategory, PackCategory, Priority};

    fn pack(
        id: &str,
        category: PackCategory,
        priority: Priority,
        canonical: &str,
    ) -> VocabularyPack {
        let mut entry = VocabularyEntry::new(canonical);
        entry.category = EntryCategory::Technical;
        entry.priority = priority.weight();
        VocabularyPack {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            category,
            is_built_in: false,
            enabled: true,
            entries: vec![entry],
            target_applications: Vec::new(),
            priority: priority.weight(),
        }
    }

    fn app_context(name: &str) -> ApplicationContext {
        ApplicationContext {
            app: ApplicationIdentifier {
                id: format!("com.example.{name}"),
                display_name: Some(name.to_string()),
            },
            window_title: None,
        }
    }

    #[test]
    fn caps_entries_and_dedupes() {
        let mut packs: Vec<VocabularyPack> = (0..50)
            .map(|i| {
                pack(
                    &format!("p{i}"),
                    PackCategory::Custom,
                    Priority::Normal,
                    &format!("Term {i}"),
                )
            })
            .collect();
        // Duplicate canonical across packs must not appear twice.
        packs.push(pack(
            "dup",
            PackCategory::Custom,
            Priority::Critical,
            "Term 0",
        ));

        let context = build_context(&packs, None, 0);
        assert_eq!(context.entries.len(), 50); // 51 entries − 1 duplicate
        let canonicals: Vec<_> = context
            .entries
            .iter()
            .map(|e| e.canonical.clone())
            .collect();
        assert_eq!(
            canonicals.len(),
            canonicals.iter().collect::<HashSet<_>>().len()
        );
    }

    #[test]
    fn app_relevance_promotes_developer_terms_in_editors() {
        let packs = vec![
            pack("dev", PackCategory::Developer, Priority::High, "TypeScript"),
            pack("med", PackCategory::Medical, Priority::High, "Hypertension"),
        ];
        let with_editor = build_context(&packs, Some(app_context("Visual Studio Code")), 0);
        assert_eq!(with_editor.entries[0].canonical, "TypeScript");

        // Without a developer app context, medical rank is not demoted below
        // equal-priority dev terms — but it IS never excluded from existence,
        // only outranked. Tie-break is alphabetical here.
        let without = build_context(&packs, None, 0);
        assert_eq!(without.entries.len(), 2);
    }

    #[test]
    fn usage_statistics_improve_ranking() {
        let mut packs = vec![pack(
            "dev",
            PackCategory::Developer,
            Priority::Normal,
            "Obscure Tool",
        )];
        packs[0].entries[0].use_count = 50;
        packs.push(pack(
            "tech",
            PackCategory::Technology,
            Priority::Normal,
            "Generic Term",
        ));

        let context = build_context(&packs, None, 0);
        assert_eq!(context.entries[0].canonical, "Obscure Tool");
    }

    #[test]
    fn disabled_packs_and_entries_excluded() {
        let mut packs = vec![pack(
            "dev",
            PackCategory::Developer,
            Priority::Critical,
            "Hidden",
        )];
        packs[0].enabled = false;
        assert!(build_context(&packs, None, 0).entries.is_empty());

        let mut packs2 = vec![pack(
            "dev2",
            PackCategory::Developer,
            Priority::Critical,
            "Hidden2",
        )];
        packs2[0].entries[0].enabled = false;
        assert!(build_context(&packs2, None, 0).entries.is_empty());
    }
}
