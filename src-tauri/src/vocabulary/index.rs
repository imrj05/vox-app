//! Vocabulary indexer (spec §14, §15).
//!
//! Two structures, built once per vocabulary change and cached (spec §22):
//!
//! * [`PhraseTrie`] — a token trie over every canonical form, alias, and
//!   pronunciation variant. Lookup walks the transcript token stream and
//!   always prefers the *longest* phrase, so "react native" never degrades to
//!   "react" (spec §14, §16).
//! * A flat fuzzy key list with length-band filtering and bounded edit
//!   distance, used only for tokens that failed exact matching (spec §15).
//!
//! No regex, no `replacingOccurrences`-style naive replacement — everything is
//! token-aware and boundary-safe.

use std::collections::HashMap;

use super::model::{ActiveVocabularyContext, VocabularyEntry};

/// Canonical token-sequence length cap for phrases. Longer phrases are still
/// stored but only matched through their leading tokens' exact paths.
const MAX_PHRASE_TOKENS: usize = 6;

/// Normalize a recognition form into comparison tokens: lowercase, split on
/// whitespace, strip surrounding punctuation. Dots inside a token are removed
/// ("next.js" spoken as "next js" both normalize consistently, and canonical
/// "Node.js" tokenizes to `node js` so it matches the spoken form).
pub fn normalize_tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(|c| c.to_lowercase())
                .collect::<String>()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

/// One way an entry can be recognized.
#[derive(Clone, Debug, PartialEq)]
pub struct RecognitionKey {
    pub entry_id: String,
    pub canonical: String,
    /// Normalized token sequence of the key.
    pub tokens: Vec<String>,
    /// True when the key came from `aliases`/`pronunciation_variants` rather
    /// than the canonical form itself.
    pub is_alias: bool,
    pub case_sensitive: bool,
}

/// Result of matching a token span against the index.
#[derive(Clone, Debug, PartialEq)]
pub struct MatchCandidate {
    pub entry_id: String,
    pub canonical: String,
    /// 1.0 for exact key matches; `similarity` for fuzzy matches (spec §15).
    pub confidence: f32,
    /// True when matched via a fuzzy (edit-distance) path.
    pub is_fuzzy: bool,
}

#[derive(Default)]
struct TrieNode {
    children: HashMap<String, TrieNode>,
    matches: Vec<MatchCandidate>,
}

/// Token trie over all recognition keys.
pub struct PhraseTrie {
    root: TrieNode,
    /// Fuzzy candidates: (joined_key, entry_id, canonical). Kept sorted by
    /// length so the length-band filter can binary-search.
    fuzzy_keys: Vec<RecognitionKey>,
    entry_count: usize,
}

impl PhraseTrie {
    /// Build a trie from the active context. Called on vocabulary changes and
    /// cached — never on the transcription hot path (spec §22).
    pub fn build(context: &ActiveVocabularyContext) -> Self {
        let mut root = TrieNode::default();
        let mut fuzzy_keys = Vec::new();
        let mut seen_keys: HashMap<String, ()> = HashMap::new();
        let mut entry_count = 0usize;

        for entry in &context.entries {
            if !entry.enabled || entry.canonical.trim().is_empty() {
                continue;
            }
            entry_count += 1;
            let candidate = MatchCandidate {
                entry_id: entry.id.clone(),
                canonical: entry.canonical.clone(),
                confidence: 1.0,
                is_fuzzy: false,
            };
            Self::insert_key(
                &mut root,
                &mut seen_keys,
                entry,
                &entry.canonical,
                false,
                &candidate,
            );

            for form in entry.recognition_forms() {
                if form.trim().is_empty() {
                    continue;
                }
                let candidate = MatchCandidate {
                    entry_id: entry.id.clone(),
                    canonical: entry.canonical.clone(),
                    confidence: 1.0,
                    is_fuzzy: false,
                };
                Self::insert_key(&mut root, &mut seen_keys, entry, form, true, &candidate);
            }

            // Fuzzy keys include the canonical + aliases in joined (space-less)
            // form; used for edit-distance matching of single tokens.
            for form in std::iter::once(entry.canonical.as_str()).chain(entry.recognition_forms()) {
                let joined: String = normalize_tokens(form).concat();
                if joined.len() >= 3 {
                    fuzzy_keys.push(RecognitionKey {
                        entry_id: entry.id.clone(),
                        canonical: entry.canonical.clone(),
                        tokens: vec![joined.clone()],
                        is_alias: false,
                        case_sensitive: entry.case_sensitive,
                    });
                }
            }
        }

        fuzzy_keys.sort_by_key(|k| k.tokens[0].len());
        Self {
            root,
            fuzzy_keys,
            entry_count,
        }
    }

    fn insert_key(
        node: &mut TrieNode,
        seen: &mut HashMap<String, ()>,
        entry: &VocabularyEntry,
        form: &str,
        is_alias: bool,
        candidate: &MatchCandidate,
    ) {
        let tokens = normalize_tokens(form);
        if tokens.is_empty() || tokens.len() > MAX_PHRASE_TOKENS {
            return;
        }
        let key = format!("{}\u{0}{}", entry.id, tokens.join(" "));
        if seen.insert(key, ()).is_some() {
            return; // duplicate key for this entry — skip
        }
        let mut current = node;
        for token in &tokens {
            current = current.children.entry(token.clone()).or_default();
        }
        // Aliases are inserted at the front so a canonical match pushed later
        // sits last — `longest_match` prefers it via `.last()`.
        if is_alias {
            current.matches.insert(0, candidate.clone());
        } else {
            current.matches.push(candidate.clone());
        }
    }

    pub fn entry_count(&self) -> usize {
        self.entry_count
    }

    /// Exact longest-match lookup for the token sequence starting at
    /// `start`. Returns the longest matching span: `candidates[0]` is the
    /// best (longest phrase, canonical preferred) candidate for that span.
    pub fn longest_match(
        &self,
        tokens: &[String],
        start: usize,
    ) -> Option<(usize, MatchCandidate)> {
        let mut current = &self.root;
        let mut best: Option<(usize, MatchCandidate)> = None;
        let max_end = tokens.len().min(start + MAX_PHRASE_TOKENS);
        for (offset, token) in tokens[start..max_end].iter().enumerate() {
            // A missing child ends the walk but keeps the longest match found
            // so far — it must never discard it.
            let Some(next) = current.children.get(token) else {
                break;
            };
            current = next;
            if let Some(candidate) = current.matches.last() {
                best = Some((offset + 1, candidate.clone()));
            }
        }
        best
    }

    /// Fuzzy match a single normalized token. Uses bounded edit distance with
    /// a length-band filter; returns the best candidate above `threshold`
    /// (spec §15). Never returns vague matches below the threshold.
    pub fn fuzzy_match(&self, token: &str, threshold: f32) -> Option<MatchCandidate> {
        if token.len() < 3 {
            // Never fuzzy-match short tokens — too many false positives.
            return None;
        }
        let max_distance = ((1.0 - threshold) * token.len() as f32).floor() as usize;
        if max_distance == 0 {
            return None;
        }
        let mut best: Option<(usize, MatchCandidate)> = None;
        for key in &self.fuzzy_keys {
            let key_token = &key.tokens[0];
            // Length band: distance >= length difference.
            if key_token.len().abs_diff(token.len()) > max_distance {
                continue;
            }
            let Some(distance) = bounded_levenshtein(token, key_token, max_distance) else {
                continue;
            };
            let similarity = 1.0 - distance as f32 / token.len().max(key_token.len()) as f32;
            if similarity + f32::EPSILON >= threshold {
                let candidate = MatchCandidate {
                    entry_id: key.entry_id.clone(),
                    canonical: key.canonical.clone(),
                    confidence: similarity,
                    is_fuzzy: true,
                };
                let better = best
                    .as_ref()
                    .map(|(len, _)| key_token.len() > *len)
                    .unwrap_or(true);
                if better {
                    best = Some((key_token.len(), candidate));
                }
            }
        }
        best.map(|(_, candidate)| candidate)
    }
}

/// Levenshtein distance with early exit once the distance provably exceeds
/// `max_distance`. Returns `None` when `max_distance` is exceeded — callers
/// treat that as "not similar enough" and move on, keeping the fuzzy pass O(1)
/// per compared key in the common case.
fn bounded_levenshtein(a: &str, b: &str, max_distance: usize) -> Option<usize> {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max_distance {
        return None;
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0usize; b.len() + 1];
    for (i, a_char) in a.iter().enumerate() {
        current[0] = i + 1;
        let mut row_min = current[0];
        for (j, b_char) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(a_char != b_char);
            current[j + 1] = (previous[j + 1] + 1).min(current[j] + 1).min(substitution);
            row_min = row_min.min(current[j + 1]);
        }
        if row_min > max_distance {
            return None;
        }
        std::mem::swap(&mut previous, &mut current);
    }
    (previous[b.len()] <= max_distance).then_some(previous[b.len()])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocabulary::model::{ActiveVocabularyContext, Priority, VocabularyEntry};

    fn context(entries: Vec<VocabularyEntry>) -> ActiveVocabularyContext {
        ActiveVocabularyContext {
            entries,
            source_packs: Vec::new(),
            application_context: None,
        }
    }

    fn dev_entries() -> Vec<VocabularyEntry> {
        let mut shadcn = VocabularyEntry::new("shadcn");
        shadcn.aliases = vec!["shad cn".into(), "shad can".into(), "shad see en".into()];
        shadcn.priority = Priority::High.weight();

        let mut tailwind = VocabularyEntry::new("Tailwind CSS");
        tailwind.aliases = vec!["tail wind css".into(), "tailwind css".into()];
        tailwind.priority = Priority::High.weight();

        let mut react = VocabularyEntry::new("React");
        react.aliases = vec!["react js".into()];
        react.priority = Priority::High.weight();

        let mut native = VocabularyEntry::new("React Native");
        native.aliases = vec![];
        native.priority = Priority::High.weight();

        let mut vs_code = VocabularyEntry::new("VS Code");
        vs_code.aliases = vec!["v s code".into(), "visual studio code".into()];
        vs_code.priority = Priority::High.weight();

        let mut next = VocabularyEntry::new("Next.js");
        next.aliases = vec!["next js".into(), "nextjs".into()];
        next.priority = Priority::High.weight();

        vec![shadcn, tailwind, react, native, vs_code, next]
    }

    #[test]
    fn longest_phrase_wins() {
        let trie = PhraseTrie::build(&context(dev_entries()));
        let tokens = normalize_tokens("build a react native app");
        let (len, candidate) = trie.longest_match(&tokens, 2).expect("match");
        assert_eq!(tokens[2..2 + len].join(" "), "react native");
        assert_eq!(candidate.canonical, "React Native");
    }

    #[test]
    fn alias_matches_normalize_dots() {
        let trie = PhraseTrie::build(&context(dev_entries()));
        // canonical "Next.js" tokenizes to "next js"; spoken "nextjs" hits the alias.
        let tokens = normalize_tokens("use nextjs here");
        let (_, candidate) = trie.longest_match(&tokens, 1).expect("match");
        assert_eq!(candidate.canonical, "Next.js");
    }

    #[test]
    fn fuzzy_requires_threshold() {
        let trie = PhraseTrie::build(&context(dev_entries()));
        // "shadcnx" vs "shadcn": similarity 1 − 1/7 ≈ 0.857 (cautious band).
        let m = trie.fuzzy_match("shadcnx", 0.85).expect("shadcnx ≈ shadcn");
        assert_eq!(m.canonical, "shadcn");
        assert!(m.is_fuzzy);
        // At the auto threshold (0.92) a 1-edit 6-char token never qualifies —
        // fuzzy auto-correction only fires on long tokens (spec §15).
        assert!(trie.fuzzy_match("shadcnx", 0.92).is_none());
        // Short / unrelated tokens never match.
        assert!(trie.fuzzy_match("cat", 0.92).is_none());
        assert!(trie.fuzzy_match("banana", 0.92).is_none());
    }

    #[test]
    fn bounded_levenshtein_early_exit() {
        assert_eq!(bounded_levenshtein("shadcn", "shadcn", 2), Some(0));
        assert_eq!(bounded_levenshtein("shadcn", "shadcnx", 2), Some(1));
        assert_eq!(bounded_levenshtein("banana", "shadcn", 2), None);
    }

    #[test]
    fn builds_fast_for_large_vocabulary() {
        let mut entries: Vec<VocabularyEntry> = (0..2000)
            .map(|i| {
                let mut e = VocabularyEntry::new(format!("Term {i} Alpha Beta"));
                e.aliases = vec![format!("term {i} alpha beta")];
                e
            })
            .collect();
        entries.extend(dev_entries());
        let started = std::time::Instant::now();
        let trie = PhraseTrie::build(&context(entries));
        let build_ms = started.elapsed().as_millis();
        assert_eq!(trie.entry_count(), 2006);
        // Build must stay well under the 10ms hot-path budget even for
        // thousands of entries (spec §22). Generous CI bound: 250ms.
        assert!(build_ms < 250, "trie build took {build_ms}ms");
    }
}
