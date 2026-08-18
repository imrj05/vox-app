Here is a comprehensive feature checklist based on Wispr Flow's current functionality. ([Wispr Flow][1])

## Status Legend

- ✅ **Done** — implemented and working in the current Vox codebase
- 🟡 **Partial** — basic/foundational version exists but incomplete
- ❌ **Remaining** — not yet implemented

## Implementation Summary (as of latest review)

| # | Feature area | Status |
|---|---|---|
| 1 | Core Dictation | ✅ Done |
| 2 | AI Auto Cleanup | ✅ Done |
| 3 | Self-Correction / Backtracking | ✅ Done |
| 4 | Context Awareness | ✅ Done |
| 5 | AI Rewrite / Transform | ✅ Done |
| 6 | Personal Dictionary | ✅ Done |
| 7 | Snippets / Text Expansion | ✅ Done |
| 8 | Writing Styles | 🟡 Partial |
| 9 | Developer Mode | ✅ Done |
| 10 | AI Prompt Mode | ✅ Done |
| 11 | File Awareness | ✅ Done |
| 12 | Smart Formatting | ✅ Done |
| 13 | Multilingual | ✅ Done |
| 14 | Whisper Mode | ✅ Done |
| 15 | Notes / Scratchpad | ✅ Done |
| 16 | AI Commands | ✅ Done |
| 17 | History | ✅ Done |
| 18 | Undo AI Changes | ✅ Done |
| 19 | Statistics | ✅ Done |
| 20 | Cross-Device Sync | ❌ Deferred |
| 21 | App-Specific Routing | ❌ Deferred |
| 22 | Meeting / Voice Intelligence | ❌ Out of scope |
| 23 | Privacy / Security | ✅ Done |
| 24 | Team Features | ❌ Deferred |

### Remaining work (prioritized)

1. **Cross-Device Sync** (#20), **App-Specific Routing** (#21), **Team Features** (#24) — need accounts/backend/SaaS; defer. **Meeting Intelligence** (#22) is a separate product (diarization + live transcription) — explicitly out of scope for now.

### What's already done

- Whisper.cpp + NVIDIA Parakeet transcription, global hotkey (CGEventTap + tauri global shortcut), toggle / push-to-talk / **hands-free** modes, customizable hotkey picker, automatic text insertion via Accessibility `AXValue` with paste fallback, audio bars widget, dictation history (SQLite), search/copy/delete transcripts.
- **Hands-free mode**: VAD-based auto-segmentation on silence (~1.4s), each utterance transcribed and inserted progressively while the session stays live; segments saved to history.
- **Retry failed transcription**: recording files are kept on failure and a Retry action is offered (both in-app and background hotkey flows).
- **Long-session handling**: widget warning at 10 minutes, auto-stop + transcribe cap at 30 minutes.
- **AI Auto Cleanup** with None/Light/Medium/High levels, auto-applied to plain transcripts after transcription, self-correction collapsing, filler/grammar/punctuation fixes; disabled in developer mode to protect code.
- **Context Awareness**: app-specific writing styles injected into AI cleanup (Gmail → professional email, Slack → casual, Notion → structured document); browsers only count as developer contexts when the window title carries a dev signal.
- **Smart Formatting**: rule-based numbered lists, bullet lists, and headings for non-developer dictation (`format_general_transcript`), running before AI cleanup.
- Personal dictionary (passed to Whisper as context dictionary).
- Developer Mode: auto-detect developer app context, developer transcript formatting (identifiers, git/npm/docker phrases, code symbols), context prompt.
- Text Enhancement: local Qwen2.5 GGUF model, on-demand "Enhance" icon on focused input with overlay.
- **AI Transform**: ⌘⇧V global shortcut captures selected text and opens a transform overlay with 6 presets (Polish, Make concise, Professional, Casual, Summarize, Fix grammar) + custom prompt, run through the local enhancement sidecar.
- **Undo AI edit**: transcripts store `raw_text`; the history page can restore it.
- **History**: inline edit, language badge, report action, word count, duration, app badges.
- **Privacy**: dedicated settings section with privacy mode (no error reporting + 7-day retention), configurable transcript retention (7/30/90 days/forever) enforced on launch and library open, and a "What Vox stores" explainer.
- **Multilingual**: Dictation language setting (Auto/English/Hindi/Hinglish), whisper.cpp auto-detection, detected language stored per transcript, English-only model guard.
- **Custom models**: add any Hugging Face model URL from the Models page — capability auto-detected by extension + model family (.bin/.ggml → STT, Parakeet → STT, LLM GGUFs → text enhancement), with an explicit override. Custom STT and LLM models resolve in both pipelines. Added multilingual Whisper variants (tiny/base/small/medium) and Qwen2.5 0.5B/3B as built-ins.
- **Rule-based fast cleanup**: `fast_cleanup` removes fillers, collapses self-corrections ("2 PM... actually 3 PM" → "3 PM"), fixes stutters, and normalizes capitalization — instant, no LLM. Light cleanup is now fully rule-based; Medium/High pre-clean then run the model.
- **AI Commands**: dictated instructions ("make this professional", "summarize this", "translate to Hindi", "turn this into bullet points", "make this an AI prompt") transform the selected text instead of being pasted; toggle in Settings → General.
- **Snippets**: voice-triggered text expansion ("my email" → rajeshwar@example.com) with a Snippets settings section; case-insensitive, word-boundary-aware replacement in the transcription pipeline.
- **Notes / Scratchpad**: searchable note list, autosaving editor, markdown preview, copy/delete, and dictate-to-note recording.
- **Whisper Mode**: 2.5× gain boost on recorded audio plus a whisper-aware cleanup prompt, for quiet environments.
- **AI Prompt Mode**: PromptEngine transform preset (⌘⇧V overlay + voice command) restructures text into a structured AI prompt.
- **File Awareness**: current file extracted from editor window titles feeds the ASR context, developer dictionary, and AI cleanup style.
- **Dictionary auto-learning**: editing a transcript adds corrected words to the personal dictionary ("Learned" category), filtered against common stopwords.
- Statistics: rich analytics dashboard (sessions, words, hourly activity, top apps, usage trends).
- Privacy basics: fully local processing, opt-in error reporting (Sentry, PII redacted), delete all data / wipe local files, recording cleanup.
- Updater, autostart, single-instance, theming, onboarding.

## 1. Core Dictation — ✅ Done

> **Status:** Implemented. Whisper.cpp + Parakeet transcription, global hotkey (CGEventTap + tauri global shortcut), toggle / push-to-talk / **hands-free** trigger modes, hotkey picker, auto text insertion with paste fallback, history, search, copy, delete, **retry failed transcription** (recording file is kept on failure and a Retry action is offered), and **long-session handling** (10-minute warning in the widget, 30-minute auto-stop cap). Hands-free mode auto-segments speech on silence (VAD, ~1.4s) and inserts each utterance progressively while the session stays live.

* 🎙️ Voice → text ✅
* Global dictation — works in any text field ✅
* Push-to-talk ✅
* Hands-free mode ✅ (VAD-segmented continuous dictation)
* Global keyboard shortcut ✅
* Customizable keyboard shortcuts ✅
* Fast transcription ✅
* Long dictation sessions ✅ (warning at 10 min, auto-stop at 30 min)
* Background microphone capture ✅
* Automatic text insertion ✅
* Clipboard fallback ✅
* Dictation history ✅
* Retry failed transcription ✅
* Copy transcription ✅
* Delete transcription ✅
* Search transcription history ✅

## 2. AI Auto Cleanup — ✅ Done (levels + auto-apply)

> **Status:** Implemented. A local Qwen2.5 enhancement model now auto-applies to dictated transcripts at a configurable cleanup level (**None / Light / Medium / High**) in Settings → General → AI cleanup. Light fixes spelling/capitalization/punctuation and removes clear fillers; Medium additionally removes self-corrections and fixes grammar/concision; High rephrases and formats into paragraphs/lists. Auto-cleanup is **disabled in developer mode** to protect dictated code/commands/symbols. The raw transcription is preserved as `raw_text` for future Undo. The manual on-focused-input "Enhance" icon remains. **Remaining (minor):** a UI indicator when cleanup ran and per-transcript undo.

This is one of the **most important VOX features**.

* Remove filler words

  * `um`
  * `uh`
  * `like`
  * unnecessary pauses
* Remove unnecessary repetitions
* Fix grammar
* Fix spelling
* Fix capitalization
* Fix sentence structure
* Improve readability
* Remove verbal noise
* Remove rambling
* Make sentences concise
* Preserve original meaning
* Improve word choice
* Automatically format paragraphs
* Automatically format lists
* Automatically format numbered lists
* Automatically format bullet lists
* Automatic punctuation
* Smart comma placement
* Question mark detection
* Exclamation mark detection
* Colon/semicolon detection
* Quote formatting
* Parentheses formatting

Wispr currently exposes **Auto Cleanup levels** such as None, Light, Medium, and High, allowing users to control how aggressively the AI modifies their speech. ([Wispr Flow][2])

### Example

User says:

> "um so basically I wanted to, uh, ask you if we can maybe move the meeting to tomorrow because today I am actually kind of busy"

VOX:

> "Could we move the meeting to tomorrow? I'm quite busy today."

---

# 3. Self-Correction / Backtracking — ✅ Done (via cleanup)

> **Status:** Implemented as part of AI Auto Cleanup. Medium/High cleanup prompts explicitly instruct the model to collapse self-corrections ("...actually/sorry/wait X") to the final corrected value. **Remaining (minor):** a dedicated rule-based fast path for self-correction that runs even when cleanup is None.

Very important.

User can say:

> "Let's meet at 2 PM... actually 3 PM."

Output:

> **Let's meet at 3 PM.**

Not:

> Let's meet at 2 PM actually 3 PM.

Wispr calls this **Backtrack / self-correction**. ([Wispr Flow][1])

Other examples:

> "Deploy it to production... wait, staging."

→ `Deploy it to staging.`

> "Monday... sorry, Tuesday."

→ `Tuesday.`

---

# 4. Context Awareness — ✅ Done

> **Status:** Active app + window title detection feeds a context prompt, developer context dictionary, and auto-developer-mode formatting. **App-specific writing styles** are now applied via AI cleanup: Gmail/Mail/Outlook → professional email, Slack/Discord/Teams → casual conversational, Notion/Obsidian/Docs → structured document (`app_style_instruction` in `lib.rs`, injected into the cleanup prompt). Browsers are no longer unconditionally treated as developer contexts — Chrome on Gmail gets prose formatting, Chrome on localhost:3000 still gets developer formatting.

VOX should understand **where the user is typing**.

For example:

### Gmail

```text
Professional email formatting
```

### Slack

```text
Casual conversational formatting
```

### Notion

```text
Structured document formatting
```

### Cursor

```text
Developer/code formatting
```

Wispr's Context Awareness detects the active application and adapts transcription, formatting, and style accordingly. ([Wispr Flow Help Center][3])

---

# 5. AI Rewrite / Transform — ✅ Done (presets + custom prompt)

> **Status:** Implemented (commit `170c7a3`). `TransformOverlay` offers 6 presets — Polish, Make concise, Professional, Casual, Summarize, Fix grammar — plus a custom instruction input. The ⌘⇧V global shortcut (`handle_transform_shortcut`) captures selected text from the active app, shows the main window, and opens the overlay; `apply_transform` runs the local Qwen2.5 sidecar via `transform_prompt`. **Remaining (minor):** translate preset, "turn into bullet points", and the Prompt Engineer preset (#10).

After text is generated, user can select it and say:

* Make this professional
* Make this shorter
* Make this clearer
* Make this friendly
* Make this casual
* Fix grammar
* Summarize this
* Expand this
* Rewrite this
* Translate this
* Turn this into bullet points
* Turn this into an email
* Make this an AI prompt

Wispr's current **Transforms** feature supports rewriting selected text and custom prompts. ([Wispr Flow Help Center][4])

For VOX, I'd make this extremely powerful:

```text
⌘ + Shift + V
       ↓
AI Transform
       ↓
┌─────────────────────┐
│ Polish              │
│ Make concise        │
│ Professional        │
│ Casual              │
│ Fix grammar         │
│ Summarize           │
│ Translate            │
│ Custom prompt       │
└─────────────────────┘
```

---

# 6. Personal Dictionary — ✅ Done

> **Status:** Dictionary setting is stored in SQLite and passed to Whisper as a context dictionary. **Automatic learning from corrections** is now implemented: when you edit a transcript in the Transcript Library, new words (filtered against common English/Hindi stopwords) are auto-added to the dictionary under a "Learned" category, with a confirmation message. **Remaining (minor):** word replacement rules; structured entries for names/companies/acronyms are manual free-text only.

VOX should learn words the user frequently uses.

For example:

```text
Supabase
Cloudflare
Tauri
PostgreSQL
Drizzle
Next.js
Rajeshwar
Vercel
Dokploy
```

Features:

* Custom words
* Custom spellings
* Names
* Company names
* Product names
* Technical terminology
* Acronyms
* Developer jargon
* Automatic learning from corrections
* Manual dictionary entries
* Word replacement rules

Wispr automatically adds corrected words to its personal dictionary. ([Wispr Flow][1])

---

# 7. Snippets / Text Expansion — ✅ Done

> **Status:** Implemented. A **Snippets** settings section (sidebar) manages trigger → expansion pairs stored in a SQLite `snippets` table. Snippets sync to Rust (`SnippetsState` + `set_snippets`) and `expand_snippets` runs at the end of the transcription pipeline: case-insensitive, word-boundary-aware replacement ("send it to my email" → "send it to rajeshwar@example.com"; "my emailaddress" is untouched).

Extremely useful.

User creates:

```text
Trigger:
"my email"

Expansion:
rajeshwar@example.com
```

Then:

> "Please send it to my email"

becomes:

> "Please send it to [rajeshwar@example.com](mailto:rajeshwar@example.com)"

Other examples:

```text
"my github"
"my meeting link"
"my address"
"thanks"
"PR description"
"bug report"
"support reply"
```

Wispr supports voice-triggered snippets and saved text blocks. ([Wispr Flow Help Center][5])

---

# 8. Writing Styles — 🟡 Partial (app-context done; custom styles remaining)

> **Status:** The **app-context style registry** is implemented — `app_style_instruction` in `lib.rs` maps the active app to a writing style injected into AI cleanup (Gmail → professional email, Slack → casual, Notion → structured document), so VOX automatically applies the appropriate style based on the application/context. **Remaining:** user-defined custom styles (a settings UI where users author named styles and assign them to apps).

Allow users to define styles:

### Personal

```text
Casual
Friendly
Short
```

### Work

```text
Professional
Clear
Concise
```

### Email

```text
Professional
Polite
Structured
```

### Custom

```text
My style
```

Then VOX automatically applies the appropriate style based on the application/context. ([Wispr Flow][1])

---

# 9. Developer Mode — ✅ Done

> **Status:** Implemented. Auto-detects developer app context, formats transcripts (camelCase/snake_case/PascalCase/kebab-case/UPPER_CASE), recognizes git/npm/docker/CLI phrases, preserves code symbols, file extensions, and adds a developer context dictionary.

This could be a **major differentiator for your VOX app**.

Recognize:

```text
camelCase
snake_case
PascalCase
kebab-case
UPPER_CASE
```

Understand:

```text
npm install
pnpm dev
docker compose up
git checkout
git commit
```

Recognize:

```text
Next.js
React
TypeScript
Rust
Tauri
PostgreSQL
Redis
Docker
Kubernetes
Cloudflare
Supabase
Vercel
```

Preserve:

* Code formatting
* CLI commands
* File names
* Paths
* URLs
* Variables
* Acronyms
* Technical terminology

Wispr specifically has syntax awareness, developer jargon recognition, and file tagging for Cursor/Windsurf. ([Wispr Flow][1])

---

# 10. AI Prompt Mode — ✅ Done

> **Status:** Implemented. A **PromptEngine** transform preset restructures selected text into a well-scoped AI prompt (goal statement + numbered requirements). Available in the ⌘⇧V AI Transform overlay ("AI prompt") and as a voice command ("make this an AI prompt" / "prompt engineer").

This is particularly useful for developers.

User says:

> "Fix the authentication bug in the login API and make sure the session expires after 30 days"

VOX could convert it into:

```text
Fix the authentication bug in the login API.

Requirements:
- Investigate the current authentication flow
- Fix the login issue
- Ensure sessions expire after 30 days
- Preserve existing authentication behavior
- Add/update tests where necessary
```

Wispr already has a **Prompt Engineer** transform for restructuring dictated text into better AI prompts. ([Wispr Flow Help Center][4])

---

# 11. File Awareness — ✅ Done (window-title file tagging)

> **Status:** Implemented. `current_file_from_title` extracts the file name from editor window titles ("user.service.ts — my-project — Visual Studio Code") and feeds it into three places: the ASR context prompt ("The user is working on the file user.service.ts"), the developer dictionary (so the model transcribes the filename correctly), and the AI cleanup/transform style (so prompts can reference the file). Path dictation ("src slash services slash user dot service dot ts") already worked via developer mode. **Remaining (later):** true editor integration to enumerate open files beyond the active window title.

For coding environments:

User says:

> "Update the authentication logic in user service"

VOX could understand:

```text
src/services/user.service.ts
```

and insert/reference it appropriately.

Wispr's File Tagging can recognize filenames in Cursor/Windsurf and automatically tag the appropriate file in prompts. ([Wispr Flow][1])

---

# 12. Smart Formatting — ✅ Done

> **Status:** Developer-mode formatting handles code blocks, symbols, and indentation. **General smart formatting** for non-developer contexts is now rule-based (`format_general_transcript` in `lib.rs`): numbered lists from ordinals ("first X second Y third Z" → 1./2./3.), bullet lists from intent phrases + separators ("things I need milk and eggs and bread" → • Milk/• Eggs/• Bread), and headings ("title project requirements" / "meeting notes" → ## Project Requirements). Runs before AI cleanup so the model sees pre-structured text; falls back to the original when no pattern matches.

Speech:

> "first install dependencies second run database migration third start the development server"

Output:

```text
1. Install dependencies
2. Run the database migration
3. Start the development server
```

Also:

### Bullet list

> "things I need milk eggs bread"

→

```text
• Milk
• Eggs
• Bread
```

### Heading

> "project requirements"

→

```text
## Project Requirements
```

### Code

> "const user equals await get user"

→

```ts
const user = await getUser();
```

---

# 13. Multilingual — ✅ Done (auto-detect + English/Hindi/Hinglish)

> **Status:** The hardcoded `en` is gone. A **Dictation language** setting (Auto / English / Hindi / Hinglish) lives in Settings → General and syncs to Rust. `whisper.rs` maps Auto/Hinglish → whisper.cpp auto-detection, pins `en`/`hi` explicitly, and reports the detected language back (stored per transcript via the `language` column). English-only models (`.en`) fail fast with a "download a multilingual model" message when a non-English language is selected. Parakeet v3 auto-detects. **Remaining (later):** 100+ language picker, regional variants, per-session language switching.

* 100+ languages
* Automatic language detection
* Multiple active languages
* Regional variants
* Language switching
* Hindi
* English
* Hinglish
* etc.

Wispr currently supports 100+ languages and can detect the language at the beginning of a dictation session. ([Wispr Flow Help Center][6])

For **VOX**, I'd specifically support:

```text
English
Hindi
Hinglish
```

very well before trying to support 100+ languages.

---

# 14. Whisper Mode — ✅ Done

> **Status:** Implemented. A **Whisper mode** toggle in Settings → General applies a 2.5× gain boost to recorded samples in the audio callback (all sample formats), so quiet/whispered speech clears the ASR noise floor. When AI cleanup runs, the prompt also notes the source was whispered so the model transcribes faithfully instead of "fixing" quiet fragments.

Useful for quiet environments.

User can speak very quietly / whisper and still dictate.

Wispr advertises whisper support. ([Wispr Flow][7])

---

# 15. Notes / Scratchpad — ✅ Done

> **Status:** Implemented. A **Notes** page (sidebar) with a searchable note list, autosaving editor (600ms debounce), **markdown preview** (headings, lists, code blocks, bold), copy, delete, and a **Dictate** button that records and appends the transcription to the current note. Notes live in a SQLite `notes` table. **Remaining (later):** AI summary, cross-device sync.

A standalone place to dictate without another application.

Features:

* Voice notes
* Quick notes
* Scratchpad
* Automatic transcription
* AI summary
* Search
* Copy
* Share
* Delete
* Markdown preview
* Sync across devices

Wispr currently has Scratchpad/Notes functionality across its apps. ([Wispr Flow Help Center][8])

---

# 16. AI Commands — ✅ Done

> **Status:** Implemented. `detect_voice_command` in `lib.rs` recognizes short dictated instructions (≤ 10 words) — "make this professional/casual/shorter", "summarize this", "fix the grammar", "polish this", "translate to Hindi/English", "turn this into bullet points", "make this an AI prompt" — and routes them to the existing transform pipeline (`run_transform_and_paste`, shared with the ⌘⇧V overlay). The command utterance is never pasted; instead VOX captures the selected text, transforms it, and pastes the result. A **Voice commands** toggle in Settings → General controls it (default on).

Instead of only dictating text, the user can give instructions:

> "Make this more professional."

> "Summarize this."

> "Make this shorter."

> "Turn this into bullet points."

> "Translate this to Hindi."

> "Fix the grammar."

This changes VOX from **dictation software → voice AI editor**. ([Wispr Flow Help Center][9])

---

# 17. History — ✅ Done

> **Status:** Transcript history with date grouping, search, copy, delete, **inline edit**, **undo AI edit**, word count, duration, app badge, **language badge**, and **report** is implemented (SQLite `transcripts` table + transcripts page). **Retry** is intentionally not offered for old rows — raw audio is deleted after transcription for privacy; retry exists for failed transcriptions while the recording file is still on disk.

Store:

```text
Today
Yesterday
Aug 7
Aug 6
...
```

Each transcription:

```text
Raw transcript
AI-cleaned transcript
Timestamp
Application
Word count
Language
```

Actions:

```text
Copy
Retry
Edit
Undo AI edit
Delete
Report
```

Wispr's current history UI supports several of these operations. ([Wispr Flow Help Center][8])

---

# 18. Undo AI Changes — ✅ Done

> **Status:** Implemented. The transcripts table stores `raw_text` alongside the cleaned `text` whenever AI cleanup runs, and the transcripts page exposes an "Undo AI edit" action (`undoAiEdit` in `transcripts.tsx`) that restores the raw version.

Very important if you're using aggressive AI cleanup.

Example:

```text
Original
↓
AI Cleanup
↓
Final
```

User can:

```text
Undo AI Edit
```

and recover the original transcription.

Wispr explicitly preserves the raw version so AI edits can be undone. ([Wispr Flow][2])

---

# 19. Statistics — ✅ Done

> **Status:** Implemented in `home-analytics.tsx` — active days, best day, weekly average, hourly activity, top apps, usage trends, daily words/sessions via recharts. **Remaining (minor):** time-saved estimate, current streak, most-used languages.

Track:

* Words dictated
* Words/minute
* Total sessions
* Time saved
* Daily usage
* Weekly usage
* Monthly usage
* Current streak
* Most-used applications
* Most-used languages

Wispr's Hub includes dictation statistics and usage trends. ([Wispr Flow Help Center][9])

---

# 20. Cross-Device Sync — ❌ Deferred

> **Status:** Not implemented. All data is local (SQLite + files); no account/cloud sync for dictionary, snippets, styles, or history. **Decision:** requires accounts + a backend; defer. Keep the personalization schema (dictionary, snippets, styles) additive so sync can be layered on later.

Account-based synchronization:

```text
Mac
 │
 ├── Dictionary
 ├── Snippets
 ├── Styles
 └── History
       │
       ▼
     Cloud
       │
 ├── iPhone
 ├── Windows
 └── Android
```

So your personalization follows the user.

---

# 21. App-Specific Routing — ❌ Deferred

> **Status:** Not implemented. No per-app routing shortcuts or voice routing to Slack/Email/Calendar.

Potential shortcuts:

```text
⌘ + 1 → Slack
⌘ + 2 → Email
⌘ + 3 → Calendar
```

Voice can also route dictation directly to specific workflows. Wispr's documentation currently lists routing dictation to Slack, Email, and Calendar. ([Wispr Flow Help Center][10])

---

# 22. Meeting / Voice Intelligence — ❌ Out of scope for now

> **Status:** Not implemented. No meeting recording, live transcription, speaker diarization, summaries, or action items. **Decision:** this is a separate product (a meeting recorder, not a dictation layer) — it drags in streaming ASR, diarization models, and a new UI. Explicitly deferred.

A more advanced VOX feature set:

* Meeting recording
* Live transcription
* Speaker identification
* Meeting summary
* Action items
* Decisions
* Important points
* Follow-ups
* Automatic notes

This moves VOX beyond dictation into a **voice productivity assistant**.

---

# 23. Privacy / Security — ✅ Done

> **Status:** Strong local-first baseline — all processing (transcription + enhancement) is on-device, opt-in error reporting with PII redaction, delete-all-data, recording cleanup, wipe local files. **Added:** a dedicated Privacy settings section with **privacy mode** (disables error reporting + 7-day retention), **configurable transcript retention** (forever / 7 / 30 / 90 days, enforced on app launch and library open), and a "What Vox stores" explainer (raw audio is deleted after transcription, transcripts stay local). **Remaining (deferred):** encryption-at-rest and enterprise controls.

For a serious desktop app:

* Local audio processing where possible
* Encryption in transit
* Encryption at rest
* Privacy mode
* Don't store raw audio
* Configurable transcript retention
* Delete all data
* Local-only mode
* Enterprise controls

Privacy is especially important because you're handling microphone/audio data.

---

# 24. Team Features — ❌ Deferred

> **Status:** Not implemented. No team dictionary, shared snippets/styles, usage dashboard, or admin controls. **Decision:** requires SaaS (accounts, billing, admin); nothing to build until there are paying users.

If you eventually make VOX SaaS:

* Team dictionary
* Shared snippets
* Shared styles
* Team terminology
* Usage dashboard
* Word usage
* Adoption metrics
* Admin controls
* Centralized billing

Wispr currently offers shared dictionaries, shared snippets, and usage dashboards for teams. ([Wispr Flow][1])

---

# Recommended VOX Feature Architecture

If you're building **VOX**, I would organize the product into these modules:

```text
VOX
│
├── 🎙 Dictation
│   ├── Global hotkey
│   ├── Push-to-talk
│   ├── Hands-free
│   ├── Voice → Text
│   └── Multilingual
│
├── ✨ AI Cleanup
│   ├── Remove fillers
│   ├── Grammar
│   ├── Punctuation
│   ├── Formatting
│   ├── Remove repetition
│   ├── Concise mode
│   └── Self-correction
│
├── 🧠 Context
│   ├── Active app
│   ├── Writing style
│   ├── Personal dictionary
│   ├── App-specific formatting
│   └── Developer mode
│
├── ⚡ Voice Commands
│   ├── Rewrite
│   ├── Summarize
│   ├── Translate
│   ├── Fix grammar
│   ├── Make professional
│   └── Custom commands
│
├── 📚 Personalization
│   ├── Dictionary
│   ├── Snippets
│   ├── Styles
│   └── Learned vocabulary
│
├── 👨‍💻 Developer
│   ├── Code syntax
│   ├── CLI
│   ├── File names
│   ├── Paths
│   ├── Git commands
│   └── AI Prompt mode
│
├── 📝 Notes
│   ├── Scratchpad
│   ├── Voice notes
│   ├── Summaries
│   └── Search
│
├── 📊 History
│   ├── Transcripts
│   ├── Raw text
│   ├── AI text
│   └── Undo AI edit
│
└── ☁️ Sync
    ├── Mac
    ├── Windows
    ├── iOS
    └── Android
```

### If you're making VOX, prioritize these first (revised against current code)

**V1 — must have** (✅ = shipped)

1. ✅ Global voice dictation
2. ✅ Whisper/fast transcription
3. ✅ Auto punctuation
4. ✅ Filler removal
5. ✅ Grammar cleanup
6. ✅ Self-correction
7. ✅ Smart paragraph/list formatting (rule-based numbered lists, bullets, headings + developer mode)
8. ✅ Personal dictionary
9. ✅ Global hotkey
10. ✅ History
11. ✅ Undo AI cleanup
12. ✅ AI Transform (presets + custom prompt)
13. ✅ Multilingual / Hinglish — auto-detect + English/Hindi/Hinglish picker
14. ✅ Rule-based fast-path cleanup — Light is instant (no LLM); Medium/High pre-clean then run the model

**V2 — make it competitive**

15. ✅ AI commands (voice-triggered transforms — "make this professional", "summarize", "translate to Hindi")
16. ✅ Writing styles (app-context style registry → AI cleanup)
17. ✅ Context awareness (app-specific style adaptation)
18. ✅ Snippets / text expansion (voice-triggered, word-boundary-aware)
19. ✅ Prompt Engineer (AI prompt transform preset + voice command)
20. ✅ Notes / Scratchpad (autosaving editor, markdown preview, dictate-to-note)
21. ✅ Whisper mode (2.5× gain boost + whisper-aware cleanup prompt)

**V3 — differentiate VOX**

22. Meeting transcription + speaker detection + action items (separate product — out of scope for now)
23. Local/private mode hardening
24. App-specific workflows / routing
25. Cross-device sync (needs accounts + backend)
26. Team dictionary / snippets / usage analytics (needs SaaS)

The key insight is: **Whisper is only the transcription engine. The actual VOX product should be the entire pipeline:**

```text
Audio
  ↓
Speech Recognition
  ↓
Language Detection
  ↓
Context Detection
  ↓
Personal Vocabulary
  ↓
Self-Correction
  ↓
AI Cleanup
  ↓
Smart Formatting
  ↓
Style
  ↓
Developer/Domain Rules
  ↓
Final Text
  ↓
Active Application
```

That pipeline is what would make **VOX feel like Wispr Flow rather than a basic Whisper desktop wrapper**.

[1]: https://wisprflow.ai/features?utm_source=chatgpt.com "Features | Wispr Flow"
[2]: https://wisprflow.ai/whats-new?utm_source=chatgpt.com "What's new | Wispr Flow"
[3]: https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness?utm_source=chatgpt.com "Context Awareness"
[4]: https://docs.wisprflow.ai/articles/8068950331-how-to-use-transforms-beta?utm_source=chatgpt.com "How to Use Transforms (Beta)"
[5]: https://docs.wisprflow.ai/articles/5784437944-create-and-use-snippets?utm_source=chatgpt.com "Create and use snippets"
[6]: https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages?utm_source=chatgpt.com "Use Flow with multiple languages"
[7]: https://try.wisprflow.ai/?utm_source=chatgpt.com "Features | Wispr Flow"
[8]: https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android?utm_source=chatgpt.com "Navigating the Wispr Flow App: Desktop, iOS, and Android"
[9]: https://docs.wisprflow.ai/articles/2772472373-what-is-flow?utm_source=chatgpt.com "What is Flow?"
[10]: https://docs.wisprflow.ai/collections/7303194563-using_wispr_flow?utm_source=chatgpt.com "Using Wispr Flow"
