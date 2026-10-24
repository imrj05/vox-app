//! Vocabulary store + pack manager (spec §6, §19, §20, §23).
//!
//! Persistence is a single JSON document under the app data directory
//! (`vocabulary/vocabulary.json`) — the same "no heavy database unless needed"
//! approach the app uses elsewhere. All access is `&mut self`; ownership is
//! enforced by wrapping the store in a `Mutex` managed by Tauri (spec §23 —
//! the audio thread never mutates vocabulary state; it only reads through the
//! context builder inside the transcription command, which already runs off
//! the audio path).
//!
//! Built-in packs are compiled in (`builtin::builtin_packs`) and never
//! deserialized from disk; the persisted document only records their
//! enabled-flag and user packs. Users customize built-ins by duplicating them
//! (spec §20).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::builtin;
use super::learn::{self, LearnedCorrections};
use super::model::{
    AppVocabularyMapping, EntryCategory, PackCategory, Priority, VocabularyEntry, VocabularyId,
    VocabularyPack, VocabularySettings,
};

const CURRENT_VERSION: u32 = 1;

/// Persisted document. Fields are additive-friendly: unknown fields from
/// future versions are ignored via serde defaults, never crash.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VocabularyDocument {
    pub version: u32,
    /// Enabled-flags for built-in packs (spec §20).
    pub builtin_enabled: HashMap<VocabularyId, bool>,
    /// Fully user-owned packs.
    pub user_packs: Vec<VocabularyPack>,
    /// Entries the user added to read-only built-in packs, keyed by pack id.
    /// Built-in packs are regenerated from code on each launch, so user terms
    /// live here as a persistent overlay (spec §20).
    #[serde(default)]
    pub builtin_added_entries: HashMap<VocabularyId, Vec<VocabularyEntry>>,
    /// App → packs mappings (spec §9).
    pub app_mappings: Vec<AppVocabularyMapping>,
    /// Learned corrections (spec §17).
    pub learned: LearnedCorrections,
    pub settings: VocabularySettings,
}

pub struct VocabularyStore {
    path: PathBuf,
    pub document: VocabularyDocument,
    /// Bumped on every persisted mutation so caches can invalidate themselves
    /// without comparing full pack snapshots (spec §22).
    pub generation: u64,
}

/// Wire format for import/export (spec §19).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackExport {
    pub version: u32,
    pub pack: ExportedPack,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedPack {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub entries: Vec<ExportedEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedEntry {
    pub canonical: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub pronunciation_variants: Vec<String>,
    #[serde(default)]
    pub priority: u8,
    #[serde(default)]
    pub category: Option<String>,
}

impl VocabularyStore {
    /// Load from disk, creating an empty document when absent. Corrupt files
    /// are quarantined (renamed with a `.corrupt` suffix) and replaced with a
    /// fresh document — malformed data must never crash the app (spec §19).
    pub fn load(app_data_dir: &Path) -> Self {
        let dir = app_data_dir.join("vocabulary");
        let path = dir.join("vocabulary.json");
        let document = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<VocabularyDocument>(&bytes) {
                Ok(mut doc) => {
                    if doc.version > CURRENT_VERSION {
                        // Forward-compat: accept but keep version stamp so we
                        // never rewrite newer fields we don't understand.
                        doc.version = CURRENT_VERSION;
                    }
                    doc
                }
                Err(error) => {
                    eprintln!(
                        "[VOX][vocabulary] persisted vocabulary is invalid ({error}); starting fresh"
                    );
                    let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
                    VocabularyDocument {
                        version: CURRENT_VERSION,
                        ..Default::default()
                    }
                }
            },
            Err(_) => VocabularyDocument {
                version: CURRENT_VERSION,
                ..Default::default()
            },
        };
        Self {
            path,
            document,
            generation: 0,
        }
    }

    pub fn persist(&mut self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create vocabulary directory: {error}"))?;
        }
        let bytes = serde_json::to_vec_pretty(&self.document)
            .map_err(|error| format!("Vocabulary serialization failed: {error}"))?;
        // Atomic write: temp file + rename, so a crash mid-write can't
        // corrupt the user's vocabulary.
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, &bytes)
            .and_then(|_| std::fs::rename(&temp, &self.path))
            .map_err(|error| format!("Failed to persist vocabulary: {error}"))?;
        self.generation = self.generation.wrapping_add(1);
        Ok(())
    }

    // ── Pack access ──────────────────────────────────────────────────────

    /// Built-in packs (with persisted enabled-flags) + user packs.
    pub fn all_packs(&self) -> Vec<VocabularyPack> {
        let mut packs = builtin::builtin_packs();
        for pack in &mut packs {
            if let Some(enabled) = self.document.builtin_enabled.get(&pack.id) {
                pack.enabled = *enabled;
            }
            // User-added overlay entries (marked so the UI can make them
            // editable while compiled-in terms stay read-only).
            if let Some(overlay) = self.document.builtin_added_entries.get(&pack.id) {
                for mut entry in overlay.iter().cloned() {
                    entry.user_added = true;
                    pack.entries.push(entry);
                }
            }
        }
        // Personal pack (spec §18) — user-owned, materialized on read when it
        // has never been persisted.
        if !self
            .document
            .user_packs
            .iter()
            .any(|p| p.id == builtin::ids::PERSONAL)
        {
            packs.push(builtin::personal_pack());
        }
        packs.extend(self.document.user_packs.iter().cloned());
        packs
    }

    pub fn pack(&self, pack_id: &str) -> Option<VocabularyPack> {
        self.all_packs().into_iter().find(|p| p.id == pack_id)
    }

    fn user_pack_mut(&mut self, pack_id: &str) -> Result<&mut VocabularyPack, String> {
        self.document
            .user_packs
            .iter_mut()
            .find(|p| p.id == pack_id)
            .ok_or_else(|| {
                "Pack not found or is read-only (duplicate it to customize built-ins)".to_string()
            })
    }

    /// The Personal pack (spec §18) is user-owned even though its id is in the
    /// `builtin-*` namespace for stability across upgrades.
    fn ensure_personal_pack(&mut self) {
        if !self
            .document
            .user_packs
            .iter()
            .any(|p| p.id == builtin::ids::PERSONAL)
        {
            self.document.user_packs.push(builtin::personal_pack());
        }
    }

    // ── Pack CRUD (spec §6, §20) ─────────────────────────────────────────

    pub fn create_pack(
        &mut self,
        name: String,
        description: String,
        category: PackCategory,
    ) -> Result<VocabularyPack, String> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Pack name cannot be empty".to_string());
        }
        if self
            .all_packs()
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(&name))
        {
            return Err(format!("A pack named \"{name}\" already exists"));
        }
        let pack = VocabularyPack {
            id: super::model::new_id(),
            name,
            description,
            category,
            is_built_in: false,
            enabled: true,
            entries: Vec::new(),
            target_applications: Vec::new(),
            priority: Priority::Normal.weight(),
        };
        self.document.user_packs.push(pack.clone());
        Ok(pack)
    }

    /// Duplicate any pack (including built-ins) into an editable copy
    /// (spec §20).
    pub fn duplicate_pack(&mut self, pack_id: &str) -> Result<VocabularyPack, String> {
        let source = self
            .pack(pack_id)
            .ok_or_else(|| "Pack not found".to_string())?;
        let mut name = format!("My {} Vocabulary", source.name);
        let mut suffix = 2;
        while self.all_packs().iter().any(|p| p.name == name) {
            name = format!("My {} Vocabulary {suffix}", source.name);
            suffix += 1;
        }
        let pack = VocabularyPack {
            id: super::model::new_id(),
            name,
            description: source.description,
            category: source.category,
            is_built_in: false,
            enabled: true,
            entries: source
                .entries
                .iter()
                .map(|entry| {
                    let mut copy = entry.clone();
                    copy.id = super::model::new_id();
                    copy
                })
                .collect(),
            target_applications: Vec::new(),
            priority: source.priority,
        };
        self.document.user_packs.push(pack.clone());
        Ok(pack)
    }

    pub fn delete_pack(&mut self, pack_id: &str) -> Result<(), String> {
        let is_builtin = pack_id.starts_with("builtin-");
        if is_builtin {
            return Err("Built-in packs cannot be deleted — disable them instead".to_string());
        }
        let before = self.document.user_packs.len();
        self.document.user_packs.retain(|p| p.id != pack_id);
        if self.document.user_packs.len() == before {
            return Err("Pack not found".to_string());
        }
        self.document
            .app_mappings
            .iter_mut()
            .for_each(|m| m.pack_ids.retain(|id| id != pack_id));
        Ok(())
    }

    pub fn set_pack_enabled(&mut self, pack_id: &str, enabled: bool) -> Result<(), String> {
        if pack_id.starts_with("builtin-") {
            self.document
                .builtin_enabled
                .insert(pack_id.to_string(), enabled);
            return Ok(());
        }
        self.user_pack_mut(pack_id)?.enabled = enabled;
        Ok(())
    }

    pub fn update_pack(
        &mut self,
        pack_id: &str,
        name: String,
        description: String,
    ) -> Result<(), String> {
        let pack = self.user_pack_mut(pack_id)?;
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Pack name cannot be empty".to_string());
        }
        pack.name = name;
        pack.description = description;
        Ok(())
    }

    // ── Entry CRUD (spec §6) ─────────────────────────────────────────────

    pub fn upsert_entry(
        &mut self,
        pack_id: &str,
        mut entry: VocabularyEntry,
    ) -> Result<VocabularyEntry, String> {
        entry.canonical = entry.canonical.trim().to_string();
        if entry.canonical.is_empty() {
            return Err("Term cannot be empty".to_string());
        }
        entry.aliases.retain(|alias| !alias.trim().is_empty());
        entry
            .pronunciation_variants
            .retain(|variant| !variant.trim().is_empty());

        let canonical_key = entry.canonical.to_lowercase();
        let entry_id = entry.id.clone();

        // Duplicate detection (case-insensitive canonical) across the full
        // effective pack — compiled-in terms included — excluding self.
        let duplicate = self
            .pack(pack_id)
            .ok_or_else(|| "Pack not found".to_string())?
            .entries
            .iter()
            .any(|e| e.id != entry_id && e.canonical.to_lowercase() == canonical_key);
        if duplicate {
            return Err(format!("\"{}\" is already in this pack", entry.canonical));
        }

        // User-owned packs: entries live in the persisted pack itself.
        if !builtin::is_read_only_pack(pack_id) {
            self.ensure_personal_pack();
            let pack = self.user_pack_mut(pack_id)?;
            match pack.entry_mut(&entry_id) {
                Some(existing) => {
                    entry.user_added = true;
                    *existing = entry.clone();
                }
                None => {
                    entry.id = super::model::new_id();
                    entry.user_added = true;
                    pack.entries.push(entry.clone());
                }
            }
            return Ok(entry);
        }

        // Read-only built-in pack: user-added entries live in the persistent
        // overlay and stay editable; compiled-in terms remain read-only.
        let is_compiled = entry_id
            .trim()
            .is_empty()
            .then_some(false)
            .unwrap_or_else(|| {
                self.pack(pack_id)
                    .map(|pack| pack.entries.iter().any(|e| e.id == entry_id))
                    .unwrap_or(false)
            });
        let overlay = self
            .document
            .builtin_added_entries
            .entry(pack_id.to_string())
            .or_default();
        match overlay.iter_mut().find(|e| e.id == entry_id) {
            Some(existing) => {
                entry.user_added = true;
                *existing = entry.clone();
                Ok(entry)
            }
            None if is_compiled => {
                Err("Built-in terms are read-only — duplicate the pack to edit them".to_string())
            }
            // Empty id (fresh add) or unknown id (defensive): create it.
            None => {
                entry.id = super::model::new_id();
                entry.user_added = true;
                overlay.push(entry.clone());
                Ok(entry)
            }
        }
    }

    pub fn delete_entry(&mut self, pack_id: &str, entry_id: &str) -> Result<(), String> {
        if !builtin::is_read_only_pack(pack_id) {
            self.ensure_personal_pack();
            let pack = self.user_pack_mut(pack_id)?;
            let before = pack.entries.len();
            pack.entries.retain(|e| e.id != entry_id);
            if pack.entries.len() == before {
                return Err("Term not found".to_string());
            }
            return Ok(());
        }

        // Built-in pack: user-added overlay entries are removable; compiled-in
        // terms are not.
        if let Some(overlay) = self.document.builtin_added_entries.get_mut(pack_id) {
            let before = overlay.len();
            overlay.retain(|e| e.id != entry_id);
            if overlay.len() != before {
                return Ok(());
            }
        }
        Err("Built-in terms are read-only — duplicate the pack to remove them".to_string())
    }

    pub fn set_entry_enabled(
        &mut self,
        pack_id: &str,
        entry_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        if !builtin::is_read_only_pack(pack_id) {
            self.ensure_personal_pack();
            self.user_pack_mut(pack_id)?
                .entry_mut(entry_id)
                .ok_or_else(|| "Term not found".to_string())?
                .enabled = enabled;
            return Ok(());
        }

        // Built-in pack: enable/disable works for user-added overlay entries
        // (their state is persisted); compiled-in terms are not toggleable.
        let overlay = self
            .document
            .builtin_added_entries
            .get_mut(pack_id)
            .ok_or_else(|| "Built-in terms are read-only".to_string())?;
        overlay
            .iter_mut()
            .find(|e| e.id == entry_id)
            .ok_or_else(|| "Built-in terms are read-only".to_string())?
            .enabled = enabled;
        Ok(())
    }

    // ── App mappings (spec §9) ───────────────────────────────────────────

    pub fn set_app_mapping(
        &mut self,
        app: super::model::ApplicationIdentifier,
        pack_ids: Vec<VocabularyId>,
    ) {
        let mapping = AppVocabularyMapping {
            app,
            pack_ids: pack_ids.into_iter().collect(),
        };
        match self
            .document
            .app_mappings
            .iter_mut()
            .find(|m| m.app.id.eq_ignore_ascii_case(&mapping.app.id))
        {
            Some(existing) => existing.pack_ids = mapping.pack_ids,
            None => self.document.app_mappings.push(mapping),
        }
    }

    // ── Learning (spec §17) ──────────────────────────────────────────────

    pub fn record_correction(
        &mut self,
        source: &str,
        entry_id: &str,
        confidence: f32,
        now_secs: u64,
    ) {
        if !self.document.settings.learning_enabled {
            return;
        }
        self.ensure_personal_pack();

        learn::record(
            &mut self.document.learned,
            source,
            entry_id,
            confidence,
            now_secs,
        );

        // Bump usage stats on the target entry wherever it lives — user packs
        // and the Personal pack are persisted, built-ins are not (their boost
        // comes from the learned map at context-build time).
        let bumped = self
            .document
            .user_packs
            .iter_mut()
            .find_map(|pack| {
                pack.entry_mut(entry_id).map(|entry| {
                    entry.use_count = entry.use_count.saturating_add(1);
                    entry.last_used_at = Some(now_secs);
                })
            })
            .is_some();
        if bumped {
            return;
        }

        // The correction target may be a compiled-in built-in entry (stable
        // ids) whose usage stats cannot persist in a user pack — mirror it
        // into the Personal pack so learning still accumulates.
        if let Some(canonical) = self
            .all_packs()
            .iter()
            .flat_map(|pack| pack.entries.iter())
            .find(|entry| entry.id == entry_id)
            .filter(|entry| entry.user_added == false)
            .filter(|entry| {
                // Already handled above if the entry lives in a persisted pack.
                !self
                    .document
                    .user_packs
                    .iter()
                    .any(|pack| pack.entry(&entry.id).is_some())
            })
            .map(|entry| entry.canonical.clone())
        {
            let personal = self
                .document
                .user_packs
                .iter_mut()
                .find(|p| p.id == builtin::ids::PERSONAL)
                .expect("personal pack ensured");
            match personal
                .entries
                .iter_mut()
                .find(|e| e.canonical.eq_ignore_ascii_case(&canonical))
            {
                Some(mirror) => {
                    mirror.use_count = mirror.use_count.saturating_add(1);
                    mirror.last_used_at = Some(now_secs);
                }
                None => {
                    let mut mirror = VocabularyEntry::new(canonical);
                    let alias = source.trim().to_lowercase();
                    if !alias.is_empty() {
                        mirror.aliases.push(alias);
                    }
                    mirror.use_count = 1;
                    mirror.last_used_at = Some(now_secs);
                    personal.entries.push(mirror);
                }
            }
            return;
        }

        // The corrected form is unknown to the vocabulary: learn it as a new
        // Personal term (spec §18). Repeated learnings strengthen the entry's
        // usage statistics via the map above.
        let source = source.trim();
        if source.is_empty() {
            return;
        }
        let personal = self
            .document
            .user_packs
            .iter_mut()
            .find(|p| p.id == builtin::ids::PERSONAL)
            .expect("personal pack ensured");
        let existing = personal
            .entries
            .iter_mut()
            .find(|e| e.canonical.eq_ignore_ascii_case(source));
        match existing {
            Some(entry) => {
                entry.use_count = entry.use_count.saturating_add(1);
                entry.last_used_at = Some(now_secs);
            }
            None => {
                let mut entry = VocabularyEntry::new(source.to_string());
                entry.aliases.push(source.to_lowercase());
                entry.use_count = 1;
                entry.last_used_at = Some(now_secs);
                entry.category = EntryCategory::General;
                personal.entries.push(entry);
            }
        }
    }

    /// Teach a correction (spec §17): map a raw heard form to a canonical
    /// form for all future dictations.
    ///
    /// * Canonical term already in a persisted (user/Personal) pack → the
    ///   heard form is added as an alias and usage stats rise.
    /// * Canonical term exists only in a read-only built-in pack → a
    ///   Personal-pack mirror entry is created so usage stats persist.
    /// * Unknown term → a new Personal-pack entry is created with the heard
    ///   form as its alias.
    ///
    /// Returns the entry id the correction now maps to.
    pub fn teach_correction(
        &mut self,
        source: &str,
        canonical: &str,
        now: u64,
    ) -> Result<VocabularyId, String> {
        let source = source.trim();
        let canonical = canonical.trim();
        if source.is_empty() || canonical.is_empty() {
            return Err("Correction forms cannot be empty".to_string());
        }
        self.ensure_personal_pack();

        // 1. Canonical term in a persisted pack: attach alias + bump stats.
        let persisted_match = self.document.user_packs.iter_mut().find_map(|pack| {
            let entry = pack
                .entries
                .iter_mut()
                .find(|e| e.canonical.eq_ignore_ascii_case(canonical))?;
            let alias = source.to_lowercase();
            if !alias.is_empty() && !entry.aliases.iter().any(|a| a.eq_ignore_ascii_case(&alias)) {
                entry.aliases.push(alias);
            }
            entry.use_count = entry.use_count.saturating_add(1);
            entry.last_used_at = Some(now);
            Some(entry.id.clone())
        });
        if let Some(id) = persisted_match {
            learn::record(&mut self.document.learned, source, &id, 1.0, now);
            return Ok(id);
        }

        // 2/3. No persisted term: create a Personal entry (canonical + heard
        // alias) — this covers unknown terms AND mirrors of read-only
        // built-in terms, so usage statistics always persist.
        let mut entry = VocabularyEntry::new(canonical.to_string());
        let alias = source.to_lowercase();
        if !alias.is_empty() {
            entry.aliases.push(alias);
        }
        entry.use_count = 1;
        entry.last_used_at = Some(now);
        let stored = self.upsert_entry(builtin::ids::PERSONAL, entry)?;
        learn::record(&mut self.document.learned, source, &stored.id, 1.0, now);
        Ok(stored.id)
    }

    // ── Legacy dictionary migration ──────────────────────────────────────

    /// Import the legacy free-text personal dictionary ("word | hint |
    /// category" lines, comma-separated bulk lines) into the Personal pack.
    /// Idempotent: existing canonicals (case-insensitive) are skipped, so it
    /// is safe to call repeatedly. Returns the number of entries created.
    pub fn migrate_dictionary(&mut self, dictionary: &str) -> Result<usize, String> {
        self.ensure_personal_pack();
        let mut created = 0usize;
        for line in dictionary.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let (word, hint, category) = if line.contains('|') {
                let parts: Vec<&str> = line.split('|').map(str::trim).collect();
                (
                    parts.first().copied().unwrap_or_default(),
                    parts.get(1).copied().unwrap_or_default(),
                    parts.get(2).copied().unwrap_or_default(),
                )
            } else {
                // Bulk line: comma-separated plain words.
                for word in line.split(',').map(str::trim).filter(|w| !w.is_empty()) {
                    if self.personal_has_canonical(word) {
                        continue;
                    }
                    let mut entry = VocabularyEntry::new(word.to_string());
                    entry.category = EntryCategory::General;
                    entry.use_count = 1;
                    self.upsert_entry(builtin::ids::PERSONAL, entry)?;
                    created += 1;
                }
                continue;
            };
            if word.is_empty() || self.personal_has_canonical(word) {
                continue;
            }
            let mut entry = VocabularyEntry::new(word.to_string());
            if !hint.is_empty() {
                entry.pronunciation_variants.push(hint.to_string());
            }
            entry.category = match category {
                "People" => EntryCategory::Person,
                "Product" => EntryCategory::Product,
                "Technical" => EntryCategory::Technical,
                "Company" => EntryCategory::Company,
                _ => EntryCategory::General,
            };
            entry.use_count = 1;
            self.upsert_entry(builtin::ids::PERSONAL, entry)?;
            created += 1;
        }
        Ok(created)
    }

    fn personal_has_canonical(&self, canonical: &str) -> bool {
        self.pack(builtin::ids::PERSONAL)
            .map(|pack| {
                pack.entries
                    .iter()
                    .any(|e| e.canonical.eq_ignore_ascii_case(canonical.trim()))
            })
            .unwrap_or(false)
    }

    // ── Import / export (spec §19) ───────────────────────────────────────

    pub fn export_pack(&self, pack_id: &str) -> Result<PackExport, String> {
        let pack = self
            .pack(pack_id)
            .ok_or_else(|| "Pack not found".to_string())?;
        Ok(PackExport {
            version: CURRENT_VERSION,
            pack: ExportedPack {
                name: pack.name,
                description: pack.description,
                category: pack.category.as_str().to_string(),
                entries: pack
                    .entries
                    .iter()
                    .map(|entry| ExportedEntry {
                        canonical: entry.canonical.clone(),
                        aliases: entry.aliases.clone(),
                        pronunciation_variants: entry.pronunciation_variants.clone(),
                        priority: entry.priority,
                        category: Some(entry.category.as_str().to_string()),
                    })
                    .collect(),
            },
        })
    }

    /// Import a pack from JSON text. Validates everything; malformed data
    /// returns `Err` and never crashes (spec §19). Duplicate canonical terms
    /// within the file are merged; duplicates against existing user packs are
    /// kept (packs are independent namespaces).
    pub fn import_pack(&mut self, json: &str) -> Result<VocabularyPack, String> {
        let export: PackExport = serde_json::from_str(json)
            .map_err(|error| format!("Invalid vocabulary file: {error}"))?;
        if export.version > CURRENT_VERSION {
            return Err(format!(
                "Vocabulary file version {} is newer than this app supports",
                export.version
            ));
        }
        let name = export.pack.name.trim().to_string();
        if name.is_empty() {
            return Err("Pack name cannot be empty".to_string());
        }
        let category = parse_pack_category(&export.pack.category);

        let mut entries: Vec<VocabularyEntry> = Vec::new();
        let mut seen: HashMap<String, usize> = HashMap::new();
        for imported in export.pack.entries {
            let canonical = imported.canonical.trim().to_string();
            if canonical.is_empty() {
                continue;
            }
            let key = canonical.to_lowercase();
            let mut entry = VocabularyEntry::new(canonical);
            entry.aliases = imported
                .aliases
                .into_iter()
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty())
                .collect();
            entry.pronunciation_variants = imported
                .pronunciation_variants
                .into_iter()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect();
            entry.priority = imported.priority.min(100);
            if let Some(category) = imported.category.as_deref() {
                entry.category = parse_entry_category(category);
            }
            // Graceful duplicate handling: merge aliases into the first copy.
            if let Some(&index) = seen.get(&key) {
                for alias in entry.aliases {
                    if !entries[index].aliases.contains(&alias) {
                        entries[index].aliases.push(alias);
                    }
                }
                continue;
            }
            seen.insert(key, entries.len());
            entries.push(entry);
        }

        // De-duplicate against the user's existing packs by renaming.
        let mut final_name = name.clone();
        let mut suffix = 2;
        while self
            .all_packs()
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(&final_name))
        {
            final_name = format!("{name} (imported {suffix})");
            suffix += 1;
        }

        let pack = VocabularyPack {
            id: super::model::new_id(),
            name: final_name,
            description: export.pack.description,
            category,
            is_built_in: false,
            enabled: true,
            entries,
            target_applications: Vec::new(),
            priority: Priority::Normal.weight(),
        };
        self.document.user_packs.push(pack.clone());
        Ok(pack)
    }
}

fn parse_entry_category(value: &str) -> EntryCategory {
    match value {
        "programming-language" => EntryCategory::ProgrammingLanguage,
        "framework" => EntryCategory::Framework,
        "library" => EntryCategory::Library,
        "tool" => EntryCategory::Tool,
        "product" => EntryCategory::Product,
        "company" => EntryCategory::Company,
        "person" => EntryCategory::Person,
        "place" => EntryCategory::Place,
        "acronym" => EntryCategory::Acronym,
        "technical" => EntryCategory::Technical,
        _ => EntryCategory::General,
    }
}

fn parse_pack_category(value: &str) -> PackCategory {
    match value {
        "developer" => PackCategory::Developer,
        "technology" => PackCategory::Technology,
        "business" => PackCategory::Business,
        "finance" => PackCategory::Finance,
        "medical" => PackCategory::Medical,
        "legal" => PackCategory::Legal,
        "marketing" => PackCategory::Marketing,
        "gaming" => PackCategory::Gaming,
        "personal" => PackCategory::Personal,
        _ => PackCategory::Custom,
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn temp_dir() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("vox-vocab-test-{}-{unique}", std::process::id()))
    }

    #[test]
    fn load_persists_and_reloads() {
        let dir = temp_dir();
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = VocabularyStore::load(&dir);
        let pack = store
            .create_pack("Team Terms".into(), "work".into(), PackCategory::Custom)
            .unwrap();
        store
            .upsert_entry(&pack.id, VocabularyEntry::new("Acme"))
            .unwrap();
        store.persist().unwrap();

        let reloaded = VocabularyStore::load(&dir);
        let pack = reloaded.pack(&pack.id).unwrap();
        assert_eq!(pack.entries.len(), 1);
        assert_eq!(pack.entries[0].canonical, "Acme");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_never_crashes() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.join("vocabulary")).unwrap();
        std::fs::write(dir.join("vocabulary/vocabulary.json"), b"{not json").unwrap();
        let store = VocabularyStore::load(&dir);
        assert!(store
            .all_packs()
            .iter()
            .any(|p| p.id == builtin::ids::DEVELOPER));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn builtin_packs_are_read_only_but_duplicable() {
        let mut store = VocabularyStore::load(&temp_dir());
        // Editing a compiled-in built-in term (by its real id) is refused.
        let compiled_id = store
            .pack(builtin::ids::DEVELOPER)
            .unwrap()
            .entries
            .first()
            .unwrap()
            .id
            .clone();
        let mut hacked = VocabularyEntry::new("Hacked");
        hacked.id = compiled_id;
        assert!(store.upsert_entry(builtin::ids::DEVELOPER, hacked).is_err());

        // But *adding* a new term to a built-in pack works (persisted overlay).
        let added = store
            .upsert_entry(builtin::ids::DEVELOPER, VocabularyEntry::new("MyTool"))
            .unwrap();
        assert!(added.user_added);
        assert_eq!(
            added.id,
            store
                .pack(builtin::ids::DEVELOPER)
                .unwrap()
                .entries
                .last()
                .unwrap()
                .id
        );

        let copy = store.duplicate_pack(builtin::ids::DEVELOPER).unwrap();
        assert!(!copy.is_built_in);
        assert!(copy.entries.len() > 50);
        store
            .upsert_entry(&copy.id, VocabularyEntry::new("MyTerm"))
            .unwrap();
        assert_eq!(
            store.pack(&copy.id).unwrap().entries.len(),
            copy.entries.len() + 1
        );
    }

    #[test]
    fn import_validates_and_merges_duplicates() {
        let mut store = VocabularyStore::load(&temp_dir());
        let good = r#"{
            "version": 1,
            "pack": {
                "name": "Team",
                "category": "custom",
                "entries": [
                    {"canonical": "Acme", "aliases": ["ack mi"], "priority": 75},
                    {"canonical": "Acme", "aliases": ["akmi"], "priority": 75},
                    {"canonical": "", "aliases": []},
                    {"canonical": "Internal API", "aliases": []}
                ]
            }
        }"#;
        let pack = store.import_pack(good).unwrap();
        assert_eq!(pack.entries.len(), 2); // empty canonical dropped, Acme merged
        assert_eq!(pack.entries[0].aliases, vec!["ack mi", "akmi"]);

        let malformed = r#"{"version": 1, "pack": {"name": "", "entries": []}}"#;
        assert!(store.import_pack(malformed).is_err());
        let garbage = "not json at all";
        assert!(store.import_pack(garbage).is_err());

        // Round-trip.
        let exported = store.export_pack(&pack.id).unwrap();
        let json = serde_json::to_string(&exported).unwrap();
        let reimported = store.import_pack(&json).unwrap();
        assert!(reimported.name.contains("imported"));
    }

    #[test]
    fn personal_pack_is_editable_despite_builtin() {
        let mut store = VocabularyStore::load(&temp_dir());
        let entry = VocabularyEntry::new("Rajesh");
        store
            .upsert_entry(builtin::ids::PERSONAL, entry)
            .expect("personal pack must be editable");
        assert_eq!(store.pack(builtin::ids::PERSONAL).unwrap().entries.len(), 1);
    }

    #[test]
    fn learned_corrections_promote_to_personal() {
        let mut store = VocabularyStore::load(&temp_dir());
        store.record_correction("shad can", "unknown-entry", 0.95, 1000);
        let personal = store.pack(builtin::ids::PERSONAL).unwrap();
        assert!(personal
            .entries
            .iter()
            .any(|e| e.canonical == "shad can" && e.use_count == 1));
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use crate::vocabulary::builtin;

    #[test]
    fn migrates_legacy_dictionary_into_personal() {
        let mut store = VocabularyStore::load(&super::tests::temp_dir());
        // Same parsing as the legacy frontend parser: pipe lines are single
        // hinted entries; comma lines are bulk plain words.
        let legacy =
            "Supabase\nNext.js | next jay ess | Product\nRajesh | | People\nAcme, Zeta Corp";
        let created = store.migrate_dictionary(legacy).unwrap();
        assert_eq!(created, 5);

        let personal = store.pack(builtin::ids::PERSONAL).unwrap();
        assert!(personal.entries.iter().any(|e| e.canonical == "Supabase"));
        let next = personal
            .entries
            .iter()
            .find(|e| e.canonical == "Next.js")
            .unwrap();
        assert_eq!(next.pronunciation_variants, vec!["next jay ess"]);
        assert_eq!(next.category, EntryCategory::Product);
        assert!(personal
            .entries
            .iter()
            .any(|e| e.canonical == "Rajesh" && e.category == EntryCategory::Person));
        assert!(personal.entries.iter().any(|e| e.canonical == "Acme"));
        assert!(personal.entries.iter().any(|e| e.canonical == "Zeta Corp"));

        // Idempotent: a second pass creates nothing.
        assert_eq!(store.migrate_dictionary(legacy).unwrap(), 0);
    }
}

#[cfg(test)]
mod teach_tests {
    use super::*;
    use crate::vocabulary::builtin;

    #[test]
    fn teaching_unknown_term_creates_personal_entry_with_alias() {
        let mut store = VocabularyStore::load(&super::tests::temp_dir());
        let id = store.teach_correction("shad can", "shadcn", 1000).unwrap();
        let personal = store.pack(builtin::ids::PERSONAL).unwrap();
        let entry = personal.entries.iter().find(|e| e.id == id).unwrap();
        assert_eq!(entry.canonical, "shadcn");
        assert_eq!(entry.aliases, vec!["shad can"]);
        assert_eq!(entry.use_count, 1);
        // The learned-correction map carries the pair with one occurrence.
        let learned = &store.document.learned;
        let key = crate::vocabulary::learn::correction_key("shad can", &id);
        assert_eq!(learned[&key].occurrence_count, 1);

        // A second teach of the same pair reuses the entry (no duplicate).
        let id2 = store.teach_correction("shad can", "shadcn", 2000).unwrap();
        assert_eq!(id, id2);
        assert_eq!(store.pack(builtin::ids::PERSONAL).unwrap().entries.len(), 1);
        let key = crate::vocabulary::learn::correction_key("shad can", &id);
        assert_eq!(store.document.learned[&key].occurrence_count, 2);
    }

    #[test]
    fn teaching_known_term_records_against_it() {
        let mut store = VocabularyStore::load(&super::tests::temp_dir());
        // Park an existing term in the Personal pack.
        store.ensure_personal_pack();
        store
            .upsert_entry(builtin::ids::PERSONAL, VocabularyEntry::new("TypeScript"))
            .unwrap();
        let id = store
            .teach_correction("type script", "TypeScript", 1000)
            .unwrap();
        let updated = store
            .pack(builtin::ids::PERSONAL)
            .unwrap()
            .entries
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .expect("known term must be reused, not duplicated");
        assert_eq!(updated.canonical, "TypeScript");
        // The heard form becomes an alias; only one entry exists.
        assert_eq!(updated.aliases, vec!["type script"]);
        assert_eq!(updated.use_count, 1);
        assert_eq!(store.pack(builtin::ids::PERSONAL).unwrap().entries.len(), 1);
    }
}

#[cfg(test)]
mod builtin_overlay_tests {
    use super::tests::temp_dir;
    use super::*;
    use crate::vocabulary::builtin;

    #[test]
    fn user_terms_added_to_builtin_packs_persist_across_reload() {
        let dir = temp_dir();
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = VocabularyStore::load(&dir);
        let added = store
            .upsert_entry(builtin::ids::DEVELOPER, VocabularyEntry::new("VoxCli"))
            .unwrap();
        assert!(added.user_added);
        store.persist().unwrap();

        let reloaded = VocabularyStore::load(&dir);
        let pack = reloaded.pack(builtin::ids::DEVELOPER).unwrap();
        let entry = pack.entries.iter().find(|e| e.id == added.id).unwrap();
        assert_eq!(entry.canonical, "VoxCli");
        assert!(entry.user_added);

        // Editing and disabling the user-added entry works.
        let mut edited = entry.clone();
        edited.aliases.push("vox cli".into());
        store.upsert_entry(builtin::ids::DEVELOPER, edited).unwrap();
        store
            .set_entry_enabled(builtin::ids::DEVELOPER, &added.id, false)
            .unwrap();
        let pack = store.pack(builtin::ids::DEVELOPER).unwrap();
        let entry = pack.entry(&added.id).unwrap();
        assert_eq!(entry.aliases, vec!["vox cli"]);
        assert!(!entry.enabled);
        // Toggling a compiled-in term is still refused.
        let compiled_id = pack.entries.first().unwrap().id.clone();
        assert!(store
            .set_entry_enabled(builtin::ids::DEVELOPER, &compiled_id, false)
            .is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_detection_includes_compiled_terms() {
        let mut store = VocabularyStore::load(&temp_dir());
        let err = store
            .upsert_entry(builtin::ids::DEVELOPER, VocabularyEntry::new("shadcn"))
            .err()
            .expect("duplicate canonical must be rejected");
        assert!(err.contains("already in this pack"));
    }

    #[test]
    fn user_added_builtin_entries_are_removable() {
        let mut store = VocabularyStore::load(&temp_dir());
        let added = store
            .upsert_entry(builtin::ids::DEVELOPER, VocabularyEntry::new("Temp"))
            .unwrap();
        store
            .delete_entry(builtin::ids::DEVELOPER, &added.id)
            .unwrap();
        assert!(!store
            .pack(builtin::ids::DEVELOPER)
            .unwrap()
            .entries
            .iter()
            .any(|e| e.id == added.id));
        // Compiled-in terms still refuse deletion.
        let compiled_id = store
            .pack(builtin::ids::DEVELOPER)
            .unwrap()
            .entries
            .first()
            .unwrap()
            .id
            .clone();
        assert!(store
            .delete_entry(builtin::ids::DEVELOPER, &compiled_id)
            .is_err());
    }
}
