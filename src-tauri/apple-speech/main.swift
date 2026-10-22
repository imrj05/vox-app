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
/// `text` may be empty to signal recognized silence.
struct RecognitionOutcome {
    let code: Int32
    let text: String
    let message: String
    let confidence: Double?
}

/// Returns code 0 on success. `confidence` is the average segment confidence
/// when the recognizer reports one.
func runRecognition(_ recognizer: SFSpeechRecognizer, audioPath: String, contextualStrings: [String] = []) -> RecognitionOutcome {
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
    var finalConfidence: Double?
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
            let segments = result.bestTranscription.segments
            if !segments.isEmpty {
                finalConfidence = segments.reduce(0.0) { $0 + Double($1.confidence) } / Double(segments.count)
            }
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
        return RecognitionOutcome(code: 7, text: "", message: "recognition failed: \(failure)", confidence: nil)
    }
    if let watchdogMessage = watchdogMessage {
        diag("recognition abandoned after \(elapsed)ms: \(watchdogMessage)")
        return RecognitionOutcome(code: 7, text: "", message: watchdogMessage, confidence: nil)
    }
    guard let finalText = finalText else {
        return RecognitionOutcome(code: 0, text: "", message: "", confidence: nil)
    }
    diag("recognition completed in \(elapsed)ms (\(finalText.split(separator: " ").count) words)")
    return RecognitionOutcome(code: 0, text: finalText, message: "", confidence: finalConfidence)
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
        var payload: [String: Any] = ["id": id, "ok": true, "text": outcome.text]
        if let confidence = outcome.confidence {
            payload["confidence"] = confidence
        }
        writeServeResponse(payload)
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

// MARK: - Live mode (streaming partial transcription while recording)
//
// Runs SFSpeechAudioBufferRecognitionRequest against a live AVAudioEngine mic
// tap, emitting partial results as JSON lines on stdout:
//   {"type":"partial","text":"..."}
//   {"type":"final","text":"..."}
//   {"type":"error","message":"..."}
// Requests arrive on stdin as JSON lines:
//   {"type":"start","locale":"en-US"}   (optional locale; default = system)
//   {"type":"stop"}
// stdin EOF exits the process. This is a preview channel only — the parent
// app keeps capturing its own recording for the final transcription.

let liveStdoutLock = NSLock()

func writeLiveLine(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    liveStdoutLock.lock()
    print(line)
    fflush(stdout)
    liveStdoutLock.unlock()
}

final class LiveTranscriber {
    private let engine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// Finalized text from earlier recognition cycles (tasks auto-restart
    /// every ~45 s: Speech requests are best kept under a minute).
    private var accumulated = ""
    private var cycleStartedAt = Date()
    private let stateLock = NSLock()
    private var stopping = false

    func start(locale: Locale) {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            writeLiveLine(["type": "error", "message": "speech recognition permission not granted"])
            return
        }
        guard let resolvedRecognizer = recognizer(for: locale) else {
            writeLiveLine(["type": "error", "message": "no recognizer for \(locale.identifier)"])
            return
        }
        self.speechRecognizer = resolvedRecognizer

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            writeLiveLine(["type": "error", "message": "no microphone input available"])
            return
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            // Real-time audio thread: only cheap, non-blocking work here.
            self?.stateLock.lock()
            let request = self?.request
            self?.stateLock.unlock()
            request?.append(buffer)
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            writeLiveLine(["type": "error", "message": "audio engine failed: \(error.localizedDescription)"])
            return
        }
        startCycle()
        diag("live preview started (locale \(locale.identifier))")
    }

    private func startCycle() {
        stateLock.lock()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // Privacy: live preview never leaves the device.
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        self.request = request
        cycleStartedAt = Date()
        stateLock.unlock()

        task = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error, !self.stopping {
                writeLiveLine(["type": "error", "message": error.localizedDescription])
                return
            }
            guard let result = result else { return }
            let text = result.bestTranscription.formattedString
            let full = self.accumulated.isEmpty ? text : self.accumulated + " " + text
            if self.stopping {
                if result.isFinal {
                    var payload: [String: Any] = ["type": "final", "text": full]
                    let segments = result.bestTranscription.segments
                    if !segments.isEmpty {
                        payload["confidence"] = segments.reduce(0.0) { $0 + Double($1.confidence) } / Double(segments.count)
                    }
                    writeLiveLine(payload)
                }
                return
            }
            if !text.isEmpty {
                writeLiveLine(["type": "partial", "text": full])
            }
            // Restart long-running recognition cycles so no single request
            // exceeds Speech's practical ~1-minute task length.
            if Date().timeIntervalSince(self.cycleStartedAt) > 45 {
                self.accumulated = full
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    self?.restartCycle()
                }
            }
        }
    }

    private func restartCycle() {
        stateLock.lock()
        guard !stopping else { stateLock.unlock(); return }
        let oldRequest = request
        let oldTask = task
        request = nil
        stateLock.unlock()
        oldTask?.finish()
        oldRequest?.endAudio()
        startCycle()
    }

    /// Stops the mic tap and recognition; waits (on a background queue) for
    /// the final result, then reports it. Never blocks the caller.
    func stop() {
        stateLock.lock()
        stopping = true
        let request = self.request
        let task = self.task
        self.request = nil
        stateLock.unlock()

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        task?.finish()
        request?.endAudio()
    }
}

func liveServe() {
    let transcriber = LiveTranscriber()
    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }
        guard let data = trimmed.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            writeLiveLine(["type": "error", "message": "malformed live request line"])
            continue
        }
        switch (json["type"] as? String, json["locale"] as? String) {
        case ("start"?, let localeCode?):
            transcriber.start(locale: Locale(identifier: localeCode))
        case ("start"?, _):
            transcriber.start(locale: .current)
        case ("stop"?, _):
            transcriber.stop()
            // Give the final result a moment to arrive, then exit.
            Thread.sleep(forTimeInterval: 1.5)
            diag("live preview stopped")
            exit(0)
        default:
            writeLiveLine(["type": "error", "message": "unknown live request type"])
        }
    }
    // stdin closed — parent is gone; exit cleanly.
    diag("stdin closed, exiting live mode")
    exit(0)
}

// MARK: - Argument parsing

var arguments = Array(CommandLine.arguments.dropFirst())
var language: String?
var statusOnly = false
var serveMode = false
var liveMode = false
var checkPermissionOnly = false
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
    case "--live":
        liveMode = true
    case "--check-permission":
        checkPermissionOnly = true
    default:
        guard !argument.hasPrefix("-") else {
            fail(2, "unknown option: \(argument)")
        }
        audioPath = argument
    }
    index += 1
}

// MARK: - Permission probe (never triggers a TCC prompt)

if checkPermissionOnly {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized:
        print("status: granted")
        exit(0)
    case .denied, .restricted:
        print("status: denied")
        exit(4)
    default:
        print("status: not-determined")
        exit(5)
    }
}

// MARK: - Live mode

if liveMode {
    // The main thread only pumps the run loop so Speech callbacks delivered
    // on the main queue never stall; stdin is consumed on a background queue.
    DispatchQueue.global(qos: .userInitiated).async {
        liveServe()
    }
    RunLoop.main.run()
    exit(0)
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