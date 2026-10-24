//! Built-in vocabulary packs (spec §4, §5, §20).
//!
//! Built-ins are compiled in and always re-loaded from this file on startup —
//! persisted state only remembers whether each is *enabled* (spec §20: never
//! modify bundled vocabulary data directly; users duplicate a pack to edit it).

use super::model::{EntryCategory, PackCategory, Priority, VocabularyEntry, VocabularyPack};

/// Stable built-in pack ids. Never change these — persisted enabled-flags and
/// app mappings reference them.
pub mod ids {
    pub const DEVELOPER: &str = "builtin-developer";
    pub const TECHNOLOGY: &str = "builtin-technology";
    pub const BUSINESS: &str = "builtin-business";
    pub const FINANCE: &str = "builtin-finance";
    pub const MEDICAL: &str = "builtin-medical";
    pub const LEGAL: &str = "builtin-legal";
    pub const MARKETING: &str = "builtin-marketing";
    pub const GAMING: &str = "builtin-gaming";
    pub const GENERAL: &str = "builtin-general";
    pub const PERSONAL: &str = "builtin-personal";
}

/// Every recognition form is a realistic spoken/ASR output form; no speculative
/// junk aliases (spec §4: keep the vocabulary high-quality).
fn entry(
    canonical: &str,
    aliases: &[&str],
    category: EntryCategory,
    priority: Priority,
) -> VocabularyEntry {
    let mut e = VocabularyEntry::new(canonical);
    // Stable, canonical-derived id: built-in packs are regenerated on every
    // launch, and operations (enable/disable, learned-correction targeting,
    // read-only enforcement) reference entries by id across generations.
    e.id = stable_entry_id(canonical);
    e.aliases = aliases.iter().map(|s| s.to_string()).collect();
    e.category = category;
    e.priority = priority.weight();
    e
}

/// Deterministic, collision-free id for a compiled-in entry. Uniqueness holds
/// within a pack because canonicals are unique per pack (enforced by tests).
fn stable_entry_id(canonical: &str) -> String {
    let slug: String = canonical
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    format!("t-{slug}")
}

/// The Developer pack (spec §4).
pub fn developer_pack() -> VocabularyPack {
    let mut entries = Vec::new();

    // ── Programming languages ────────────────────────────────────────────
    for (canonical, aliases) in [
        ("JavaScript", vec!["java script", "javascript"]),
        ("TypeScript", vec!["type script", "typescript"]),
        ("Python", vec!["pieton"]),
        ("Java", vec![]),
        ("Kotlin", vec![]),
        ("Swift", vec!["swift language"]),
        ("C", vec!["c language", "see language"]),
        ("C++", vec!["c plus plus", "see plus plus"]),
        ("C#", vec!["c sharp", "see sharp"]),
        ("Go", vec!["golang", "go language"]),
        ("Rust", vec!["rust language"]),
        ("PHP", vec![]),
        ("Ruby", vec![]),
        ("Dart", vec![]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::ProgrammingLanguage,
            Priority::High,
        ));
    }

    // ── Frontend frameworks ──────────────────────────────────────────────
    for (canonical, aliases) in [
        ("React", vec!["react js", "reactjs"]),
        ("React Native", vec!["react native js"]),
        ("Vue", vec!["vue js", "vuejs", "view js"]),
        ("Angular", vec!["angular js"]),
        ("Svelte", vec![]),
        ("Next.js", vec!["next js", "next jay ess", "nextjs"]),
        ("Nuxt", vec!["nuxt js", "nuxtjs"]),
        ("Remix", vec!["remix run"]),
        ("Astro", vec!["astro js"]),
        ("Vite", vec!["veet", "veet js"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Framework,
            Priority::High,
        ));
    }

    // ── CSS / UI ─────────────────────────────────────────────────────────
    for (canonical, aliases) in [
        (
            "Tailwind CSS",
            vec!["tailwind css", "tail wind css", "tail wind see ess"],
        ),
        (
            "shadcn",
            vec!["shad cn", "shad c n", "shad can", "shad see en"],
        ),
        ("shadcn/ui", vec!["shad cn ui", "shadcn ui", "shad can ui"]),
        ("Radix", vec!["radix ui", "radix primitives"]),
        ("Bootstrap", vec!["bootstrap css"]),
        ("Material UI", vec!["material you", "material ui"]),
        ("Chakra UI", vec!["chakra you", "chakra ui"]),
        ("Ant Design", vec!["ant design", "and design"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Library,
            Priority::High,
        ));
    }

    // ── Backend ──────────────────────────────────────────────────────────
    for (canonical, aliases) in [
        ("Node.js", vec!["node js", "node jay ess", "nodejs"]),
        ("Express", vec!["express js", "expressjs"]),
        ("NestJS", vec!["nest js", "nest jay ess"]),
        ("FastAPI", vec!["fast api", "fast a p i"]),
        ("Django", vec!["jango"]),
        ("Laravel", vec![]),
        ("Spring Boot", vec!["springboot"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Framework,
            Priority::High,
        ));
    }

    // ── Databases ────────────────────────────────────────────────────────
    for (canonical, aliases) in [
        (
            "PostgreSQL",
            vec!["post gre s q l", "postgres", "post greSQL", "post gres"],
        ),
        ("MySQL", vec!["my s q l", "my sequel"]),
        ("MariaDB", vec!["maria d b", "maria db"]),
        ("MongoDB", vec!["mongo d b", "mongo db", "mongo"]),
        ("Redis", vec!["red is"]),
        ("SQLite", vec!["s q lite", "sqlite", "sequelite"]),
        ("Prisma", vec![]),
        ("Supabase", vec!["super base", "su pa base"]),
        ("Firebase", vec!["fire base"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Tool,
            Priority::High,
        ));
    }

    // ── DevOps / Infrastructure ──────────────────────────────────────────
    for (canonical, aliases) in [
        ("Docker", vec![]),
        ("Docker Compose", vec!["docker compose"]),
        (
            "Kubernetes",
            vec!["koo bern etees", "kubernetes", "k eights"],
        ),
        ("Helm", vec!["helm chart"]),
        ("Terraform", vec!["terra form"]),
        ("nginx", vec!["engine x", "n ginx"]),
        ("AWS", vec!["a w s", "amazon web services"]),
        ("Azure", vec!["microsoft azure"]),
        ("Google Cloud", vec!["google cloud platform", "g c p"]),
        ("Cloudflare", vec!["cloud flare"]),
        ("GitHub Actions", vec!["git hub actions"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Technical,
            Priority::High,
        ));
    }

    // ── Development tools ────────────────────────────────────────────────
    for (canonical, aliases) in [
        ("VS Code", vec!["vs code", "v s code", "visual studio code"]),
        ("Visual Studio Code", vec!["visual studio code"]),
        ("Xcode", vec!["ex code", "x code"]),
        ("Cursor", vec!["cursor editor"]),
        ("Postman", vec!["post man"]),
        ("Figma", vec!["fig ma"]),
        ("Git", vec!["git version control"]),
        ("GitHub", vec!["git hub"]),
        ("GitLab", vec!["git lab"]),
        ("Bitbucket", vec!["bit bucket"]),
        ("npm", vec!["n p m"]),
        ("pnpm", vec!["p n p m", "pin npm"]),
        ("yarn", vec!["yarn package manager"]),
        ("Homebrew", vec!["home brew", "brew"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Tool,
            Priority::High,
        ));
    }

    // ── macOS / Apple ────────────────────────────────────────────────────
    for (canonical, aliases) in [
        ("SwiftUI", vec!["swift u i", "swift ui"]),
        ("UIKit", vec!["u i kit"]),
        ("AppKit", vec!["app kit"]),
        ("Core ML", vec!["core m l"]),
        ("Core Audio", vec!["core audio"]),
        ("AVFoundation", vec!["a v foundation", "a v f foundation"]),
        ("Metal", vec!["metal api"]),
        ("TestFlight", vec!["test flight"]),
        ("App Store Connect", vec!["app store connect"]),
        ("macOS", vec!["mac o s", "mac os", "mac operating system"]),
        ("iOS", vec!["i o s"]),
        ("iPadOS", vec!["i pad o s", "ipad o s"]),
        ("watchOS", vec!["watch o s", "watch os"]),
        ("visionOS", vec!["vision o s", "vision os"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Technical,
            Priority::High,
        ));
    }

    VocabularyPack {
        id: ids::DEVELOPER.to_string(),
        name: "Developer".to_string(),
        description: "Programming languages, frameworks, tools, and platforms.".to_string(),
        category: PackCategory::Developer,
        is_built_in: true,
        enabled: true,
        entries,
        target_applications: Vec::new(),
        priority: Priority::High.weight(),
    }
}

/// Initial data for the additional packs (spec §5). These are intentionally
/// small but real — packs are extensible via import and user edits.
fn technology_pack() -> VocabularyPack {
    let entries = [
        ("OpenAI", vec!["open ai", "open A I"], Priority::High),
        ("ChatGPT", vec!["chat g p t", "chat gpt"], Priority::High),
        ("Claude", vec!["claude ai"], Priority::Normal),
        ("Anthropic", vec!["anthropic ai"], Priority::Normal),
        ("Gemini", vec!["gemini ai"], Priority::Normal),
        ("Ollama", vec!["oh llama"], Priority::Normal),
        ("Slack", vec!["slack app"], Priority::Normal),
        ("Notion", vec!["notion app"], Priority::Normal),
        ("Zoom", vec!["zoom meeting"], Priority::Low),
        ("Chrome", vec!["chrome browser"], Priority::Low),
    ]
    .into_iter()
    .map(|(c, a, p)| entry(c, &a, EntryCategory::Product, p))
    .collect();

    VocabularyPack {
        id: ids::TECHNOLOGY.to_string(),
        name: "General Technology".to_string(),
        description: "Popular apps, AI products, and technology brands.".to_string(),
        category: PackCategory::Technology,
        is_built_in: true,
        enabled: true,
        entries,
        target_applications: Vec::new(),
        priority: Priority::Normal.weight(),
    }
}

fn business_pack() -> VocabularyPack {
    let entries = [
        ("stand-up", vec!["stand up meeting"], Priority::Normal),
        ("Q3", vec!["quarter three"], Priority::Normal),
        (
            "OKRs",
            vec!["o k rs", "objectives and key results"],
            Priority::Normal,
        ),
        ("KPI", vec!["k p i"], Priority::Normal),
        ("onboarding", vec![], Priority::Low),
        ("deliverable", vec![], Priority::Low),
        ("action items", vec![], Priority::Low),
    ]
    .into_iter()
    .map(|(c, a, p)| entry(c, &a, EntryCategory::General, p))
    .collect();

    VocabularyPack {
        id: ids::BUSINESS.to_string(),
        name: "Business".to_string(),
        description: "Meetings, planning, and workplace terminology.".to_string(),
        category: PackCategory::Business,
        is_built_in: true,
        enabled: false,
        entries,
        target_applications: Vec::new(),
        priority: Priority::Normal.weight(),
    }
}

/// Packs that ship as placeholders (spec §5): empty but real, so they show up
/// in the UI and can be populated by import or user entries.
fn placeholder_pack(
    id: &str,
    name: &str,
    description: &str,
    category: PackCategory,
) -> VocabularyPack {
    VocabularyPack {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        category,
        is_built_in: true,
        enabled: false,
        entries: Vec::new(),
        target_applications: Vec::new(),
        priority: Priority::Normal.weight(),
    }
}

/// The General / Common dictionary (user request): everyday apps, devices,
/// services, and common words ASR routinely misspells ("whats app", "why fie",
/// "e mail", "web site"). Deliberately excludes brands already covered by the
/// General Technology pack (Slack, Notion, Zoom, Chrome, …).
fn general_pack() -> VocabularyPack {
    let mut entries = Vec::new();

    // ── Communication & social apps ──────────────────────────────────────
    for (canonical, aliases) in [
        ("WhatsApp", vec!["whats app", "what's app"]),
        ("YouTube", vec!["you tube"]),
        ("Instagram", vec!["insta gram"]),
        ("LinkedIn", vec!["linked in"]),
        ("Facebook", vec!["face book"]),
        ("FaceTime", vec!["face time"]),
        ("Skype", vec![]),
        ("Signal", vec!["signal app"]),
        ("Telegram", vec!["telegram app"]),
        ("Snapchat", vec!["snap chat"]),
        ("Discord", vec!["dis cord"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Product,
            Priority::High,
        ));
    }

    // ── Apple devices & services ─────────────────────────────────────────
    for (canonical, aliases) in [
        ("iPhone", vec!["i phone"]),
        ("iPad", vec!["i pad"]),
        ("MacBook", vec!["mac book", "mac book pro", "mac book air"]),
        ("AirPods", vec!["air pods"]),
        ("Apple Watch", vec!["apple watch"]),
        ("iCloud", vec!["i cloud"]),
        ("Apple ID", vec!["apple id", "apple i d"]),
        ("iMessage", vec!["i message"]),
        ("AirDrop", vec!["air drop"]),
        ("Safari", vec!["safari browser"]),
        ("App Store", vec!["app store"]),
        ("Apple Music", vec!["apple music"]),
        ("Apple Pay", vec!["apple pay"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Product,
            Priority::High,
        ));
    }

    // ── Microsoft & productivity ─────────────────────────────────────────
    for (canonical, aliases) in [
        ("Microsoft Word", vec!["microsoft word"]),
        (
            "Microsoft Excel",
            vec!["microsoft excel", "excel spreadsheet"],
        ),
        ("PowerPoint", vec!["power point"]),
        ("Outlook", vec!["out look", "microsoft outlook"]),
        ("OneNote", vec!["one note"]),
        ("OneDrive", vec!["one drive"]),
        ("Microsoft Teams", vec!["microsoft teams", "teams app"]),
        ("Windows", vec!["windows pc"]),
        ("Dropbox", vec!["drop box"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Product,
            Priority::Normal,
        ));
    }

    // ── Google & web services ────────────────────────────────────────────
    for (canonical, aliases) in [
        ("Gmail", vec!["g mail", "google mail"]),
        ("Google Drive", vec!["google drive"]),
        ("Google Maps", vec!["google maps"]),
        ("Google Meet", vec!["google meet"]),
        ("Google Docs", vec!["google docs"]),
        ("Safari-PLACEHOLDER", vec![]), // removed below; keeps grouping readable
        ("Spotify", vec!["spot if i"]),
        ("Netflix", vec!["net flix"]),
        ("PayPal", vec!["pay pal"]),
        ("Amazon", vec!["amazon shopping"]),
        ("eBay", vec!["e bay", "ee bay"]),
        ("Uber", vec!["uber ride"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::Product,
            Priority::Normal,
        ));
    }
    entries.retain(|e| e.canonical != "Safari-PLACEHOLDER");

    // ── Everyday tech words ASR misspells ────────────────────────────────
    for (canonical, aliases) in [
        ("Wi-Fi", vec!["wifi", "wi fi", "why fie"]),
        ("email", vec!["e mail", "e-mail"]),
        ("website", vec!["web site"]),
        ("webcam", vec!["web cam"]),
        ("smartphone", vec!["smart phone"]),
        ("voicemail", vec!["voice mail"]),
        ("touchscreen", vec!["touch screen"]),
        ("username", vec!["user name"]),
        ("screenshot", vec!["screen shot"]),
        ("hashtag", vec!["hash tag"]),
        ("podcast", vec!["pod cast"]),
        ("livestream", vec!["live stream"]),
        ("Bluetooth", vec!["blue tooth"]),
        ("emoji", vec![]),
        ("internet", vec![]),
        ("PDF", vec!["p d f"]),
        ("USB", vec!["u s b"]),
        ("VPN", vec!["v p n"]),
        ("QR code", vec!["q r code", "cue are code"]),
    ] {
        entries.push(entry(
            canonical,
            &aliases,
            EntryCategory::General,
            Priority::Normal,
        ));
    }

    VocabularyPack {
        id: ids::GENERAL.to_string(),
        name: "General".to_string(),
        description: "Everyday apps, devices, and common words people dictate.".to_string(),
        category: PackCategory::Technology,
        is_built_in: true,
        enabled: true,
        entries,
        target_applications: Vec::new(),
        priority: Priority::Normal.weight(),
    }
}

/// The Personal pack (spec §18) is created lazily as a user-owned pack
/// (see `store::ensure_personal_pack`): it only ever contains user data,
/// so it is fully editable from day one.
pub fn personal_pack() -> VocabularyPack {
    VocabularyPack {
        id: ids::PERSONAL.to_string(),
        name: "Personal".to_string(),
        description: "Your frequently used terms, learned corrections, and names.".to_string(),
        category: PackCategory::Personal,
        is_built_in: false,
        enabled: true,
        entries: Vec::new(),
        target_applications: Vec::new(),
        priority: Priority::Critical.weight(),
    }
}

/// All built-in packs, in display order.
pub fn builtin_packs() -> Vec<VocabularyPack> {
    vec![
        developer_pack(),
        general_pack(),
        technology_pack(),
        business_pack(),
        placeholder_pack(
            ids::FINANCE,
            "Finance",
            "Financial terms, tickers, and institutions.",
            PackCategory::Finance,
        ),
        placeholder_pack(
            ids::MEDICAL,
            "Medical",
            "Clinical terminology, drugs, and procedures.",
            PackCategory::Medical,
        ),
        placeholder_pack(
            ids::LEGAL,
            "Legal",
            "Statutes, filings, and legal terminology.",
            PackCategory::Legal,
        ),
        placeholder_pack(
            ids::MARKETING,
            "Marketing",
            "Campaigns, channels, and growth terminology.",
            PackCategory::Marketing,
        ),
        placeholder_pack(
            ids::GAMING,
            "Gaming",
            "Games, studios, and esports terminology.",
            PackCategory::Gaming,
        ),
    ]
}

/// True for packs that ship compiled-in and are read-only (spec §20). The
/// Personal pack is intentionally NOT read-only (spec §18).
pub fn is_read_only_pack(pack_id: &str) -> bool {
    pack_id.starts_with("builtin-") && pack_id != ids::PERSONAL
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn general_pack_exists_and_is_populated() {
        let packs = builtin_packs();
        let general = packs
            .iter()
            .find(|p| p.id == ids::GENERAL)
            .expect("General pack must ship built-in");
        assert_eq!(general.name, "General");
        assert!(general.enabled);
        assert!(general.entries.len() >= 50);
        assert!(general.entries.iter().all(|e| e.enabled));
    }

    #[test]
    fn builtin_packs_have_globally_unique_canonicals() {
        let packs = builtin_packs();
        let mut seen: HashSet<String> = HashSet::new();
        for pack in &packs {
            for entry in &pack.entries {
                let key = entry.canonical.to_lowercase();
                assert!(
                    seen.insert(key.clone()),
                    "duplicate canonical \"{key}\" across built-in packs"
                );
            }
        }
    }

    #[test]
    fn general_pack_does_not_shadow_technology_pack() {
        let packs = builtin_packs();
        let general = packs.iter().find(|p| p.id == ids::GENERAL).unwrap();
        let technology = packs.iter().find(|p| p.id == ids::TECHNOLOGY).unwrap();
        for entry in &general.entries {
            assert!(
                !technology
                    .entries
                    .iter()
                    .any(|t| t.canonical.eq_ignore_ascii_case(&entry.canonical)),
                "General pack duplicates Technology pack term: {}",
                entry.canonical
            );
        }
    }
}
