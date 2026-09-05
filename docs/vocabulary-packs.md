# Vocabulary Packs

A reusable **Context / Vocabulary Engine** that improves recognition of domain-specific
terms — product names, technical jargon, company names, people — across all three
speech-to-text engines (Whisper, Parakeet, Apple Speech) **without retraining any ASR
model**.

Spec reference: the Vocabulary Packs design brief (§ references below point into it).

---

## Architecture

```
VocabularyStore (JSON, on-device)
        ↓
VocabularyPackManager (CRUD, built-in/user packs)
        ↓
VocabularyContextBuilder + VocabularyRanker
        ↓
ActiveVocabularyContext  (≤ 64 ranked entries for engines;
                          full enabled set for local correction)
        ↓
┌──────────────────┬──────────────────┬───────────────────┐
│ Whisper          │ Parakeet         │ Apple Speech      │
│ initial prompt   │ hotword list w/  │ contextualStrings │
│ (soft hint)      │ boost weights    │ (via sidecar)     │
└──────────────────┴──────────────────┴───────────────────┘
        ↓
Raw transcript
        ↓
VocabularyNormalizer / VocabularyCorrector   (token trie, longest-match-first,
        ↓                                     bounded fuzzy, confidence bands)
Final transcript
        ↓
VocabularyLearner  (corrections → usage stats → ranking)
```

### Module boundaries (`src-tauri/src/vocabulary/`)

| Responsibility          | Module                 |
| ----------------------- | ---------------------- |
| VocabularyStore         | `store.rs`             |
| VocabularyPackManager   | `store.rs` (CRUD)      |
| VocabularyIndexer       | `index.rs`             |
| VocabularyContextBuilder| `context.rs`           |
| VocabularyRanker        | `context.rs`           |
| VocabularyNormalizer    | `correct.rs`           |
| VocabularyCorrector     | `correct.rs`           |
| VocabularyLearner       | `learn.rs`             |
| ASRVocabularyAdapter    | `adapters.rs`          |
| Evaluation / TTER       | `eval.rs`              |
| Data model              | `model.rs`             |
| Built-in packs          | `builtin.rs`           |

The vocabulary layer never imports an engine. Engines receive vocabulary only through
`vocabulary::adapters::adapt(engine_id, &ActiveVocabularyContext)`.

---

## Data model

- `VocabularyPack` — id, name, description, `PackCategory`, `isBuiltIn`, `enabled`,
  entries, `targetApplications` (bundle ids or display names), pack priority (0–100).
- `VocabularyEntry` — canonical form, aliases, pronunciation variants, entry category,
  priority (`low 25 / normal 50 / high 75 / critical 100`), enable flag, optional
  `confidenceBoost`, usage statistics (`useCount`, `lastUsedAt`).
- `ActiveVocabularyContext` — the ranked entry subset + source pack ids + app context.
- `LearnedCorrection` — source form → entry id, occurrence count, running-average
  confidence, last-used timestamp.
- `VocabularySettings` — learning on/off, auto-correct threshold (0.92), cautious
  threshold (0.80).

Persistence: one JSON document at `<app data>/vocabulary/vocabulary.json`, written
atomically (temp file + rename). Built-in packs are compiled in; the document only
stores their enabled flags plus user packs, app mappings, learned corrections, and
settings. Corrupt files are quarantined (`.corrupt` suffix) and replaced — malformed
data never crashes the app.

## Engine integration

| Engine        | Mechanism                                                                 |
| ------------- | ------------------------------------------------------------------------- |
| **Whisper**   | Compact initial prompt ("Technical terms relevant to this dictation: …"), capped at 24 terms. Soft hint only — Whisper does not treat prompts as constraints; the correction pass guarantees canonical output. |
| **Parakeet**  | Hotword list with conservative boosts (base 1.0, ceiling 2.0, derived from priority, never from usage). The current `transcribe-cli` sidecar has no hotword input; the adapter output is ready for when the runtime gains support. Parakeet biasing today flows through the shared post-correction pass. |
| **Apple Speech** | `contextualStrings` on `SFSpeechURLRecognitionRequest`, capped at 10 strings, passed over the sidecar's JSON serve protocol. |

All engines additionally benefit from the shared **post-correction pass** (below).

## Matching & correction

- **Token trie** (`index.rs`) over canonical forms + aliases + pronunciation variants.
  Lookup is longest-match-first, so "react native" is never degraded to "react".
  Tokens normalize case/punctuation/dots, so "nextjs", "next js", and "Next.js" all match.
- **Bounded fuzzy matching** (Levenshtein with early exit + length-band filter), used
  only for tokens that failed exact match and only for single tokens:
  - `≥ 0.92` similarity → automatic correction
  - `0.80 – 0.92` → *cautious*: corrected only when a canonical vocabulary term
    appears within ±12 tokens (contextual corroboration, spec §16)
  - `< 0.80` → never replaced
  - Thresholds are configurable in `VocabularySettings`.
- **No hallucination**: replacements are always driven by an actual token-span match;
  unrelated words pass through untouched.
- Token spans preserve the original text's punctuation and whitespace.

## Learning

Applied corrections are recorded per (normalized source, entry id) with a
running-average confidence. Unknown corrected forms materialize as new terms in the
**Personal** pack. Usage statistics raise ranking in the context builder without ever
changing the user's explicit priority. Learning can be disabled in Settings, and the
Transcripts page feeds explicit user edits to `vocabulary_record_correction`.

## Context-aware selection

`build_context` scores every enabled entry:

```
entry priority + pack priority + usage frequency + recency + app relevance
```

Selection is **round-robin across packs** (highest-priority pack first) so one large
pack can't crowd out smaller ones, capped at 64 entries for engine biasing. Developer
packs get an application-relevance boost in editor/terminal contexts (VS Code, Cursor,
Xcode, Terminal, …), and explicit app→pack mappings are honored (bundle id preferred).

The local **correction trie** is built from *all* enabled entries — it runs off the
engine hot path and correction quality must not be limited by the engine cap.

## Performance (spec §22)

- Trie + context are **cached** in `VocabularyState` keyed by store generation + app
  context; rebuilt only after vocabulary mutations.
- Engine adapters cap output (24 / 32 / 10 terms).
- All vocabulary work happens in the transcription command, after recording ends —
  the audio thread never touches vocabulary state.
- Measured in tests: trie build over ~2000 entries ≪ hot-path budget; correction of a
  typical chunk ≪ 5 ms (see `correction_latency_budget`, `builds_fast_for_large_vocabulary`).

## Corrections review & teaching (UI)

Every applied correction is returned in `TranscriptionResult.corrections`
(`{source, canonical}` pairs) and persisted by the frontend into a local
`corrections` SQLite table. The **Corrections** page (sidebar) shows:

- Stats: corrections applied, dictations improved (transcripts whose raw text
  differed from the final text), distinct terms improved
- The full heard → corrected list (aggregated with counts, deletable)
- A **Teach a correction** form: heard form + correct form → trains the
  vocabulary engine for all future dictations (`vocabulary_record_correction`
  → `store::teach_correction`). Repeated teaching raises ranking; unknown
  terms become Personal-pack entries with the heard form as an alias.

## Legacy dictionary migration

The former free-text **Dictionary** settings section has been removed — the
Vocabulary Packs Personal pack supersedes it (aliases + pronunciation variants +
priorities + context-aware correction are strict supersets of what the flat list
offered). On first launch after upgrading, `hydrate` in the frontend calls
`vocabulary_migrate_dictionary` once: the old "word | hint | category" lines are
folded into the Personal pack (hints → pronunciation variants), and the legacy
setting is cleared. Migration is idempotent and best-effort — it never blocks app
startup.

## Privacy (spec §24)

- Vocabulary and learned corrections stay in the local app data directory.
- Nothing is logged except counts ("applied 2 correction(s)"); term content never
  reaches logs, telemetry, or Sentry.
- No network access anywhere in the module. Cloud sync, if ever added, must be
  explicit opt-in.

## Import / Export (spec §19)

Format:

```json
{
  "version": 1,
  "pack": {
    "name": "Developer",
    "category": "developer",
    "entries": [{ "canonical": "shadcn", "aliases": ["shad can"], "priority": 100 }]
  }
}
```

Import validates strictly, merges duplicate canonicals, renames on collisions with
existing packs, and returns an error (never panics) on malformed input. Export
round-trips through the same schema.

## Built-in packs (spec §4, §5, §20)

Developer (87 entries across languages, frontend, CSS/UI, backend, databases,
DevOps, tools, Apple platforms), **General** (the common dictionary: everyday apps —
WhatsApp, YouTube, Instagram — Apple/Google/Microsoft devices and services, and
frequently misrecognized common words — "whats app" → WhatsApp, "why fie" → Wi-Fi,
"e mail" → email, "web site" → website), General Technology, Business, Finance,
Medical, Legal, Marketing, Gaming (placeholders, ready to populate), and the
Personal pack.
Built-ins are read-only; **Duplicate Pack** creates a fully editable copy
("My Developer Vocabulary").

## Evaluation (spec §26)

`vocabulary::eval` runs a deterministic dataset through the full correction pipeline
and reports:

- **TTER** — Technical Term Error Rate: fraction of expected technical terms missing.
- Vocabulary WER, false-correction rate, per-case pass/fail.

`cargo test --lib vocabulary::eval` asserts TTER = 0 and zero false corrections on
the built-in dataset, and that an empty vocabulary produces a high TTER (the metric
detects real failures). Grow `EVAL_CASES` with real recordings over time.

## Testing

31 vocabulary unit tests (models, trie longest-match, fuzzy thresholds, ranking,
capping, store CRUD + corruption handling, import/export, learner, adapters, eval)
plus the existing engine/router suites. Frontend gates: `pnpm typecheck`, `pnpm lint`,
`pnpm build`.

## Manual verification

1. Settings → Vocabulary → Vocabulary Packs: toggle Developer off → dictate
   "install shad can" → stays uncorrected; toggle on → "install shadcn".
2. Correct a saved transcript in History → Personal pack gains the term.
3. Import/export a pack JSON; feed a malformed file → inline error, no crash.
4. Dictate in VS Code vs a non-dev app and observe active-term differences in logs
   (counts only).

## Limitations & next steps

- Parakeet hotword biasing awaits sidecar support (`adapters::parakeet` is ready).
- App context uses localized app names today; switch `ApplicationIdentifier.id` to
  bundle ids when the context capture exposes them.
- Future-ready (no redesign needed): project/repo-aware packs (temporary contexts can
  feed `build_context` extra packs), cloud/team sync (new pack source in the store),
  multilingual vocabularies (per-language tries), AI-generated packs (import path).