//! Post-processing: normalization + correction (spec §13–§16, §27).
//!
//! [`correct_transcript`] is the token-aware replacement for naive global
//! string replacement. It:
//!
//! * walks the raw transcript as a token stream (original byte spans preserved
//!   so punctuation and whitespace are never disturbed),
//! * applies longest-match-first exact matching against the vocabulary trie,
//! * falls back to bounded fuzzy matching with configurable confidence
//!   thresholds (spec §15),
//! * only auto-corrects fuzzy matches in the "cautious" band when another
//!   canonical vocabulary term corroborates the context (spec §15/§16),
//! * never introduces a word that was not plausibly present in the ASR output
//!   — replacements are always driven by an actual token-span match.

use super::index::PhraseTrie;
use super::model::VocabularySettings;

/// A correction applied to the raw transcript. Consumed by the learner
/// (spec §17) and surfaced to the UI.
#[derive(Clone, Debug, PartialEq)]
pub struct AppliedCorrection {
    pub entry_id: String,
    pub canonical: String,
    /// Raw ASR text that was replaced (e.g. `"shad can"`).
    pub source: String,
    /// Token index where the correction starts (for context lookups).
    pub token_index: usize,
    pub confidence: f32,
    pub is_fuzzy: bool,
}

pub struct CorrectionResult {
    pub text: String,
    pub corrections: Vec<AppliedCorrection>,
}

/// Context-dependent correction policy.
#[derive(Clone, Copy, Debug, Default)]
pub struct CorrectionOptions {
    /// Developer-context transcripts are code, commands, paths, and symbols.
    /// Only exact, multi-word replacements made of plain lowercase words are
    /// safe there: single-token canonicalization could rename an identifier,
    /// and fuzzy matching could change a path or package name.
    pub developer_context: bool,
    /// Average confidence reported by the ASR engine (0.0–1.0), when available.
    /// Low confidence makes fuzzy repair more conservative; exact alias
    /// matches remain deterministic and are never downgraded.
    pub asr_confidence: Option<f32>,
}

/// Low ASR confidence raises the fuzzy-match bar. A transcript the engine was
/// unsure about needs a closer lexical match before Vox rewrites a word.
fn effective_auto_threshold(base: f32, asr_confidence: Option<f32>) -> f32 {
    match asr_confidence {
        Some(confidence) if confidence < 0.55 => base.max(0.97),
        Some(confidence) if confidence < 0.70 => base.max(0.95),
        Some(confidence) if confidence < 0.85 => base.max(0.93),
        _ => base,
    }
}

/// Characters that join tokens into a code identifier, path, URL, or package
/// name. A vocabulary match that touches one of these is not prose.
const CODE_SEPARATORS: [char; 10] = ['_', '.', '-', '/', '\\', ':', '@', '#', '$', '~'];

fn char_before(text: &str, index: usize) -> Option<char> {
    text[..index].chars().next_back()
}

fn char_at(text: &str, index: usize) -> Option<char> {
    text[index..].chars().next()
}

/// True when `separator` on the far side of a match still joins an
/// alphanumeric neighbour, e.g. `code.ts` or `foo.vs`.
fn separator_joins_identifier(separator: char, neighbour: Option<char>) -> bool {
    match separator {
        // In prose a period or hyphen is usually punctuation; it only joins an
        // identifier when an alphanumeric character follows directly.
        '.' | '-' => neighbour.is_some_and(|ch| ch.is_alphanumeric()),
        _ => true,
    }
}

/// One transcript token with its byte span in the original text.
struct Token {
    normalized: String,
    start: usize,
    end: usize,
}

/// Split into word tokens, keeping each token's byte span over only its
/// alphanumeric core (whitespace and punctuation stay in the gaps between
/// spans, so replacements never disturb them).
fn tokenize(text: &str) -> Vec<Token> {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut start: Option<usize> = None;
    for (i, ch) in text.char_indices() {
        if ch.is_alphanumeric() {
            if start.is_none() {
                start = Some(i);
            }
        } else if let Some(s) = start.take() {
            spans.push((s, i));
        }
    }
    if let Some(s) = start {
        spans.push((s, text.len()));
    }
    spans
        .into_iter()
        .map(|(start, end)| Token {
            normalized: text[start..end].to_lowercase(),
            start,
            end,
        })
        .collect()
}

pub fn correct_transcript(
    raw: &str,
    trie: &PhraseTrie,
    settings: &VocabularySettings,
) -> CorrectionResult {
    correct_transcript_with_options(raw, trie, settings, CorrectionOptions::default())
}

/// True when a match is safe to rewrite in a developer context: at least two
/// plain lowercase words with no identifier/path separator in between or at
/// either edge. CamelCase and PascalCase are skipped because the developer
/// formatter has already produced an identifier there.
fn safe_in_developer_context(raw: &str, tokens: &[Token], start_token: usize, len: usize) -> bool {
    if len < 2 {
        return false;
    }
    let all_lowercase = (start_token..start_token + len).all(|index| {
        let token = &tokens[index];
        raw[token.start..token.end] == token.normalized
    });
    if !all_lowercase {
        return false;
    }
    let span_start = tokens[start_token].start;
    let span_end = tokens[start_token + len - 1].end;
    let touches_separator = char_before(raw, span_start).is_some_and(|separator| {
        CODE_SEPARATORS.contains(&separator)
            && separator_joins_identifier(
                separator,
                char_before(raw, span_start - separator.len_utf8()),
            )
    }) || char_at(raw, span_end).is_some_and(|separator| {
        CODE_SEPARATORS.contains(&separator)
            && separator_joins_identifier(separator, char_at(raw, span_end + separator.len_utf8()))
    });
    if touches_separator {
        return false;
    }
    !(start_token..start_token + len - 1).any(|index| {
        raw[tokens[index].end..tokens[index + 1].start]
            .chars()
            .any(|ch| CODE_SEPARATORS.contains(&ch))
    })
}

pub fn correct_transcript_with_options(
    raw: &str,
    trie: &PhraseTrie,
    settings: &VocabularySettings,
    options: CorrectionOptions,
) -> CorrectionResult {
    let tokens = tokenize(raw);
    let normalized: Vec<String> = tokens.iter().map(|t| t.normalized.clone()).collect();
    let auto_threshold =
        effective_auto_threshold(settings.auto_correct_threshold, options.asr_confidence);
    // The cautious band is corroboration-based and only safe when the engine
    // was reasonably confident about what it heard.
    let cautious_enabled = options
        .asr_confidence
        .is_none_or(|confidence| confidence >= 0.70)
        && settings.cautious_correct_threshold < auto_threshold;

    let mut corrections: Vec<AppliedCorrection> = Vec::new();
    // Pre-scan: token indices of confirmed exact matches — the corroboration
    // signal for cautious fuzzy corrections (spec §16). Scanning first lets a
    // fuzzy token be corroborated by a canonical term *after* it, not only
    // before it.
    let mut exact_match_positions: Vec<usize> = Vec::new();
    {
        let mut i = 0usize;
        while i < normalized.len() {
            match trie.longest_match(&normalized, i) {
                Some((len, _)) => {
                    exact_match_positions.push(i);
                    i += len;
                }
                None => i += 1,
            }
        }
    }
    let is_corroborated = |t: usize| {
        exact_match_positions
            .iter()
            .any(|anchor| anchor.abs_diff(t) <= 12)
    };

    let mut result = String::with_capacity(raw.len());
    let mut cursor = 0usize; // byte cursor into `raw`
    let mut t = 0usize; // token index

    while t < normalized.len() {
        let token = &tokens[t];

        // Exact longest-match first (spec §14).
        if let Some((len, candidate)) = trie.longest_match(&normalized, t) {
            let span_start = token.start;
            let span_end = tokens[t + len - 1].end;
            let can_rewrite =
                !options.developer_context || safe_in_developer_context(raw, &tokens, t, len);

            // Canonical already spelled correctly? Still an anchor, not a fix.
            if can_rewrite && raw[span_start..span_end] != candidate.canonical {
                result.push_str(&raw[cursor..span_start]);
                result.push_str(&candidate.canonical);
                cursor = span_end;
                corrections.push(AppliedCorrection {
                    entry_id: candidate.entry_id.clone(),
                    canonical: candidate.canonical.clone(),
                    source: raw[span_start..span_end].to_string(),
                    token_index: t,
                    confidence: candidate.confidence,
                    is_fuzzy: false,
                });
            }
            t += len;
            continue;
        }

        // Fuzzy matching is too risky on code and commands: a single edit can
        // turn an identifier or path into a different one. Developer contexts
        // therefore only receive exact phrase matches above.
        if options.developer_context {
            t += 1;
            continue;
        }

        // Fuzzy fallback for single tokens only (spec §15): multi-token fuzzy
        // matching is too error-prone for deterministic correction.
        if let Some(candidate) = trie.fuzzy_match(&token.normalized, auto_threshold) {
            result.push_str(&raw[cursor..token.start]);
            result.push_str(&candidate.canonical);
            cursor = token.end;
            corrections.push(AppliedCorrection {
                entry_id: candidate.entry_id.clone(),
                canonical: candidate.canonical.clone(),
                source: raw[token.start..token.end].to_string(),
                token_index: t,
                confidence: candidate.confidence,
                is_fuzzy: true,
            });
            t += 1;
            continue;
        }

        // Cautious band (0.80–0.92): correct only with contextual
        // corroboration from a canonical term nearby (spec §15/§16).
        if cautious_enabled {
            if let Some(candidate) =
                trie.fuzzy_match(&token.normalized, settings.cautious_correct_threshold)
            {
                if is_corroborated(t) {
                    result.push_str(&raw[cursor..token.start]);
                    result.push_str(&candidate.canonical);
                    cursor = token.end;
                    corrections.push(AppliedCorrection {
                        entry_id: candidate.entry_id.clone(),
                        canonical: candidate.canonical.clone(),
                        source: raw[token.start..token.end].to_string(),
                        token_index: t,
                        confidence: candidate.confidence,
                        is_fuzzy: true,
                    });
                    t += 1;
                    continue;
                }
            }
        }

        // No correction — token passes through untouched.
        t += 1;
    }
    result.push_str(&raw[cursor..]);

    CorrectionResult {
        text: result,
        corrections,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocabulary::context::build_context;
    use crate::vocabulary::index::PhraseTrie;
    use crate::vocabulary::model::{Priority, VocabularyEntry, VocabularyPack};

    fn pack_with(entries: Vec<(&str, Vec<&str>)>) -> Vec<VocabularyPack> {
        vec![VocabularyPack {
            id: "test".into(),
            name: "Test".into(),
            description: String::new(),
            category: crate::vocabulary::model::PackCategory::Developer,
            is_built_in: true,
            enabled: true,
            entries: entries
                .into_iter()
                .map(|(canonical, aliases)| {
                    let mut e = VocabularyEntry::new(canonical);
                    e.aliases = aliases.into_iter().map(String::from).collect();
                    e.priority = Priority::High.weight();
                    e
                })
                .collect(),
            target_applications: Vec::new(),
            priority: Priority::High.weight(),
        }]
    }

    fn correct(raw: &str, packs: &[VocabularyPack]) -> CorrectionResult {
        let context = build_context(packs, None, 0);
        let trie = PhraseTrie::build(&context);
        correct_transcript(raw, &trie, &VocabularySettings::default())
    }

    #[test]
    fn corrects_spec_examples() {
        let packs = pack_with(vec![
            ("shadcn", vec!["shad cn", "shad can", "shad see en"]),
            ("Tailwind CSS", vec!["tailwind css", "tail wind css"]),
            ("VS Code", vec!["vs code", "v s code", "visual studio code"]),
            ("GitHub", vec!["git hub", "github"]),
            ("JavaScript", vec!["java script", "javascript"]),
            ("TypeScript", vec!["type script", "typescript"]),
            ("Node.js", vec!["node js", "nodejs"]),
            ("Next.js", vec!["next js", "nextjs"]),
            ("React", vec!["react js"]),
            ("React Native", vec![]),
        ]);

        assert_eq!(correct("install shad can", &packs).text, "install shadcn");
        assert_eq!(correct("open vs code", &packs).text, "open VS Code");
        assert_eq!(
            correct("use tail wind css", &packs).text,
            "use Tailwind CSS"
        );
        assert_eq!(
            correct("build a react native app", &packs).text,
            "build a React Native app"
        );
        assert_eq!(
            correct("i love java script", &packs).text,
            "i love JavaScript"
        );
        assert_eq!(correct("run nodejs now", &packs).text, "run Node.js now");
        assert_eq!(
            correct("deploy to next js", &packs).text,
            "deploy to Next.js"
        );
        assert_eq!(correct("push to git hub", &packs).text, "push to GitHub");
        assert_eq!(
            correct("install shadcn and tail wind css", &packs).text,
            "install shadcn and Tailwind CSS"
        );
    }

    #[test]
    fn longest_match_not_partial() {
        // "React Native" must never be corrected to "React" (spec §14).
        let packs = pack_with(vec![("React", vec!["react js"]), ("React Native", vec![])]);
        let result = correct("build a react native app", &packs);
        assert_eq!(result.text, "build a React Native app");
        assert_eq!(result.corrections.len(), 1);
        assert_eq!(result.corrections[0].canonical, "React Native");
    }

    #[test]
    fn preserves_punctuation_and_unrelated_words() {
        let packs = pack_with(vec![("shadcn", vec!["shad can"])]);
        let result = correct("okay, install shad can, then run tests.", &packs);
        assert_eq!(result.text, "okay, install shadcn, then run tests.");
    }

    #[test]
    fn no_hallucinated_vocabulary() {
        // Words unrelated to the vocabulary pass through untouched (spec §16).
        let packs = pack_with(vec![("React", vec!["react js"])]);
        let result = correct("the reactionary reaction was reacty", &packs);
        assert_eq!(result.text, "the reactionary reaction was reacty");
        assert!(result.corrections.is_empty());
    }

    #[test]
    fn fuzzy_auto_band_and_cautious_band() {
        let packs = pack_with(vec![
            ("shadcn", vec!["shad cn"]),
            ("Kubernetes", vec!["kubernetes"]),
            ("GitHub Actions", vec!["github actions"]),
        ]);

        // Auto band (≥ 0.92 similarity): 14-token edit distance 1 → 0.93.
        // "githubactionsx" vs joined "githubactions".
        let result = correct("run githubactionsx now", &packs);
        assert!(
            result.text.contains("GitHub Actions"),
            "got: {}",
            result.text
        );
        assert!(result.corrections[0].is_fuzzy);

        // 0.80–0.92 with NO canonical anchor nearby: left alone (spec §15).
        let result = correct("the kubernets of old times", &packs);
        assert_eq!(result.text, "the kubernets of old times");

        // 0.80–0.92 WITH a canonical anchor nearby: corrected (spec §16).
        let result = correct("deploy kubernets with shadcn", &packs);
        assert_eq!(result.text, "deploy Kubernetes with shadcn");
        assert!(result
            .corrections
            .iter()
            .any(|c| c.canonical == "Kubernetes" && c.is_fuzzy));
    }

    #[test]
    fn threshold_settings_are_respected() {
        let packs = pack_with(vec![("shadcn", vec!["shad cn"])]);
        let context = build_context(&packs, None, 0);
        let trie = PhraseTrie::build(&context);
        let mut strict = VocabularySettings::default();
        strict.auto_correct_threshold = 0.99;
        let result = correct_transcript("install shadcnx today", &trie, &strict);
        assert_eq!(result.text, "install shadcnx today");
    }

    #[test]
    fn canonical_already_correct_not_recorded_as_correction() {
        let packs = pack_with(vec![("GitHub", vec!["git hub"])]);
        let result = correct("push to GitHub now", &packs);
        assert_eq!(result.text, "push to GitHub now");
        assert!(result.corrections.is_empty());
    }

    #[test]
    fn corrects_general_common_dictionary() {
        // General/Common built-in pack (everyday apps, devices, common words).
        let packs = pack_with(vec![
            ("WhatsApp", vec!["whats app", "what's app"]),
            ("Wi-Fi", vec!["wifi", "wi fi", "why fie"]),
            ("email", vec!["e mail", "e-mail"]),
            ("website", vec!["web site"]),
            ("iPhone", vec!["i phone"]),
            ("PowerPoint", vec!["power point"]),
            ("Bluetooth", vec!["blue tooth"]),
            ("QR code", vec!["q r code", "cue are code"]),
            ("username", vec!["user name"]),
            ("screenshot", vec!["screen shot"]),
        ]);

        assert_eq!(
            correct("send it on whats app", &packs).text,
            "send it on WhatsApp"
        );
        assert_eq!(
            correct("connect to why fie", &packs).text,
            "connect to Wi-Fi"
        );
        assert_eq!(correct("check my e mail", &packs).text, "check my email");
        assert_eq!(
            correct("visit the web site", &packs).text,
            "visit the website"
        );
        assert_eq!(correct("my i phone died", &packs).text, "my iPhone died");
        assert_eq!(correct("open power point", &packs).text, "open PowerPoint");
        assert_eq!(
            correct("enable blue tooth", &packs).text,
            "enable Bluetooth"
        );
        assert_eq!(
            correct("scan the q r code", &packs).text,
            "scan the QR code"
        );
        assert_eq!(
            correct("update your user name", &packs).text,
            "update your username"
        );
        assert_eq!(
            correct("take a screen shot", &packs).text,
            "take a screenshot"
        );
        // Unrelated words pass through untouched (no hallucinated vocabulary).
        assert_eq!(
            correct("the old times of summer", &packs).text,
            "the old times of summer"
        );
        // Exact alias matches are deterministic: "wifi" is a listed alias.
        assert_eq!(
            correct("the wifi of old times", &packs).text,
            "the Wi-Fi of old times"
        );
    }

    #[test]
    fn developer_context_only_corrects_safe_multiword_phrases() {
        let packs = pack_with(vec![
            ("VS Code", vec!["vs code"]),
            ("username", vec!["user name"]),
            ("GitHub", vec!["git hub", "github"]),
        ]);
        let context = build_context(&packs, None, 0);
        let trie = PhraseTrie::build(&context);
        let options = CorrectionOptions {
            developer_context: true,
            asr_confidence: None,
        };
        let settings = VocabularySettings::default();

        // Spoken phrase in a comment or commit message is safe.
        let result = correct_transcript_with_options(
            "open vs code and check git hub",
            &trie,
            &settings,
            options,
        );
        assert_eq!(result.text, "open VS Code and check GitHub");

        // Sentence punctuation at the edge is not a path separator.
        let result = correct_transcript_with_options("open vs code.", &trie, &settings, options);
        assert_eq!(result.text, "open VS Code.");

        // A filename or path is left alone.
        let result = correct_transcript_with_options("open vs code.ts", &trie, &settings, options);
        assert_eq!(result.text, "open vs code.ts");

        // CamelCase identifiers must keep their casing.
        let result = correct_transcript_with_options("let userName = 1", &trie, &settings, options);
        assert_eq!(result.text, "let userName = 1");

        // Identifier and path separators mean this is one token, not a phrase.
        let result = correct_transcript_with_options(
            "import git_hub from 'vs-code'",
            &trie,
            &settings,
            options,
        );
        assert_eq!(result.text, "import git_hub from 'vs-code'");

        // Single-token aliases are skipped in code.
        let result = correct_transcript_with_options("const github = 1", &trie, &settings, options);
        assert_eq!(result.text, "const github = 1");
    }

    #[test]
    fn developer_context_skips_fuzzy_matches() {
        let packs = pack_with(vec![("shadcn", vec!["shad cn"])]);
        let context = build_context(&packs, None, 0);
        let trie = PhraseTrie::build(&context);
        let options = CorrectionOptions {
            developer_context: true,
            asr_confidence: None,
        };

        let result = correct_transcript_with_options(
            "install shadcnx today",
            &trie,
            &VocabularySettings::default(),
            options,
        );
        assert_eq!(result.text, "install shadcnx today");
        assert!(result.corrections.is_empty());
    }

    #[test]
    fn low_asr_confidence_requires_stronger_fuzzy_match() {
        let packs = pack_with(vec![("GitHub Actions", vec!["github actions"])]);
        let context = build_context(&packs, None, 0);
        let trie = PhraseTrie::build(&context);
        let settings = VocabularySettings::default();

        let confident = CorrectionOptions {
            developer_context: false,
            asr_confidence: Some(0.95),
        };
        let result =
            correct_transcript_with_options("run githubactionsx now", &trie, &settings, confident);
        assert!(
            result.text.contains("GitHub Actions"),
            "got: {}",
            result.text
        );

        let uncertain = CorrectionOptions {
            developer_context: false,
            asr_confidence: Some(0.40),
        };
        let result =
            correct_transcript_with_options("run githubactionsx now", &trie, &settings, uncertain);
        assert_eq!(result.text, "run githubactionsx now");
        assert!(result.corrections.is_empty());
    }

    #[test]
    fn low_asr_confidence_disables_cautious_band() {
        let packs = pack_with(vec![
            ("Kubernetes", vec!["kubernetes"]),
            ("shadcn", vec!["shad cn"]),
        ]);
        let context = build_context(&packs, None, 0);
        let trie = PhraseTrie::build(&context);
        let settings = VocabularySettings::default();

        let confident = CorrectionOptions {
            developer_context: false,
            asr_confidence: Some(0.90),
        };
        let result = correct_transcript_with_options(
            "deploy kubernets with shadcn",
            &trie,
            &settings,
            confident,
        );
        assert!(result.text.contains("Kubernetes"), "got: {}", result.text);

        let uncertain = CorrectionOptions {
            developer_context: false,
            asr_confidence: Some(0.45),
        };
        let result = correct_transcript_with_options(
            "deploy kubernets with shadcn",
            &trie,
            &settings,
            uncertain,
        );
        assert_eq!(result.text, "deploy kubernets with shadcn");
    }

    #[test]
    fn correction_latency_budget() {
        // Spec §22: local normalization < 5ms for typical chunks.
        let mut entries = Vec::new();
        for i in 0..1000 {
            let mut e = VocabularyEntry::new(format!("Term {i} Alpha"));
            e.aliases = vec![format!("term {i} alpha")];
            entries.push(e);
        }
        let mut shadcn = VocabularyEntry::new("shadcn");
        shadcn.aliases = vec!["shad cn".into(), "shad can".into()];
        shadcn.priority = 100; // Critical — survives the 64-entry active cap
        entries.push(shadcn);
        let packs = vec![VocabularyPack {
            id: "bench".into(),
            name: "bench".into(),
            description: String::new(),
            category: crate::vocabulary::model::PackCategory::Developer,
            is_built_in: true,
            enabled: true,
            entries,
            target_applications: Vec::new(),
            priority: 50,
        }];
        let context = build_context(&packs, None, 0);
        let trie = PhraseTrie::build(&context);
        let raw = "install shad can and run the deploy on kubernetes with docker compose and node js now please";
        let started = std::time::Instant::now();
        let result = correct_transcript(raw, &trie, &VocabularySettings::default());
        let elapsed = started.elapsed();
        assert!(elapsed.as_millis() < 50, "correction took {elapsed:?}");
        assert!(result.text.contains("shadcn"));
    }
}
