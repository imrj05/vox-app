//! Vocabulary Pack data model (Vocabulary Packs spec §3, §21, §24).
//!
//! The vocabulary layer is engine-agnostic: nothing in this module references
//! Whisper, Parakeet, or Apple Speech. Engines consume vocabulary only through
//! [`crate::vocabulary::adapters`].
//!
//! Privacy: vocabulary data can contain personal terms. Everything in this
//! module stays on disk under the app data directory and is never logged,
//! included in telemetry, or uploaded.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Stable string id. Kept as a plain `String` (rather than `Uuid`) so imported
/// packs and built-in packs can use human-stable ids without another crate.
pub type VocabularyId = String;

/// Categories for whole packs (spec §3). Serialized lowercase so the frontend
/// can treat it as a plain string union.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackCategory {
    Developer,
    Technology,
    Business,
    Finance,
    Medical,
    Legal,
    Marketing,
    Gaming,
    Personal,
    Custom,
}

impl PackCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            PackCategory::Developer => "developer",
            PackCategory::Technology => "technology",
            PackCategory::Business => "business",
            PackCategory::Finance => "finance",
            PackCategory::Medical => "medical",
            PackCategory::Legal => "legal",
            PackCategory::Marketing => "marketing",
            PackCategory::Gaming => "gaming",
            PackCategory::Personal => "personal",
            PackCategory::Custom => "custom",
        }
    }
}

/// Fine-grained category for a single term (spec §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryCategory {
    ProgrammingLanguage,
    Framework,
    Library,
    Tool,
    Product,
    Company,
    Person,
    Place,
    Acronym,
    Technical,
    General,
}

impl EntryCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            EntryCategory::ProgrammingLanguage => "programming-language",
            EntryCategory::Framework => "framework",
            EntryCategory::Library => "library",
            EntryCategory::Tool => "tool",
            EntryCategory::Product => "product",
            EntryCategory::Company => "company",
            EntryCategory::Person => "person",
            EntryCategory::Place => "place",
            EntryCategory::Acronym => "acronym",
            EntryCategory::Technical => "technical",
            EntryCategory::General => "general",
        }
    }
}

/// Explicit user priority (spec §21). Internally mapped to numeric values so
/// usage statistics can adjust ranking *without* changing the user's intent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Normal,
    High,
    Critical,
}

impl Priority {
    pub const fn weight(self) -> u8 {
        match self {
            Priority::Low => 25,
            Priority::Normal => 50,
            Priority::High => 75,
            Priority::Critical => 100,
        }
    }

    pub fn from_weight(weight: u8) -> Self {
        match weight {
            0..=37 => Priority::Low,
            38..=62 => Priority::Normal,
            63..=87 => Priority::High,
            _ => Priority::Critical,
        }
    }
}

impl fmt::Display for Priority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Priority::Low => "low",
            Priority::Normal => "normal",
            Priority::High => "high",
            Priority::Critical => "critical",
        })
    }
}

/// A single vocabulary term: canonical output form plus every recognition
/// form (aliases, pronunciation variants) the ASR might produce (spec §3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyEntry {
    pub id: VocabularyId,
    /// Canonical output form, e.g. `"Next.js"`, `"shadcn"`, `"Tailwind CSS"`.
    pub canonical: String,
    /// Alternative recognition forms, e.g. `"next js"`, `"next jay ess"`.
    pub aliases: Vec<String>,
    /// Phonetic/spoken variants, e.g. `"tail wind see ess"`. Treated like
    /// aliases during matching but kept separate for UI clarity.
    #[serde(default)]
    pub pronunciation_variants: Vec<String>,
    pub category: EntryCategory,
    /// Explicit priority weight 0–100 (see [`Priority`]).
    pub priority: u8,
    pub enabled: bool,
    /// When true, matching requires exact case. Almost always false — ASR
    /// output casing is unreliable.
    #[serde(default)]
    pub case_sensitive: bool,
    /// Optional per-entry boost override for biasing engines (Parakeet
    /// hotwords). `None` derives the boost from `priority` (spec §11).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence_boost: Option<f32>,
    /// Monotonic usage counter maintained by the learner (spec §17/§21).
    #[serde(default)]
    pub use_count: u64,
    #[serde(default)]
    pub last_used_at: Option<u64>,
    /// True when the user added this entry themselves (persisted), as
    /// opposed to compiled-in built-in entries. Drives UI editability.
    #[serde(default)]
    pub user_added: bool,
}

impl VocabularyEntry {
    pub fn new(canonical: impl Into<String>) -> Self {
        Self {
            id: new_id(),
            canonical: canonical.into(),
            aliases: Vec::new(),
            pronunciation_variants: Vec::new(),
            category: EntryCategory::General,
            priority: Priority::Normal.weight(),
            enabled: true,
            case_sensitive: false,
            confidence_boost: None,
            use_count: 0,
            last_used_at: None,
            user_added: false,
        }
    }

    /// Every recognition form of this entry (aliases + pronunciation
    /// variants), deduplicated, canonical excluded.
    pub fn recognition_forms(&self) -> impl Iterator<Item = &str> {
        self.aliases
            .iter()
            .chain(self.pronunciation_variants.iter())
            .map(String::as_str)
    }
}

/// A named application identifier. Bundle ids are preferred (`com.apple.Terminal`);
/// display names are accepted as a fallback because macOS context capture in
/// Vox currently exposes localized app names (spec §9).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationIdentifier {
    /// Bundle id when known (`com.microsoft.VSCode`), otherwise a display
    /// name like `"Visual Studio Code"`.
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Associates packs with applications (spec §9).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVocabularyMapping {
    pub app: ApplicationIdentifier,
    pub pack_ids: Vec<VocabularyId>,
}

/// A collection of vocabulary entries (spec §3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyPack {
    pub id: VocabularyId,
    pub name: String,
    pub description: String,
    pub category: PackCategory,
    pub is_built_in: bool,
    pub enabled: bool,
    pub entries: Vec<VocabularyEntry>,
    #[serde(default)]
    pub target_applications: Vec<ApplicationIdentifier>,
    /// Pack-level priority weight 0–100. Feeds the ranker (spec §8).
    pub priority: u8,
}

impl VocabularyPack {
    pub fn enabled_entry_count(&self) -> usize {
        self.entries.iter().filter(|e| e.enabled).count()
    }

    pub fn entry(&self, entry_id: &str) -> Option<&VocabularyEntry> {
        self.entries.iter().find(|e| e.id == entry_id)
    }

    pub fn entry_mut(&mut self, entry_id: &str) -> Option<&mut VocabularyEntry> {
        self.entries.iter_mut().find(|e| e.id == entry_id)
    }
}

/// The active application, captured at recording start.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationContext {
    pub app: ApplicationIdentifier,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
}

/// The compact vocabulary subset handed to ASR adapters (spec §8). Deliberately
/// small: adapters cap it further per engine, and nothing here is the whole DB.
#[derive(Clone, Debug, Default)]
pub struct ActiveVocabularyContext {
    pub entries: Vec<VocabularyEntry>,
    pub source_packs: Vec<VocabularyId>,
    pub application_context: Option<ApplicationContext>,
}

/// Global vocabulary settings (spec §15, §17).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularySettings {
    /// Automatic learning from user corrections (spec §17).
    pub learning_enabled: bool,
    /// Auto-correct at/above this similarity (spec §15).
    pub auto_correct_threshold: f32,
    /// Cautious correction band: only applied with corroborating context
    /// (another canonical vocabulary term nearby).
    pub cautious_correct_threshold: f32,
}

impl Default for VocabularySettings {
    fn default() -> Self {
        Self {
            learning_enabled: true,
            auto_correct_threshold: 0.92,
            cautious_correct_threshold: 0.80,
        }
    }
}

/// Cheap, collision-resistant-enough local id: nanos + atomic counter.
/// Vocabulary ids never leave the device (spec §24), so randomness quality
/// only needs to be unique-per-install, not unguessable.
pub fn new_id() -> VocabularyId {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("v_{nanos:016x}{counter:04x}")
}
