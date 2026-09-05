//! Vocabulary evaluation harness (spec §26).
//!
//! A small, deterministic dataset + metrics for tuning thresholds and
//! measuring the vocabulary system's effect. The headline metric is the
//! **Technical Term Error Rate (TTER)**: the fraction of expected technical
//! terms that the full pipeline (correction included) failed to produce.
//!
//! TTER is deliberately separate from WER: ordinary WER can improve while
//! domain terms ("shadcn", "Tailwind CSS") keep failing, and vice versa.
//!
//! Grow `EVAL_CASES` with production-style recordings over time; every case is
//! a (raw ASR output, expected transcript, expected term list) triple.

use super::correct::correct_transcript;
use super::index::{normalize_tokens, PhraseTrie};
use super::model::VocabularySettings;

pub struct EvalCase {
    /// Raw ASR output (what the engine produced *before* correction).
    pub raw: &'static str,
    /// Expected final transcript.
    pub expected: &'static str,
    /// Technical terms that must appear in the corrected output.
    pub expected_terms: &'static [&'static str],
}

/// Baseline cases matching the spec §25/§26 examples. Simulated ASR noise is
/// included on purpose — these forms are what real engines emit.
pub const EVAL_CASES: &[EvalCase] = &[
    EvalCase {
        raw: "install shad can",
        expected: "install shadcn",
        expected_terms: &["shadcn"],
    },
    EvalCase {
        raw: "open vs code",
        expected: "open VS Code",
        expected_terms: &["VS Code"],
    },
    EvalCase {
        raw: "use tail wind css",
        expected: "use Tailwind CSS",
        expected_terms: &["Tailwind CSS"],
    },
    EvalCase {
        raw: "build a react native app",
        expected: "build a React Native app",
        expected_terms: &["React Native"],
    },
    EvalCase {
        raw: "push to git hub and open a pull request",
        expected: "push to GitHub and open a pull request",
        expected_terms: &["GitHub"],
    },
    EvalCase {
        raw: "run nodejs and nextjs locally",
        expected: "run Node.js and Next.js locally",
        expected_terms: &["Node.js", "Next.js"],
    },
    EvalCase {
        raw: "the cat sat on the mat",
        expected: "the cat sat on the mat",
        // No technical terms — the false-correction guard case.
        expected_terms: &[],
    },
    EvalCase {
        raw: "deploy kubernets with docker compose",
        expected: "deploy Kubernetes with Docker Compose",
        // "kubernets" is in the cautious band but corroborated by the
        // canonical anchor "Docker Compose" nearby (spec §15/§16).
        expected_terms: &["Kubernetes", "Docker Compose"],
    },
    EvalCase {
        raw: "send it on whats app over why fie",
        expected: "send it on WhatsApp over Wi-Fi",
        expected_terms: &["WhatsApp", "Wi-Fi"],
    },
    EvalCase {
        raw: "the kubernets of old times",
        expected: "the kubernets of old times",
        // Cautious band with NO corroborating anchor: intentionally left
        // alone — never hallucinate vocabulary (spec §16, §28).
        expected_terms: &[],
    },
];

pub struct EvalReport {
    /// Word-level WER of the corrected output vs expected.
    pub vocabulary_wer: f32,
    /// Fraction of expected technical terms missing from the output.
    pub technical_term_error_rate: f32,
    /// Corrections applied that were NOT expected (false corrections).
    pub false_correction_rate: f32,
    pub case_results: Vec<CaseResult>,
}

pub struct CaseResult {
    pub raw: &'static str,
    pub output: String,
    pub expected: &'static str,
    pub passed: bool,
    pub missing_terms: Vec<String>,
}

fn word_error_rate(expected: &str, actual: &str) -> f32 {
    let expected: Vec<String> = normalize_tokens(expected);
    let actual: Vec<String> = normalize_tokens(actual);
    if expected.is_empty() {
        return if actual.is_empty() { 0.0 } else { 1.0 };
    }
    // Standard Levenshtein over word sequences (WER definition).
    let mut previous: Vec<usize> = (0..=actual.len()).collect();
    let mut current = vec![0usize; actual.len() + 1];
    for (i, e) in expected.iter().enumerate() {
        current[0] = i + 1;
        for (j, a) in actual.iter().enumerate() {
            let substitution = previous[j] + usize::from(e != a);
            current[j + 1] = (previous[j + 1] + 1).min(current[j] + 1).min(substitution);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[actual.len()] as f32 / expected.len() as f32
}

/// Run the evaluation dataset against a vocabulary trie. `corrections_expected`
/// counts exact corrections the dataset expects; false corrections are applied
/// edits on cases whose expected output contains the raw token unchanged.
pub fn evaluate(trie: &PhraseTrie, settings: &VocabularySettings) -> EvalReport {
    let mut total_terms = 0usize;
    let mut missing_terms = 0usize;
    let mut wer_sum = 0.0f32;
    let mut expected_correction_count = 0usize;
    let mut applied_correction_count = 0usize;
    let mut false_corrections = 0usize;
    let mut case_results = Vec::new();

    for case in EVAL_CASES {
        let result = correct_transcript(case.raw, trie, settings);
        let passed = result.text == case.expected;
        let mut case_missing = Vec::new();
        for term in case.expected_terms {
            total_terms += 1;
            if !result.text.contains(term) {
                missing_terms += 1;
                case_missing.push(term.to_string());
            }
        }
        for correction in &result.corrections {
            applied_correction_count += 1;
            // A correction is "false" when it replaced tokens that were
            // already correct in the expected output with something else.
            // Pure re-spellings ("vs code" → "VS Code") normalize to the same
            // token sequence and are the desired behavior, never false.
            let source_tokens = normalize_tokens(&correction.source);
            let canonical_tokens = normalize_tokens(&correction.canonical);
            let expected_tokens = normalize_tokens(case.expected);
            let source_was_expected = source_tokens
                .iter()
                .all(|token| expected_tokens.contains(token));
            let pure_respelling = source_tokens == canonical_tokens;
            if source_was_expected && !pure_respelling {
                false_corrections += 1;
            }
        }
        expected_correction_count += result.corrections.len();
        wer_sum += word_error_rate(case.expected, &result.text);
        case_results.push(CaseResult {
            raw: case.raw,
            output: result.text,
            expected: case.expected,
            passed,
            missing_terms: case_missing,
        });
    }

    EvalReport {
        vocabulary_wer: if EVAL_CASES.is_empty() {
            0.0
        } else {
            wer_sum / EVAL_CASES.len() as f32
        },
        technical_term_error_rate: if total_terms == 0 {
            0.0
        } else {
            missing_terms as f32 / total_terms as f32
        },
        false_correction_rate: if expected_correction_count == 0 {
            0.0
        } else {
            false_corrections as f32 / applied_correction_count.max(1) as f32
        },
        case_results,
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::vocabulary::context::build_correction_context;
    use crate::vocabulary::model::VocabularyPack;

    fn trie_from_builtin() -> PhraseTrie {
        let packs: Vec<VocabularyPack> = crate::vocabulary::store::VocabularyStore::load(
            &std::env::temp_dir().join("vox-vocab-eval"),
        )
        .all_packs();
        let context = build_correction_context(&packs, None, 0);
        PhraseTrie::build(&context)
    }

    #[test]
    fn builtin_vocabulary_passes_eval_dataset() {
        let trie = trie_from_builtin();
        let report = evaluate(&trie, &VocabularySettings::default());
        for case in &report.case_results {
            assert!(
                case.passed,
                "eval case failed: {:?} → {:?} (expected {:?}, missing {:?})",
                case.raw, case.output, case.expected, case.missing_terms
            );
        }
        assert!(
            report.technical_term_error_rate == 0.0,
            "TTER must be 0 on the built-in dataset"
        );
        assert!(
            report.false_correction_rate == 0.0,
            "no false corrections allowed on the built-in dataset"
        );
    }

    #[test]
    fn tter_detects_failures() {
        // Simulate a system without vocabulary: TTER must be high.
        let empty = PhraseTrie::build(&Default::default());
        let report = evaluate(&empty, &VocabularySettings::default());
        assert!(report.technical_term_error_rate > 0.5);
    }

    #[test]
    fn latency_budget_full_pipeline() {
        let trie = trie_from_builtin();
        let started = std::time::Instant::now();
        let _ = evaluate(&trie, &VocabularySettings::default());
        let elapsed = started.elapsed();
        // Whole dataset (8 cases) should be far under the per-chunk budget.
        assert!(elapsed.as_millis() < 100, "eval took {elapsed:?}");
    }
}
