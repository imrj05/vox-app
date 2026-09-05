// apple-speech — Vox sidecar for Apple's Speech framework.
//
// Transcribes a WAV recording entirely on-device using SFSpeechRecognizer
// (available macOS 10.15+, including macOS 26 where the on-device models are
// the default).
//
// Usage:
//   apple-speech [--status] [-l <language-code>] <audio-path>
//   apple-speech --serve
//
// Single-shot mode prints the transcript as `text: <transcript>` (same
// convention as transcribe-cli) so the Rust engines share one parser.
//
//   --status        Print recognizer authorization/availability and exit.
//   --serve         Persistent mode: reads JSON requests on stdin, one per
//                   line: {"id": <n>, "audio": "<path>", "locale": "en-US"}.
//                   Responds with JSON per line and keeps recognizers warm
//                   across requests, eliminating per-call XPC/actor warmup.
//   -l <code>       BCP-47 language for the recognizer, e.g. "en-US", "hi-IN".
//                   Omitted → system default locale.
//
// Exit codes (single-shot and status):
//   0  success (transcript on stdout as "text: …")
//   2  usage error
//   3  recognizer unavailable for the requested language
//   4  speech recognition permission denied
//   5  authorization not determined (should not happen after request)
//   7  recognition failed
//   8  on-device recognition unsupported (refused: Vox never uploads audio)
//
// Serve-mode errors are delivered in-band as
// {"id": <n>, "ok": false, "code": <same codes as above>, "message": "..."}.

import AVFoundation
import Foundation
import Speech

let watchdogSeconds: TimeInterval = 180

// MARK: - Diagnostics

func diag(_ message: String) {
    FileHandle.standardError.write(Data("[VOX][apple-speech] \(message)\n".utf8))
}

func fail(_ code: Int32, _ message: String) -> Never {
    print("error: \(message)")
    exit(code)
}

// MARK: - Authorization (requested once per process, cached afterwards)

var cachedAuthorization: SFSpeechRecognizerAuthorizationStatus?

func authorizationStatus() -> SFSpeechRecognizerAuthorizationStatus {
    if let status = cachedAuthorization, status != .notDetermined {
        return status
    }
    var status: SFSpeechRecognizerAuthorizationStatus = .notDetermined
    SFSpeechRecognizer.requestAuthorization { granted in
        // Delivered on the main queue: run the run loop below instead of
        // blocking the main thread (semaphore wait would deadlock).
        status = granted
    }
    let deadline = Date().addingTimeInterval(15)
    while status == .notDetermined && RunLoop.current.run(mode: .default, before: deadline) {
        // keep pumping until the callback fires or the deadline passes
        if Date() >= deadline { break }
    }
    if status != .notDetermined {
        cachedAuthorization = status
    }
    return status
}

// MARK: - Recognizers (warmed and reused in serve mode)

var recognizerCache: [String: SFSpeechRecognizer] = [:]

func recognizer(for locale: Locale) -> SFSpeechRecognizer? {
    let key = locale.identifier
    if let cached = recognizerCache[key] {
        return cached.isAvailable ? cached : nil
    }
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
        return nil
    }
    recognizerCache[key] = recognizer
    return recognizer
}

// MARK: - Recognition (shared by single-shot and serve modes)

/// Runs file-based, on-device recognition to completion.
/// Returns (exitCode, text, message): exitCode 0 = success, `text` may be
/// empty to signal recognized silence.
func runRecognition(_ recognizer: SFSpeechRecognizer, audioPath: String, contextualStrings: [String] = []) -> (code: Int32, text: String, message: String) {
    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: audioPath))
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    // Privacy: audio is never uploaded to Apple servers.
    request.requiresOnDeviceRecognition = true
    // Vocabulary Packs: bias the on-device recognizer toward the user's
    // active vocabulary terms (capped upstream in the Rust adapter).
    if !contextualStrings.isEmpty {
        request.contextualStrings = contextualStrings
    }

    var finalText: String?
    var failure: String?
    var watchdogMessage: String?
    let started = Date()

    // Watchdog: recognition tasks can hang indefinitely on pathological input
    // (e.g. silence-only files). It flags a failure instead of exiting so the
    // serve process can keep serving later requests.
    let watchdog = DispatchWorkItem {
        watchdogMessage = "recognition timed out after \(Int(watchdogSeconds))s"
    }
    DispatchQueue.global(qos: .utility).asyncAfter(
        deadline: .now() + watchdogSeconds,
        execute: watchdog
    )

    recognizer.recognitionTask(with: request) { result, error in
        if let result = result, result.isFinal {
            finalText = result.bestTranscription.formattedString
            return
        }
        if let error = error {
            failure = error.localizedDescription
            return
        }
    }

    // Wait for completion by pumping the main run loop: recognition result
    // handlers are documented to arrive on an arbitrary queue, but in practice
    // Speech can deliver on the main queue — blocking the main thread with a
    // semaphore would deadlock. Bounded by the watchdog deadline above.
    let waitDeadline = Date().addingTimeInterval(watchdogSeconds)
    while finalText == nil && failure == nil && watchdogMessage == nil {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        if Date() >= waitDeadline {
            watchdogMessage = "recognition timed out after \(Int(watchdogSeconds))s"
            break
        }
    }
    watchdog.cancel()

    let elapsed = Int(Date().timeIntervalSince(started) * 1000)
    if let failure = failure {
        diag("recognition failed after \(elapsed)ms: \(failure)")
        return (7, "", "recognition failed: \(failure)")
    }
    if let watchdogMessage = watchdogMessage {
        diag("recognition abandoned after \(elapsed)ms: \(watchdogMessage)")
        return (7, "", watchdogMessage)
    }
    guard let finalText = finalText else {
        return (0, "", "")
    }
    diag("recognition completed in \(elapsed)ms (\(finalText.split(separator: " ").count) words)")
    return (0, finalText, "")
}

// MARK: - Serve mode (persistent, warm recognizers)

func writeServeResponse(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else {
        print("{\"id\":-1,\"ok\":false,\"code\":7,\"message\":\"response encoding error\"}")
        fflush(stdout)
        return
    }
    print(line)
    fflush(stdout)
}

func serveError(id: Int, code: Int, message: String) {
    writeServeResponse(["id": id, "ok": false, "code": code, "message": message])
}

func serveTranscription(_ json: [String: Any]) {
    let id = json["id"] as? Int ?? 0
    guard let audioPath = json["audio"] as? String, !audioPath.isEmpty else {
        serveError(id: id, code: 2, message: "missing audio path in request")
        return
    }
    let started = Date()
    guard FileManager.default.fileExists(atPath: audioPath) else {
        serveError(id: id, code: 2, message: "audio file not found: \(audioPath)")
        return
    }

    switch authorizationStatus() {
    case .authorized:
        break
    case .denied, .restricted:
        serveError(id: id, code: 4, message: "speech recognition permission denied — enable Vox in System Settings → Privacy & Security → Speech Recognition")
        return
    default:
        serveError(id: id, code: 5, message: "speech recognition permission not determined")
        return
    }

    let locale: Locale = (json["locale"] as? String).map { Locale(identifier: $0) } ?? .current
    guard let recognizer = recognizer(for: locale) else {
        serveError(id: id, code: 3, message: "no speech recognizer available for locale \(locale.identifier)")
        return
    }

    // Optional contextual strings from the Vocabulary Packs engine.
    let contextualStrings = (json["contextualStrings"] as? [Any])?.compactMap { $0 as? String } ?? []
    let outcome = runRecognition(recognizer, audioPath: audioPath, contextualStrings: contextualStrings)
    diag("request \(id) done in \(Int(Date().timeIntervalSince(started) * 1000))ms (code \(outcome.code))")
    if outcome.code == 0 {
        writeServeResponse(["id": id, "ok": true, "text": outcome.text])
    } else {
        serveError(id: id, code: Int(outcome.code), message: outcome.message)
    }
}

func serve() {
    diag("persistent mode ready (stdin: {\"id\": n, \"audio\": path, \"locale\": bcp47, \"contextualStrings\": [String]?} lines)")
    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }

        guard let data = trimmed.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              json["id"] != nil else {
            serveError(id: -1, code: 2, message: "malformed request line")
            continue
        }
        serveTranscription(json)
    }
    // stdin closed — parent is gone; exit cleanly.
    diag("stdin closed, exiting")
    exit(0)
}

// MARK: - Argument parsing

var arguments = Array(CommandLine.arguments.dropFirst())
var language: String?
var statusOnly = false
var serveMode = false
var audioPath: String?

var index = 0
while index < arguments.count {
    let argument = arguments[index]
    switch argument {
    case "-l", "--language":
        index += 1
        guard index < arguments.count else {
            fail(2, "missing language code after \(argument)")
        }
        language = arguments[index]
    case "--status":
        statusOnly = true
    case "--serve":
        serveMode = true
    default:
        guard !argument.hasPrefix("-") else {
            fail(2, "unknown option: \(argument)")
        }
        audioPath = argument
    }
    index += 1
}

// MARK: - Status mode (availability probe for the Rust engine)

if statusOnly {
    switch authorizationStatus() {
    case .authorized:
        // Probe a representative locale recognizer; per-language
        // availability is checked again at recognition time.
        if recognizer(for: Locale(identifier: "en-US")) != nil {
            print("status: available")
            exit(0)
        }
        print("status: unavailable")
        exit(3)
    case .denied, .restricted:
        print("status: denied")
        exit(4)
    default:
        print("status: not-determined")
        exit(5)
    }
}

// MARK: - Serve mode

if serveMode {
    serve()
}

// MARK: - Single-shot transcription mode

guard let audioPath = audioPath else {
    fail(2, "missing audio path")
}
guard FileManager.default.fileExists(atPath: audioPath) else {
    fail(2, "audio file not found: \(audioPath)")
}

switch authorizationStatus() {
case .authorized:
    break
case .denied, .restricted:
    fail(4, "speech recognition permission denied — enable Vox in System Settings → Privacy & Security → Speech Recognition")
case .notDetermined:
    fail(5, "speech recognition permission not determined")
@unknown default:
    fail(5, "unknown speech recognition permission state")
}

let locale: Locale
if let language = language {
    locale = Locale(identifier: language)
} else {
    locale = Locale.current
}

guard let recognizer = recognizer(for: locale) else {
    fail(3, "no speech recognizer available for locale \(locale.identifier)")
}

// Audio session setup is a no-op for file-based recognition, but AVAudioFile
// reading still requires the process to have input-capable entitlements; reading
// a plain file does not open a hardware session, which keeps the sidecar simple.

let outcome = runRecognition(recognizer, audioPath: audioPath)
if outcome.code != 0 {
    fail(outcome.code, outcome.message)
}

guard !outcome.text.isEmpty else {
    // No words recognized — report empty so the app can treat it as silence
    // rather than a hard error (hands-free segments may be pure noise).
    print("text: (empty)")
    exit(0)
}

print("text: \(outcome.text)")
exit(0)