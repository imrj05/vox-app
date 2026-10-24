//! User-defined writing styles and app-aware profiles (Phase 2.8/2.9).
//!
//! The built-in app heuristics stay in `lib.rs`; this module owns the user's
//! custom styles, app → style mappings, and optional default style. Everything
//! is local-only and persisted as JSON next to the rest of Vox's app data.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const CONFIG_FILE: &str = "writing-profiles.json";
const MAX_CUSTOM_STYLES: usize = 50;
const MAX_PROFILES: usize = 100;
const MAX_NAME_CHARS: usize = 80;
const MAX_INSTRUCTION_CHARS: usize = 2000;
const MAX_APP_NAME_CHARS: usize = 120;

/// The id used to explicitly opt an app out of all writing styles.
pub const NO_STYLE_ID: &str = "none";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingStyle {
    pub id: String,
    pub name: String,
    pub instruction: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppWritingProfile {
    pub app_name: String,
    pub style_id: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WritingProfileConfig {
    pub custom_styles: Vec<WritingStyle>,
    pub profiles: Vec<AppWritingProfile>,
    pub default_style_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProfilesView {
    pub builtin_styles: Vec<WritingStyle>,
    pub custom_styles: Vec<WritingStyle>,
    pub profiles: Vec<AppWritingProfile>,
    pub default_style_id: Option<String>,
}

#[derive(Default)]
pub struct WritingProfilesState {
    pub config: Mutex<WritingProfileConfig>,
}

/// Built-in styles are owned by Rust so the hotkey path always has them, even
/// before the settings window has loaded.
pub fn builtin_styles() -> Vec<WritingStyle> {
    vec![
        WritingStyle {
            id: "builtin-email".to_string(),
            name: "Email".to_string(),
            instruction: "Write in a professional email style: polite, clear, well-structured, with complete sentences and standard email conventions.".to_string(),
        },
        WritingStyle {
            id: "builtin-chat".to_string(),
            name: "Chat".to_string(),
            instruction: "Write in a casual conversational style: friendly, concise, natural, with short sentences and a relaxed tone.".to_string(),
        },
        WritingStyle {
            id: "builtin-document".to_string(),
            name: "Document".to_string(),
            instruction: "Write in a structured document style: clear organization, well-structured paragraphs, and content suitable for a document.".to_string(),
        },
    ]
}

pub fn config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CONFIG_FILE)
}

pub fn load(app_data_dir: &Path) -> WritingProfileConfig {
    let Ok(data) = fs::read_to_string(config_path(app_data_dir)) else {
        return WritingProfileConfig::default();
    };
    serde_json::from_str::<WritingProfileConfig>(&data)
        .map(sanitize)
        .unwrap_or_default()
}

pub fn save(app_data_dir: &Path, config: &WritingProfileConfig) -> Result<(), String> {
    let data = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::create_dir_all(app_data_dir).map_err(|error| error.to_string())?;
    fs::write(config_path(app_data_dir), data).map_err(|error| error.to_string())
}

pub fn view(config: &WritingProfileConfig) -> WritingProfilesView {
    WritingProfilesView {
        builtin_styles: builtin_styles(),
        custom_styles: config.custom_styles.clone(),
        profiles: config.profiles.clone(),
        default_style_id: config.default_style_id.clone(),
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

fn valid_style_id(id: &str, custom_styles: &[WritingStyle]) -> bool {
    id == NO_STYLE_ID
        || builtin_styles().iter().any(|style| style.id == id)
        || custom_styles.iter().any(|style| style.id == id)
}

/// Trim, bound, deduplicate, and repair user input before it is persisted.
pub fn sanitize(config: WritingProfileConfig) -> WritingProfileConfig {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    let mut custom_styles: Vec<WritingStyle> = Vec::new();
    for style in config.custom_styles.into_iter().take(MAX_CUSTOM_STYLES) {
        let name = truncate_chars(&style.name, MAX_NAME_CHARS);
        let instruction = truncate_chars(&style.instruction, MAX_INSTRUCTION_CHARS);
        if name.is_empty() || instruction.is_empty() {
            continue;
        }
        let mut id = style.id.trim().to_string();
        let id_is_builtin = builtin_styles().iter().any(|builtin| builtin.id == id);
        let id_is_taken = custom_styles.iter().any(|custom| custom.id == id);
        if id.is_empty() || id_is_builtin || id_is_taken {
            id = format!("custom-{seed}-{}", custom_styles.len());
            while custom_styles.iter().any(|custom| custom.id == id) {
                id.push('x');
            }
        }
        custom_styles.push(WritingStyle {
            id,
            name,
            instruction,
        });
    }

    let mut profiles: Vec<AppWritingProfile> = Vec::new();
    for profile in config.profiles.into_iter().take(MAX_PROFILES) {
        let app_name = truncate_chars(&profile.app_name, MAX_APP_NAME_CHARS);
        let style_id = profile.style_id.trim().to_string();
        if app_name.is_empty() || !valid_style_id(&style_id, &custom_styles) {
            continue;
        }
        // First mapping for an app wins; this keeps precedence deterministic.
        if profiles
            .iter()
            .any(|existing| existing.app_name.eq_ignore_ascii_case(&app_name))
        {
            continue;
        }
        profiles.push(AppWritingProfile { app_name, style_id });
    }

    let default_style_id = config
        .default_style_id
        .map(|id| id.trim().to_string())
        .filter(|id| id != NO_STYLE_ID && valid_style_id(id, &custom_styles));

    WritingProfileConfig {
        custom_styles,
        profiles,
        default_style_id,
    }
}

/// Resolve the instruction that should steer cleanup for this dictation.
///
/// Precedence: explicit app profile → built-in app heuristic → default style.
/// Developer contexts never receive a prose style. An explicit profile whose
/// style id is `"none"` opts that app out.
pub fn resolve_style(
    config: &WritingProfileConfig,
    app_name: Option<&str>,
    window_title: Option<&str>,
    developer_context: bool,
    builtin_instruction: Option<&str>,
) -> Option<String> {
    if developer_context {
        return None;
    }

    let context = format!(
        "{} {}",
        app_name.unwrap_or_default(),
        window_title.unwrap_or_default()
    )
    .to_lowercase();

    if !context.trim().is_empty() {
        if let Some(profile) = config.profiles.iter().find(|profile| {
            let target = profile.app_name.trim().to_lowercase();
            !target.is_empty() && context.contains(&target)
        }) {
            if profile.style_id == NO_STYLE_ID {
                return None;
            }
            if let Some(style) = config
                .custom_styles
                .iter()
                .find(|style| style.id == profile.style_id)
            {
                return Some(style.instruction.clone());
            }
            if let Some(style) = builtin_styles()
                .into_iter()
                .find(|style| style.id == profile.style_id)
            {
                return Some(style.instruction);
            }
        }
    }

    if let Some(instruction) = builtin_instruction {
        return Some(instruction.to_string());
    }

    if let Some(id) = &config.default_style_id {
        if let Some(style) = config.custom_styles.iter().find(|style| &style.id == id) {
            return Some(style.instruction.clone());
        }
        if let Some(style) = builtin_styles().into_iter().find(|style| &style.id == id) {
            return Some(style.instruction);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_custom() -> WritingProfileConfig {
        WritingProfileConfig {
            custom_styles: vec![WritingStyle {
                id: "custom-formal".to_string(),
                name: "Formal".to_string(),
                instruction: "Write formally and avoid contractions.".to_string(),
            }],
            profiles: Vec::new(),
            default_style_id: None,
        }
    }

    #[test]
    fn sanitize_drops_empty_and_repairs_ids() {
        let config = WritingProfileConfig {
            custom_styles: vec![
                WritingStyle {
                    id: "".into(),
                    name: "  ".into(),
                    instruction: "ignored".into(),
                },
                WritingStyle {
                    id: "builtin-email".into(),
                    name: " Mine ".into(),
                    instruction: " Keep it short. ".into(),
                },
            ],
            profiles: vec![
                AppWritingProfile {
                    app_name: " Slack ".into(),
                    style_id: "builtin-email".into(),
                },
                AppWritingProfile {
                    app_name: "".into(),
                    style_id: "builtin-email".into(),
                },
            ],
            default_style_id: Some("missing".into()),
        };
        let clean = sanitize(config);
        assert_eq!(clean.custom_styles.len(), 1);
        assert_eq!(clean.custom_styles[0].name, "Mine");
        assert!(!clean.custom_styles[0].id.is_empty());
        assert_ne!(clean.custom_styles[0].id, "builtin-email");
        assert_eq!(clean.profiles.len(), 1);
        assert_eq!(clean.profiles[0].app_name, "Slack");
        assert_eq!(clean.default_style_id, None);
    }

    #[test]
    fn explicit_profile_beats_builtin_heuristic() {
        let mut config = config_with_custom();
        config.profiles.push(AppWritingProfile {
            app_name: "Slack".into(),
            style_id: "custom-formal".into(),
        });
        let resolved = resolve_style(
            &config,
            Some("Slack"),
            None,
            false,
            Some("casual chat instruction"),
        );
        assert_eq!(
            resolved.as_deref(),
            Some("Write formally and avoid contractions.")
        );
    }

    #[test]
    fn no_style_profile_opts_out() {
        let mut config = config_with_custom();
        config.profiles.push(AppWritingProfile {
            app_name: "Slack".into(),
            style_id: NO_STYLE_ID.into(),
        });
        assert_eq!(
            resolve_style(&config, Some("Slack"), None, false, Some("chat")),
            None
        );
    }

    #[test]
    fn builtin_heuristic_then_default() {
        let mut config = config_with_custom();
        assert_eq!(
            resolve_style(&config, Some("Gmail"), None, false, Some("email")),
            Some("email".to_string())
        );
        config.default_style_id = Some("custom-formal".into());
        assert_eq!(
            resolve_style(&config, Some("Calculator"), None, false, None),
            Some("Write formally and avoid contractions.".to_string())
        );
    }

    #[test]
    fn window_title_matches_profile() {
        let mut config = config_with_custom();
        config.profiles.push(AppWritingProfile {
            app_name: "Gmail".into(),
            style_id: "custom-formal".into(),
        });
        assert_eq!(
            resolve_style(
                &config,
                Some("Google Chrome"),
                Some("Inbox - Gmail"),
                false,
                None
            ),
            Some("Write formally and avoid contractions.".to_string())
        );
    }

    #[test]
    fn developer_context_never_gets_a_style() {
        let mut config = config_with_custom();
        config.default_style_id = Some("custom-formal".into());
        config.profiles.push(AppWritingProfile {
            app_name: "Cursor".into(),
            style_id: "custom-formal".into(),
        });
        assert_eq!(
            resolve_style(&config, Some("Cursor"), None, true, None),
            None
        );
    }
}
