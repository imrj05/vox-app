//! Vocabulary Packs — a reusable Context / Vocabulary Engine (spec overview).
//!
//! Architecture boundaries (spec §27):
//!
//! | Component               | Module                      |
//! |-------------------------|-----------------------------|
//! | VocabularyStore         | [`store`]                   |
//! | VocabularyPackManager   | [`store`] (CRUD methods)    |
//! | VocabularyIndexer       | [`index`]                   |
//! | VocabularyContextBuilder| [`context`]                 |
//! | VocabularyRanker        | [`context`] (score_entry)   |
//! | VocabularyNormalizer    | [`correct`] (canonical fmt) |
//! | VocabularyCorrector     | [`correct`]                 |
//! | VocabularyLearner       | [`learn`]                   |
//! | ASRVocabularyAdapter    | [`adapters`]                |
//!
//! Engines never see this module's internals — they receive an
//! [`adapters::EngineVocabulary`] produced from an
//! [`model::ActiveVocabularyContext`]. Personal vocabulary never leaves the
//! device (spec §24).

pub mod adapters;
pub mod builtin;
pub mod context;
pub mod correct;
pub mod eval;
pub mod index;
pub mod learn;
pub mod model;
pub mod store;
