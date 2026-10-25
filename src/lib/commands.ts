/**
 * Cross-page commands.
 *
 * The command palette and the global keyboard layer trigger actions that live
 * inside other pages (start a recording, create a note, open a settings
 * section). Because pages are lazy-loaded, a command can be issued *before* its
 * target page exists — so commands are queued per target and delivered when
 * that page subscribes.
 *
 * Delivery is always asynchronous (a timer callback, never the caller's
 * stack), which keeps the receiving page's state updates out of the render
 * and effect phases.
 */

export type CommandKind =
  /** Page that owns the command. */
  | "toggle-recording"
  | "new-note"
  | "open-settings-section"
  | "open-vocabulary-tab"
  | "focus-transcript"
  | "focus-note"
  | "focus-correction"
  | "show-transform";

export interface Command {
  id: number;
  kind: CommandKind;
  payload?: unknown;
}

/** Page identifiers used as command targets. */
export const COMMAND_TARGETS = {
  app: "app",
  home: "home",
  notes: "notes",
  settings: "settings",
  vocabulary: "vocabulary",
  transcripts: "transcripts",
} as const;

type Handler = (command: Command) => void;

const subscribers = new Map<string, Set<Handler>>();
const queued = new Map<string, Command>();
let counter = 0;

/**
 * Send a command to a page. If that page is not mounted yet, the command is
 * held until it subscribes.
 */
export function emitCommand(
  target: string,
  kind: CommandKind,
  payload?: unknown,
) {
  const command: Command = { id: ++counter, kind, payload };
  const handlers = subscribers.get(target);
  if (handlers && handlers.size > 0) {
    window.setTimeout(() => {
      handlers.forEach((handler) => handler(command));
    }, 0);
    return;
  }
  queued.set(target, command);
}

/**
 * Listen for commands aimed at a page. Any command queued while the page was
 * unmounted is delivered right after subscribing.
 */
export function subscribeCommand(target: string, handler: Handler) {
  const handlers = subscribers.get(target) ?? new Set<Handler>();
  handlers.add(handler);
  subscribers.set(target, handlers);
  const pending = queued.get(target);
  if (pending) {
    queued.delete(target);
    window.setTimeout(() => handler(pending), 0);
  }
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      subscribers.delete(target);
    }
  };
}
