Here is a comprehensive feature checklist based on Wispr Flow's current functionality. ([Wispr Flow][1])

## Status Legend

- ✅ **Done** — implemented and working in the current Vox codebase
- 🟡 **Partial** — basic/foundational version exists but incomplete
- ❌ **Remaining** — not yet implemented

## Implementation Summary (as of audit)

| # | Feature area | Status |
|---|---|---|
| 1 | Core Dictation | 🟡 Partial |
| 2 | AI Auto Cleanup | ✅ Done |
| 3 | Self-Correction / Backtracking | ✅ Done |
| 4 | Context Awareness | 🟡 Partial |
| 5 | AI Rewrite / Transform | ❌ Remaining |
| 6 | Personal Dictionary | ✅ Done |
| 7 | Snippets / Text Expansion | ❌ Remaining |
| 8 | Writing Styles | ❌ Remaining |
| 9 | Developer Mode | ✅ Done |
| 10 | AI Prompt Mode | ❌ Remaining |
| 11 | File Awareness | ❌ Remaining |
| 12 | Smart Formatting | 🟡 Partial |
| 13 | Multilingual | ❌ Remaining |
| 14 | Whisper Mode | ❌ Remaining |
| 15 | Notes / Scratchpad | ❌ Remaining |
| 16 | AI Commands | ❌ Remaining |
| 17 | History | 🟡 Partial |
| 18 | Undo AI Changes | 🟡 Partial |
| 19 | Statistics | ✅ Done |
| 20 | Cross-Device Sync | ❌ Remaining |
| 21 | App-Specific Routing | ❌ Remaining |
| 22 | Meeting / Voice Intelligence | ❌ Remaining |
| 23 | Privacy / Security | 🟡 Partial |
| 24 | Team Features | ❌ Remaining |

### Remaining work (prioritized)

1. **Undo AI Changes UI** (#18) — raw transcript is now stored; build the history row action to view/restore it
2. **AI Rewrite / Transform + AI Commands** (#5, #16) — "make professional", "summarize", "translate", custom prompts (reuse the enhancement model + cleanup prompt infrastructure)
3. **Multilingual / Hinglish** (#13) — remove hardcoded `en` in `whisper.rs`, add auto language detection
4. **Snippets / Text Expansion** (#7)
5. **Writing Styles** (#8)
6. **Notes / Scratchpad** (#15)
7. **Whisper Mode** (#14)
8. **File Awareness** (#11) and **AI Prompt Mode** (#10)
9. **Cross-Device Sync** (#20), **App-Specific Routing** (#21), **Meeting Intelligence** (#22), **Team Features** (#24) — later phases

### What's already done

- Whisper.cpp + NVIDIA Parakeet transcription, global hotkey (CGEventTap + tauri global shortcut), toggle & push-to-talk modes, customizable hotkey picker, automatic text insertion via Accessibility `AXValue` with paste fallback, audio bars widget, dictation history (SQLite), search/copy/delete transcripts.
- **AI Auto Cleanup** with None/Light/Medium/High levels, auto-applied to plain transcripts after transcription, self-correction collapsing, filler/grammar/punctuation fixes; disabled in developer mode to protect code.
- Personal dictionary (passed to Whisper as context dictionary).
- Developer Mode: auto-detect developer app context, developer transcript formatting (identifiers, git/npm/docker phrases, code symbols), context prompt.
- Text Enhancement: local Qwen2.5 GGUF model, on-demand "Enhance" icon on focused input with overlay.
- Statistics: rich analytics dashboard (sessions, words, hourly activity, top apps, usage trends).
- Privacy basics: fully local processing, opt-in error reporting (Sentry, PII redacted), delete all data / wipe local files, recording cleanup.
- Updater, autostart, single-instance, theming, onboarding.

## 1. Core Dictation — 🟡 Partial

> **Status:** Most core dictation is built (Whisper.cpp + Parakeet, global hotkey, toggle/Push-to-Talk, hotkey picker, auto text insertion with paste fallback, history, search, copy, delete). **Remaining:** true hands-free/continuous mode, retry-failed-transcription action, and tighter long-session handling.

* 🎙️ Voice → text ✅
* Global dictation — works in any text field
* Push-to-talk
* Hands-free mode
* Global keyboard shortcut
* Customizable keyboard shortcuts
* Fast transcription
* Long dictation sessions
* Background microphone capture
* Automatic text insertion
* Clipboard fallback
* Dictation history
* Retry failed transcription
* Copy transcription
* Delete transcription
* Search transcription history

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

# 4. Context Awareness — 🟡 Partial

> **Status:** Active app + window title detection exists and feeds a context prompt and developer context dictionary. Auto-developer-mode formatting works. **Remaining:** app-specific *style* adaptation (Gmail → professional email, Slack → casual, Notion → structured) — currently only developer vs. plain.

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

# 5. AI Rewrite / Transform — ❌ Remaining

> **Status:** Not implemented. Only a generic "Enhance" action exists; there are no transform presets (professional, casual, shorter, clearer, summarize, translate, custom prompt) or a ⌘+Shift+V transform menu. **Remaining:** full transform UI + prompt presets.

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

> **Status:** Dictionary setting is stored in SQLite and passed to Whisper as a context dictionary. **Remaining (minor):** automatic learning from corrections, word replacement rules, structured entries for names/companies/acronyms are manual free-text only.

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

# 7. Snippets / Text Expansion — ❌ Remaining

> **Status:** Not implemented. No trigger/expansion store or expansion pass over transcribed text.

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

# 8. Writing Styles — ❌ Remaining

> **Status:** Not implemented. Only a `transcriptFormattingMode` of auto/plain/developer exists (not user-defined writing styles).

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

# 10. AI Prompt Mode — ❌ Remaining

> **Status:** Not implemented. No "Prompt Engineer" transform that restructures dictated text into a structured AI prompt.

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

# 11. File Awareness — ❌ Remaining

> **Status:** Not implemented. No file tagging or path resolution for Cursor/Windsurf.

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

# 12. Smart Formatting — 🟡 Partial

> **Status:** Developer-mode formatting handles numbered lists, code blocks, symbols, and indentation. **Remaining:** general smart formatting for non-developer contexts (bullet lists, headings, auto-paragraphs, punctuation) when not in developer mode — currently returns plain trimmed text.

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

# 13. Multilingual — ❌ Remaining

> **Status:** A multilingual Parakeet v3 model is available for download, but `whisper.rs` hardcodes the language to `en`. No automatic language detection, no language switching, no Hindi/Hinglish tuning. **Remaining:** remove hardcoded `en`, add auto-detect, multi-language selection, Hinglish support.

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

# 14. Whisper Mode — ❌ Remaining

> **Status:** Not implemented. No special handling for low-volume/whispered speech.

Useful for quiet environments.

User can speak very quietly / whisper and still dictate.

Wispr advertises whisper support. ([Wispr Flow][7])

---

# 15. Notes / Scratchpad — ❌ Remaining

> **Status:** Not implemented. No standalone scratchpad screen, voice notes, markdown preview, or AI summary.

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

# 16. AI Commands — ❌ Remaining

> **Status:** Not implemented. Dictation produces text only; no voice command parsing ("make this professional", "summarize", "translate to Hindi").

Instead of only dictating text, the user can give instructions:

> "Make this more professional."

> "Summarize this."

> "Make this shorter."

> "Turn this into bullet points."

> "Translate this to Hindi."

> "Fix the grammar."

This changes VOX from **dictation software → voice AI editor**. ([Wispr Flow Help Center][9])

---

# 17. History — 🟡 Partial

> **Status:** Transcript history with date grouping, search, copy, and delete is implemented (SQLite `transcripts` table + transcripts page). **Remaining:** per-transcript raw vs AI text, word count, language, retry, edit, undo AI edit, report.

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

# 18. Undo AI Changes — 🟡 Partial (raw preserved)

> **Status:** Groundwork done. The transcripts table now stores `raw_text` alongside the cleaned `text` whenever AI cleanup runs, and the transcription result carries `rawText`. **Remaining:** the UI to view/restore the raw version (Undo AI edit button on history rows).

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

# 20. Cross-Device Sync — ❌ Remaining

> **Status:** Not implemented. All data is local (SQLite + files); no account/cloud sync for dictionary, snippets, styles, or history.

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

# 21. App-Specific Routing — ❌ Remaining

> **Status:** Not implemented. No per-app routing shortcuts or voice routing to Slack/Email/Calendar.

Potential shortcuts:

```text
⌘ + 1 → Slack
⌘ + 2 → Email
⌘ + 3 → Calendar
```

Voice can also route dictation directly to specific workflows. Wispr's documentation currently lists routing dictation to Slack, Email, and Calendar. ([Wispr Flow Help Center][10])

---

# 22. Meeting / Voice Intelligence — ❌ Remaining

> **Status:** Not implemented. No meeting recording, live transcription, speaker diarization, summaries, or action items.

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

# 23. Privacy / Security — 🟡 Partial

> **Status:** Strong local-first baseline — all processing (transcription + enhancement) is on-device, opt-in error reporting with PII redaction, delete-all-data, recording cleanup, wipe local files. **Remaining:** configurable transcript retention, explicit "privacy mode", "don't store raw audio" toggle, encryption-at-rest option, enterprise controls.

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

# 24. Team Features — ❌ Remaining

> **Status:** Not implemented. No team dictionary, shared snippets/styles, usage dashboard, or admin controls.

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

### If you're making VOX, prioritize these first

**V1 — must have**

1. Global voice dictation
2. Whisper/fast transcription
3. Auto punctuation
4. Filler removal
5. Grammar cleanup
6. Self-correction
7. Smart paragraph/list formatting
8. Personal dictionary
9. Snippets
10. Global hotkey
11. History
12. Undo AI cleanup

**V2 — make it competitive**

13. Context awareness
14. Writing styles
15. AI commands
16. Custom transforms
17. Developer mode
18. Code/CLI awareness
19. Prompt Engineer
20. Multilingual/Hinglish
21. Notes/Scratchpad
22. Cross-device sync

**V3 — differentiate VOX**

23. Meeting transcription
24. Speaker detection
25. AI action items
26. Local/private mode
27. App-specific workflows
28. Team dictionary
29. Team snippets
30. Usage analytics

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
