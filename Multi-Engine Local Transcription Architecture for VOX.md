# Implement a Multi-Engine Local Transcription Architecture for VOX

You are working on the existing **VOX desktop application**. Update the current implementation to support **three interchangeable local speech-to-text engines**:

1. **Apple Speech** — use Apple's native Speech framework
2. **Whisper** — use a local Whisper implementation suitable for Apple Silicon
3. **Parakeet** — use a local Parakeet model through Core ML

The goal is to make transcription engines modular, selectable, and replaceable without coupling the React UI to any specific model.

## IMPORTANT: Inspect Before Modifying

Before making changes:

1. Inspect the complete existing VOX architecture.
2. Identify:
   - Current Tauri commands
   - Rust backend structure
   - Existing microphone/audio capture implementation
   - Existing transcription implementation
   - Existing Swift/native macOS integration, if any
   - Existing Whisper implementation, if any
   - Existing state management
   - Existing settings/preferences
   - Existing history/transcript storage
   - Existing global hotkey implementation
   - Existing text insertion implementation
3. Reuse existing functionality wherever possible.
4. Do not rewrite working audio capture, hotkeys, text insertion, UI, or persistence unnecessarily.
5. Do not introduce duplicate implementations.
6. Keep the existing UX working throughout the migration.

First determine the smallest architectural change required to introduce the three engines cleanly.

---

# 1. Target Architecture

Refactor transcription around a common abstraction:

```text
VOX
│
├── Audio Layer
│   ├── Microphone Capture
│   ├── PCM conversion
│   ├── Sample-rate conversion
│   └── VAD
│
├── Transcription Layer
│   ├── TranscriptionEngine
│   │
│   ├── AppleSpeechEngine
│   ├── WhisperEngine
│   └── ParakeetEngine
│
├── Intelligence Layer
│   ├── Normalization
│   ├── Filler Removal
│   ├── Repetition Removal
│   ├── Grammar Cleanup
│   ├── Punctuation
│   ├── Smart Formatting
│   ├── Self Correction
│   └── Context Awareness
│
├── Personalization
│   ├── Personal Dictionary
│   ├── Snippets
│   └── Writing Style
│
└── Output
    ├── React UI
    ├── Tauri Events
    ├── Clipboard
    └── Active Application
```

The most important rule:

```text
ASR engine = Audio → Raw Transcript

AI processing = Raw Transcript → Final Text
```

Do not mix AI cleanup logic into individual ASR engines.

---

# 2. Create a Common Transcription Interface

Create a common interface/protocol for all three engines.

Conceptually:

```text
TranscriptionEngine

- id
- name
- capabilities
- availability
- load()
- unload()
- start()
- appendAudio()
- stop()
- cancel()
```

The exact implementation should follow the existing language/runtime architecture.

The interface should support:

```text
partial transcription
final transcription
word timestamps when available
confidence when available
language
engine identifier
errors
loading state
```

Use a normalized result format:

```typescript
interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  engine: "apple" | "whisper" | "parakeet";
  language?: string;
  confidence?: number;
  words?: WordTimestamp[];
  startTime?: number;
  endTime?: number;
}
```

For word timestamps:

```typescript
interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}
```

Do not force engines to provide fields they don't support. Use optional fields.

---

# 3. Apple Speech Engine

Implement an `AppleSpeechEngine` using Apple's native Speech framework.

Prefer the modern APIs available on the target macOS deployment, including:

```text
SpeechAnalyzer
SpeechTranscriber
```

where supported by the project's deployment target.

Do NOT treat Apple's Foundation Models framework as the speech recognizer.

Apple Speech is the ASR engine.

Foundation Models, if used later, belongs to the separate Intelligence layer.

Requirements:

- Native macOS implementation
- No manually bundled speech model
- Use Apple's supported authorization flow
- Handle microphone/speech permissions correctly
- Support partial results
- Support final results
- Handle start/stop/cancel
- Handle errors
- Handle unavailable speech services
- Handle unsupported languages
- Properly clean up resources
- Do not leak audio buffers or recognition sessions

Expose Apple Speech availability to the frontend.

Example:

```json
{
  "engine": "apple",
  "available": true,
  "reason": null
}
```

If the current application uses Tauri + Rust, integrate Apple Speech through the existing native macOS bridge rather than attempting to force Apple's Swift framework into pure Rust.

Keep the Swift/native integration isolated behind the common engine abstraction.

---

# 4. Whisper Engine

Implement Whisper as a completely local engine.

Do not use a Python server or external localhost process unless the existing architecture absolutely requires it.

Prefer a native Apple Silicon-compatible implementation such as:

```text
WhisperKit / Core ML
```

or the existing native Whisper implementation already present in the project.

Inspect the repository first. If Whisper already exists, adapt it to the new interface instead of adding another Whisper runtime.

Support:

- model loading
- model unloading
- model selection
- local inference
- partial/final transcription where supported
- multilingual transcription
- language selection/auto-detection where supported
- timestamps where available
- cancellation
- error handling

Create a model configuration abstraction:

```typescript
type WhisperModel =
  | "tiny"
  | "base"
  | "small"
  | "medium";
```

Do not hard-code model paths.

Create a model manager that can:

```text
list models
download model
delete model
check installed state
get model size
load model
unload model
```

Models should preferably be downloaded on demand rather than bundled into the main application.

---

# 5. Parakeet Engine

Implement a local Parakeet transcription engine using a Core ML-compatible Parakeet model.

Prefer:

```text
Parakeet TDT 0.6B
```

using an appropriate Core ML conversion for Apple Silicon.

Do not implement Parakeet through a Python server if native/Core ML inference is practical.

The engine must be isolated behind the same `TranscriptionEngine` abstraction.

Support:

- model loading
- model unloading
- local inference
- streaming/chunked transcription where supported
- final transcription
- timestamps when available
- capitalization
- punctuation
- cancellation
- errors
- model availability

Do not assume Parakeet supports every language.

Expose language capabilities from the engine.

For example:

```json
{
  "engine": "parakeet",
  "languages": ["en"],
  "installed": true
}
```

For multilingual Parakeet models, use the actual model's supported language list rather than hard-coding unsupported languages.

---

# 6. Transcription Router

Create a central:

```text
TranscriptionRouter
```

The UI must never directly call:

```text
Whisper
Apple
Parakeet
```

Instead:

```text
UI
 ↓
Tauri command
 ↓
TranscriptionRouter
 ↓
Selected TranscriptionEngine
```

The router should support:

```typescript
type TranscriptionEngineType =
  | "auto"
  | "apple"
  | "whisper"
  | "parakeet";
```

---

# 7. Automatic Engine Selection

Implement:

```text
Auto
```

mode.

The router should consider:

1. User's selected language
2. Engine availability
3. Installed models
4. Hardware
5. Engine capabilities
6. User preferences

Example strategy:

```text
Auto
│
├── If user explicitly selected an engine
│      → use that engine
│
├── If language is unsupported by preferred engine
│      → choose compatible engine
│
├── English + Parakeet installed
│      → prefer Parakeet
│
├── Multilingual/Hindi/Hinglish
│      → prefer Whisper when supported
│
├── No third-party model installed
│      → Apple Speech
│
└── If selected engine fails
       → use configured fallback
```

Do not silently switch engines if the user explicitly selected an engine unless fallback is explicitly enabled.

Show the actual engine used in debugging/history.

---

# 8. Fallback Strategy

Add configurable fallback behavior.

Example:

```text
Primary:
Parakeet

Fallback:
Apple Speech
```

or:

```text
Primary:
Whisper

Fallback:
Apple Speech
```

If fallback occurs, emit an event:

```json
{
  "event": "transcription_engine_fallback",
  "from": "parakeet",
  "to": "apple",
  "reason": "model_unavailable"
}
```

Never silently hide engine failures from logs.

---

# 9. Audio Normalization

Create one shared audio pipeline.

All engines should receive normalized audio.

Target:

```text
Mono
16 kHz
PCM
Float32 or the format required by the engine
```

Do not duplicate microphone capture for each engine.

Architecture:

```text
Microphone
    ↓
AudioCapture
    ↓
AudioNormalizer
    ↓
VAD
    ↓
TranscriptionEngine
```

The engine should not own microphone capture.

---

# 10. Voice Activity Detection

If VOX already has VAD, reuse it.

Otherwise create a reusable VAD layer.

Requirements:

- detect speech start
- detect silence
- detect speech end
- prevent unnecessary inference
- support continuous dictation
- configurable silence threshold
- configurable minimum speech duration

Do not tightly couple VAD to Whisper, Apple Speech, or Parakeet.

---

# 11. Streaming Events

Create consistent Tauri events.

Recommended events:

```text
transcription_started
transcription_partial
transcription_final
transcription_stopped
transcription_cancelled
transcription_error
transcription_engine_changed
transcription_engine_fallback
transcription_model_loading
transcription_model_loaded
```

Example:

```json
{
  "event": "transcription_partial",
  "engine": "parakeet",
  "text": "Let's deploy the",
  "isFinal": false
}
```

Final:

```json
{
  "event": "transcription_final",
  "engine": "parakeet",
  "text": "Let's deploy the application tomorrow.",
  "isFinal": true
}
```

---

# 12. Separate Raw Transcript From Final Transcript

Every transcription session should maintain:

```text
rawTranscript
processedTranscript
engine
language
timestamp
duration
```

Example:

```json
{
  "rawTranscript": "um so basically we should like deploy this tomorrow",
  "processedTranscript": "We should deploy this tomorrow.",
  "engine": "parakeet",
  "language": "en"
}
```

Never overwrite the raw transcript.

This is required so the user can undo AI processing.

---

# 13. AI Intelligence Pipeline

Create a separate processing pipeline:

```text
Raw Transcript
      ↓
Normalization
      ↓
Self Correction
      ↓
Filler Removal
      ↓
Repetition Removal
      ↓
Grammar
      ↓
Punctuation
      ↓
Smart Formatting
      ↓
Context Awareness
      ↓
Writing Style
      ↓
Final Transcript
```

The pipeline must be engine-independent.

It should work with:

```text
Apple
Whisper
Parakeet
```

---

# 14. Cleanup Levels

Implement user-configurable cleanup:

```text
None
Light
Medium
High
```

### None

Minimal modification.

```text
ASR → output
```

### Light

- punctuation
- capitalization
- obvious filler removal

### Medium

- filler removal
- repetition removal
- grammar correction
- punctuation
- paragraph formatting

### High

- all Medium features
- sentence restructuring
- concise rewriting
- context-aware formatting

Never change the user's meaning.

---

# 15. Filler Removal

Detect and remove speech fillers such as:

```text
um
uh
erm
like
you know
basically
actually
I mean
sort of
kind of
```

Do not blindly remove words that have semantic meaning.

Example:

Input:

```text
"Um, basically, I think we should deploy tomorrow."
```

Output:

```text
"I think we should deploy tomorrow."
```

---

# 16. Repetition Removal

Input:

```text
"I think we should, we should deploy this tomorrow."
```

Output:

```text
"I think we should deploy this tomorrow."
```

Preserve intentional repetition.

---

# 17. Self-Correction / Backtracking

Support speech corrections:

```text
"Let's deploy this on Monday... actually Tuesday."
```

Output:

```text
"Let's deploy this on Tuesday."
```

Also:

```text
"Use production... sorry, staging."
```

Output:

```text
"Use staging."
```

Implement this as a dedicated processing step, not inside individual ASR engines.

---

# 18. Smart Formatting

Detect spoken structures.

Example:

```text
"first install dependencies second run migrations third start the server"
```

Output:

```text
1. Install dependencies
2. Run migrations
3. Start the server
```

Support:

- paragraphs
- bullet lists
- numbered lists
- headings
- quoted text
- code blocks
- URLs
- email addresses
- dates
- times
- currency
- common abbreviations

Do not over-format ordinary speech.

---

# 19. Developer Mode

Add a developer-aware processing mode.

Recognize and preserve:

```text
camelCase
snake_case
PascalCase
kebab-case
UPPER_CASE
```

Recognize:

```text
npm
pnpm
yarn
bun
git
docker
kubectl
curl
ssh
```

Recognize technical terms:

```text
React
TypeScript
Tauri
Rust
Next.js
PostgreSQL
Redis
Supabase
Cloudflare
Vercel
Docker
Kubernetes
```

Preserve:

- file paths
- filenames
- URLs
- CLI commands
- variable names
- package names
- API endpoints
- code syntax

Do not allow the AI cleanup stage to accidentally rewrite technical identifiers.

---

# 20. Personal Dictionary

Create a shared dictionary independent of the ASR engine.

Support:

```text
custom words
names
company names
technical terms
product names
acronyms
preferred spelling
```

Example:

```text
"supabase"
→
"Supabase"
```

```text
"next js"
→
"Next.js"
```

The dictionary should be available to all three engines and the post-processing pipeline.

---

# 21. Snippets

Preserve or implement existing snippets.

Example:

```text
Trigger:
"my github"

Expansion:
<user GitHub URL>
```

Snippets should run after transcription and before final output where appropriate.

---

# 22. Context Awareness

Detect the active application where the existing app architecture permits it.

Create a context object:

```typescript
interface AppContext {
  applicationName?: string;
  bundleId?: string;
  windowTitle?: string;
  contextType?: "browser" | "editor" | "email" | "chat" | "document";
}
```

Use it to influence formatting.

Examples:

```text
Cursor / VS Code
→ developer mode

Gmail
→ email style

Slack
→ concise conversational style

Notion
→ document formatting
```

Do not make context awareness mandatory for basic transcription.

---

# 23. Settings UI

Add:

```text
Settings
→ Transcription
```

Include:

### Engine

```text
Automatic
Apple Speech
Parakeet
Whisper
```

### Language

```text
Automatic
English
Hindi
etc.
```

### Cleanup

```text
None
Light
Medium
High
```

### Developer Mode

```text
On / Off
```

### Fallback

```text
On / Off
```

### Preferred fallback

```text
Apple Speech
Whisper
Parakeet
```

---

# 24. Model Manager UI

Add:

```text
Settings
→ Models
```

Example:

```text
Apple Speech
Built-in
Ready

Parakeet TDT 0.6B
Installed
~XXX MB

Whisper Base
Not installed
~XXX MB

Whisper Small
Not installed
~XXX MB
```

Actions:

```text
Download
Delete
Load
Unload
Set Default
```

Never hard-code model sizes if they can be obtained from metadata.

---

# 25. Hardware Awareness

Detect:

- Apple Silicon vs Intel
- available memory
- CPU/GPU capabilities where practical
- installed model
- model memory requirements

Do not assume every Mac can run every model comfortably.

Provide sensible recommendations:

```text
Fast
Balanced
Accurate
```

rather than requiring users to understand model internals.

---

# 26. Performance Requirements

Optimize for dictation latency.

Important metrics:

```text
Time to first partial transcript
Time to final transcript
Total transcription duration
AI processing duration
End-to-end latency
Memory usage
CPU usage
GPU usage
```

Add optional debug logging:

```text
[VOX][ASR] Engine: Parakeet
[VOX][ASR] Model loaded: true
[VOX][ASR] Audio duration: 8.2s
[VOX][ASR] First result: 120ms
[VOX][ASR] Final result: 310ms
[VOX][AI] Cleanup: 84ms
[VOX][OUTPUT] Inserted: 12ms
```

Do not log raw microphone audio.

---

# 27. Privacy

All three ASR engines should support local processing where their APIs/models permit.

Do not upload audio to a remote server.

Do not store raw audio by default.

Do not log microphone contents.

Provide a clear setting if transcript history is stored.

---

# 28. Error Handling

Handle:

```text
microphone unavailable
permission denied
speech permission denied
engine unavailable
model missing
model loading failure
unsupported language
out of memory
inference failure
audio format failure
Tauri bridge failure
text insertion failure
```

Errors should be normalized:

```typescript
interface TranscriptionError {
  code: string;
  message: string;
  engine?: string;
  recoverable: boolean;
}
```

---

# 29. History

Update existing transcription history to include:

```text
timestamp
raw transcript
final transcript
engine
model
language
duration
processing duration
```

Example:

```text
Today
────────────────────────────

19:22
"Deploy the application tomorrow."

Engine:
Parakeet

Language:
English

Duration:
6.2 sec
```

Allow users to see the engine used.

---

# 30. Do Not Couple UI to Models

React should only know:

```text
engine = apple | whisper | parakeet | auto
```

It should NOT know:

```text
WhisperKit APIs
Core ML APIs
Parakeet internals
SpeechAnalyzer internals
```

All of that belongs to the native/backend layer.

---

# 31. Tauri API

Expose a clean API.

Conceptually:

```text
get_transcription_engines()
get_transcription_settings()
set_transcription_engine()
start_transcription()
stop_transcription()
cancel_transcription()

get_models()
download_model()
delete_model()
load_model()
unload_model()
```

Do not expose model-specific implementation details to React.

---

# 32. Testing

Create unit/integration tests for:

### Router

```text
Auto + English + Parakeet installed
→ Parakeet

Auto + Hindi
→ compatible engine

Explicit Whisper
→ Whisper

Explicit Parakeet but model missing
→ error or configured fallback
```

### Cleanup

```text
filler removal
repetition removal
grammar
punctuation
self correction
list formatting
developer terms
```

### Engine lifecycle

```text
load
start
append audio
partial
final
stop
cancel
unload
```

### Failure

```text
missing model
permission denied
unsupported language
engine failure
fallback
```

---

# 33. Do Not Break Existing Functionality

Before completing the implementation, verify that all existing VOX functionality still works:

- Global hotkey
- Microphone permissions
- Recording
- Stop recording
- Text insertion
- Clipboard
- Existing transcription
- History
- Settings
- UI
- Auto-start behavior
- Tauri commands
- macOS permissions
- Existing native functionality

If an existing feature conflicts with the new architecture, refactor it rather than deleting it.

---

# 34. Final Deliverables

After implementation, provide:

1. List of files changed
2. List of new files
3. Architecture explanation
4. Which engine is used by default
5. How Apple Speech is integrated
6. How Whisper is integrated
7. How Parakeet is integrated
8. How models are downloaded/stored
9. How Auto engine selection works
10. How fallback works
11. How AI cleanup works
12. How to build the macOS application
13. How to test each engine
14. Any macOS permissions required
15. Any model licenses or redistribution requirements that need review
16. Known limitations

---

# 35. Implementation Order

Implement in this order:

```text
1. Inspect current architecture
2. Create common TranscriptionEngine abstraction
3. Extract/refactor existing transcription
4. Create normalized audio pipeline
5. Implement AppleSpeechEngine
6. Implement WhisperEngine
7. Implement ParakeetEngine
8. Implement TranscriptionRouter
9. Implement Auto selection
10. Implement fallback
11. Separate raw/final transcript
12. Implement AI cleanup pipeline
13. Add cleanup levels
14. Add developer mode
15. Add dictionary integration
16. Update settings UI
17. Add model manager
18. Update history
19. Add tests
20. Benchmark all engines
21. Fix performance issues
22. Verify existing functionality
```

---

# 36. Important Engineering Rules

- Prefer native Apple Silicon/Core ML inference.
- Do not introduce Python services unless absolutely necessary.
- Do not duplicate audio capture.
- Do not duplicate AI cleanup.
- Do not duplicate dictionary logic.
- Do not couple React to model implementations.
- Do not bundle huge models unnecessarily.
- Prefer download-on-demand models.
- Keep raw transcripts.
- Make engine selection configurable.
- Make fallback configurable.
- Make language capabilities explicit.
- Never silently change user-selected engines.
- Never upload audio.
- Never log raw microphone content.
- Preserve technical terminology.
- Preserve the user's intended meaning.
- Optimize for low end-to-end latency.
- Reuse existing VOX implementation wherever possible.

## Final acceptance criteria

The implementation is complete only when this workflow works:

```text
User presses VOX hotkey
        ↓
Microphone starts
        ↓
Audio is normalized
        ↓
VAD detects speech
        ↓
TranscriptionRouter selects engine
        ↓
Apple / Whisper / Parakeet
        ↓
Raw transcript
        ↓
AI cleanup
        ↓
Personal dictionary
        ↓
Context-aware formatting
        ↓
Final transcript
        ↓
Text inserted into active application
        ↓
History stores raw + final + engine metadata
```

And the user can switch:

```text
Automatic
Apple Speech
Whisper
Parakeet
```

without changing the rest of the application.

Do not stop after designing the architecture. **Implement the changes in the existing repository, compile the application, run the relevant tests, fix build/type/runtime errors, and leave the project in a working state.**