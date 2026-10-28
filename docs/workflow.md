# Vox Workflow

How a dictation travels through the app, from the global hotkey to text at the
cursor and a row in SQLite.

## 1. End-to-end dictation loop

```mermaid
flowchart TD
    subgraph TRIGGER["1 · Trigger"]
        HK["Global hotkey<br/>default ⌘⇧Space"]
        LIS["Hotkey listener<br/>tauri plugin + CGEventTap"]
        ALT["Menu bar tray · CLI · in-app button"]
        MODE{"Trigger mode?"}

        HK --> LIS --> MODE
        ALT --> MODE
        MODE -->|"Toggle"| TOG["Press to start<br/>press again to stop"]
        MODE -->|"Push-to-talk"| PTT["Hold to record<br/>release to stop"]
        MODE -->|"Hands-free"| HF["VAD splits speech<br/>on silence"]
    end

    subgraph CAPTURE["2 · Capture"]
        PRE{"Engine and model<br/>available?"}
        WIDGET["Widget: Listening…<br/>frontmost app + window title"]
        REC["cpal input stream<br/>→ 16-bit WAV"]
        LEVELS["Audio levels<br/>→ 7-bar waveform + timer"]
        LIVE["Apple Speech live preview<br/>only when Apple is selected"]

        TOG --> PRE
        PTT --> PRE
        HF --> PRE
        PRE -->|"no"| ERR0["Widget: error<br/>actionable reason"]
        PRE -->|"yes"| WIDGET --> REC
        REC --> LEVELS
        REC --> LIVE
    end

    subgraph TRANSCRIBE["3 · Transcribe"]
        STOP["Stop: hotkey · release ·<br/>silence timeout · UI"]
        TRANS["Widget: Transcribing…"]
        CHECK{"Audio valid?<br/>not empty, not silent"}
        ROUTE["Engine router<br/>see diagram 2"]
        BLANK{"Blank or filler?"}

        REC --> STOP --> TRANS --> CHECK
        CHECK -->|"no"| ERR1["Widget: error<br/>mic / permission hint"]
        CHECK -->|"yes"| ROUTE
        ROUTE -->|"no fallback or<br/>every engine failed"| ERR2["Widget: error"]
        ROUTE --> BLANK
        BLANK -->|"yes"| NOSPEECH["Widget: No speech detected"]
    end

    subgraph POST["4 · Post-process"]
        FMT["Context formatting<br/>auto · plain · developer"]
        CLEAN["AI cleanup<br/>none · light · medium · high"]
        VOCAB["Vocabulary Packs correction<br/>runs on every engine"]
        SNIP["Snippet expansion<br/>trigger phrase → text"]

        BLANK -->|"no"| FMT --> CLEAN --> VOCAB --> SNIP
    end

    subgraph DELIVER["5 · Deliver"]
        KIND{"Whole utterance is a<br/>voice command or macro?"}
        ACT["Act on selected text<br/>transform overlay"]
        MACRO["Run macro steps<br/>never enters history"]
        INS["Insert at cursor<br/>typing default, clipboard optional"]
        RETRY["Insertion failed<br/>UI offers copy / retry"]
        DONE["Widget: done<br/>Undo · Enhance"]

        SNIP --> KIND
        KIND -->|"voice command"| ACT
        KIND -->|"macro"| MACRO
        KIND -->|"no"| INS
        INS -->|"did not land"| RETRY
        INS --> DONE
    end

    subgraph PERSIST["6 · Persist"]
        PRIV{"Private<br/>dictation?"}
        DEL["Delete audio<br/>save nothing, learn nothing"]
        EVENT["emit vox-transcription-complete"]
        SAVE["React listener writes SQLite<br/>transcripts + corrections"]
        VIEWS["Home · Transcripts · Insights refresh"]

        DONE --> PRIV
        PRIV -->|"yes"| DEL
        PRIV -->|"no"| EVENT --> SAVE --> VIEWS
    end
```

Notes:

- **Private dictation** (tray) skips history, vocabulary learning, and the
  completion event; the audio file is deleted after insertion.
- **Hands-free** keeps recording and emits a segment after each silence gap,
  so one session can insert and save several transcripts.
- **Developer formatting** short-circuits AI cleanup so dictated code, paths,
  flags, and symbols are never rephrased.
- A **pinned model** on the Models page wins over engine auto-selection.

## 2. Engine routing and fallback

```mermaid
flowchart TD
    START["route_transcribe(audio)"] --> MODEL{"Explicit model<br/>picked?"}
    MODEL -->|"yes"| BYFILE["Engine is chosen by<br/>the model file format"]
    MODEL -->|"no"| ENGINE{"Engine setting"}

    ENGINE -->|"whisper / parakeet / apple"| PICK["Engine picks its<br/>preferred model"]
    ENGINE -->|"auto"| AUTO["Auto strategy"]

    AUTO --> A1{"English dictation<br/>and Parakeet installed?"}
    A1 -->|"yes"| PARA["Parakeet"]
    A1 -->|"no"| A2{"Whisper model<br/>downloaded?"}
    A2 -->|"yes"| WHIS["Whisper<br/>multilingual"]
    A2 -->|"no"| A3{"Parakeet<br/>available?"}
    A3 -->|"yes"| PARA
    A3 -->|"no"| APPLE["Apple Speech<br/>no model download"]

    BYFILE --> RUN["engine.transcribe()"]
    PICK --> RUN
    PARA --> RUN
    WHIS --> RUN
    APPLE --> RUN

    RUN --> OK["Raw transcript<br/>engine id + confidence"]
    RUN -->|"model missing · language<br/>unsupported · runtime error"| FB{"Fallback enabled?"}
    FB -->|"no"| FAIL["Return the primary<br/>engine's error"]
    FB -->|"yes"| NEXT["Try preferred fallback first,<br/>then remaining engines<br/>that support the language"]
    NEXT -->|"succeeds"| OK2["Transcript tagged with the<br/>engine that actually ran<br/>+ fallback event"]
    NEXT -->|"all fail"| FAIL
```

Engine switches are never silent: they emit `transcription_engine_fallback`
and `transcription_engine_changed`, which the UI turns into warning/success
toasts.

## 3. Hotkey path, in sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant OS as macOS
    participant R as Rust core
    participant E as ASR engine
    participant W as Widget
    participant T as Target app
    participant UI as React UI
    participant DB as SQLite

    U->>OS: press global hotkey
    OS->>R: plugin or CGEventTap event
    R->>R: preflight engine + model
    R->>W: show "Listening…"
    R->>R: capture mic to WAV, read app context
    R->>W: waveform levels + elapsed time
    U->>OS: press again / release
    OS->>R: stop
    R->>W: "Transcribing…"
    R->>E: route transcript request
    E-->>R: raw text + engine + confidence
    Note over R: format → cleanup → vocabulary → snippets
    R->>T: insert text at cursor
    R->>W: "done" with Undo
    R-->>UI: vox-transcription-complete
    UI->>DB: save transcript + corrections
    UI-->>U: history and insights update
```

## 4. Surfaces and storage

```mermaid
flowchart LR
    subgraph WEB["React 19 · TypeScript · Vite"]
        MAIN["Main window<br/>Home · Transcripts · Vocabulary<br/>Notes · Models · Settings · About"]
        WID["Widget overlay"]
        ENH["Enhance overlay"]
        STORE["Zustand store"]
    end

    subgraph CORE["Rust core · Tauri v2"]
        CMDS["Tauri commands"]
        HOT["Hotkey + event tap"]
        CAP["cpal capture"]
        ROUTER["Engine router"]
        POST["Format · cleanup ·<br/>vocabulary · snippets"]
        INSERT["enigo insertion<br/>+ clipboard restore"]
    end

    subgraph ENGINES["On-device engines"]
        WH["Whisper · Metal"]
        PK["Parakeet · GGUF"]
        AS["Apple Speech"]
    end

    subgraph LOCAL["Local only"]
        DB["SQLite vox.db<br/>transcripts · settings · notes<br/>snippets · corrections"]
        FILES["Model files<br/>recordings · logs"]
    end

    MAIN --> CMDS
    WID --> CMDS
    ENH --> CMDS
    STORE --> CMDS

    HOT --> CAP --> ROUTER
    ROUTER --> WH
    ROUTER --> PK
    ROUTER --> AS
    ROUTER --> POST --> INSERT
    ROUTER --> FILES
    CMDS --> DB
    POST --> CMDS
```

No cloud path exists by design: audio, transcripts, models, and history stay
on the machine.
