import { SITE } from "@/lib/site";

export const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#engines", label: "Engines" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
] as const;

export const ENGINE_TICKER = [
  { name: "Apple Speech", meta: "System recognizer" },
  { name: "Parakeet", meta: "Local model" },
  { name: "Whisper", meta: "7 model sizes" },
  { name: "Apple Speech", meta: "No download" },
  { name: "Parakeet", meta: "In-process" },
  { name: "Whisper", meta: "Metal accelerated" },
] as const;

export type FeatureTone = "sky" | "sun" | "coral";

export interface Feature {
  index: string;
  title: string;
  body: string;
  tone: FeatureTone;
  href: string;
}

export const FEATURES: Feature[] = [
  {
    index: "01",
    title: "Runs inside your Mac",
    body: "Audio is captured, transcribed, and cleaned up in-process. There is no upload path to switch off, because there isn't one.",
    tone: "sky",
    href: "#privacy",
  },
  {
    index: "02",
    title: "One hotkey, every app",
    body: "Press ⌘⇧ Space in any field. Vox types at the cursor, so focus never leaves what you were already doing.",
    tone: "sun",
    href: "#how",
  },
  {
    index: "03",
    title: "Transcripts you keep",
    body: "Every transcript lands in local SQLite — searchable, prunable, and yours to delete. Retention is a setting, not a policy.",
    tone: "coral",
    href: "#faq",
  },
];

export type DemoId = "press" | "speak" | "land" | "route" | "format" | "history";

export interface WalkthroughStep {
  id: DemoId;
  label: string;
  title: string;
  body: string;
  explore: { label: string; href: string };
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "press",
    label: "hotkey",
    title: "From anywhere on the Mac",
    body: "⌘⇧ Space from any app, in toggle or push-to-talk mode. Bare-modifier shortcuts are handled through a native event tap.",
    explore: { label: "the hotkey", href: `${SITE.repository}#how-it-works` },
  },
  {
    id: "speak",
    label: "widget",
    title: "A capsule above your windows",
    body: "A floating capsule listens with a live waveform and timer. Focus never leaves the field you were already in.",
    explore: { label: "the widget", href: `${SITE.repository}#features` },
  },
  {
    id: "land",
    label: "cursor",
    title: "Typed where you already are",
    body: "The transcript is typed at the cursor. Long passages can paste instead, then restore what was on your clipboard.",
    explore: { label: "cursor insertion", href: `${SITE.repository}#how-it-works` },
  },
  {
    id: "route",
    label: "engines",
    title: "Three engines, pick one",
    body: "Apple Speech, Parakeet, and Whisper are swappable parts. Fallbacks are announced in the widget, never silent.",
    explore: { label: "engine routing", href: "#engines" },
  },
  {
    id: "format",
    label: "formatting",
    title: "Written the way the file needs",
    body: "Spoken punctuation, casing, and common git, npm, and docker phrases arrive as the syntax you meant.",
    explore: { label: "formatting", href: `${SITE.repository}#features` },
  },
  {
    id: "history",
    label: "history",
    title: "Kept in local SQLite",
    body: "Every transcript is stored next to the app — searchable, prunable, and deleted when you say so.",
    explore: { label: "transcript history", href: "#privacy" },
  },
];

export const PRIVACY_ROWS = [
  { label: "Capture", value: "Microphone → memory" },
  { label: "Transcribe", value: "Apple Speech · Parakeet · Whisper" },
  { label: "Enhance", value: "On-device model" },
  { label: "Network", value: "Not used" },
  { label: "Storage", value: "Local SQLite" },
  { label: "Requirements", value: "macOS 10.15+ · Apple Silicon recommended" },
] as const;

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Is any audio sent to a server?",
    answer:
      "No. Recording, transcription, and cleanup all run on this Mac. Crash reporting is optional and stays off unless you turn it on.",
  },
  {
    question: "Which Macs does Vox support?",
    answer:
      "macOS 10.15 (Catalina) or newer. Apple Silicon is recommended so local Whisper models can use Metal acceleration.",
  },
  {
    question: "Do I need an account or an API key?",
    answer:
      "No accounts, no sign-in, and no keys. The app works with the network unavailable.",
  },
  {
    question: "Which engine runs my audio?",
    answer:
      "Whichever you choose: Apple Speech, Parakeet, or Whisper. Vox can fall back when an engine cannot serve a request, and the widget tells you when it does instead of hiding the switch.",
  },
  {
    question: "What happens to my transcripts?",
    answer:
      "They are stored in a local SQLite database. Retention is configurable, and individual transcripts can be deleted from the app.",
  },
  {
    question: "Can I dictate into any app?",
    answer:
      "Yes. Vox types at the cursor in whatever app is focused. For long passages, clipboard mode can paste instead and then restore what was on your clipboard.",
  },
  {
    question: "Does it understand code and terminal commands?",
    answer:
      "Developer formatting turns spoken punctuation, casing, and common git, npm, and docker phrases into the syntax you meant.",
  },
  {
    question: "How do updates work?",
    answer:
      "Vox checks a signed update feed, downloads in the background, and installs on restart. Your settings and transcripts stay put.",
  },
];

export interface FooterColumn {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Engines", href: "#engines" },
      { label: "Privacy", href: "#privacy" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Download", href: SITE.downloadUrl, external: true },
      {
        label: "Changelog",
        href: `${SITE.repository}/blob/main/CHANGELOG.md`,
        external: true,
      },
      { label: "Source", href: SITE.repository, external: true },
    ],
  },
  {
    title: "Contact",
    links: [
      { label: "Email", href: `mailto:${SITE.email}` },
      { label: "Website", href: SITE.website, external: true },
    ],
  },
];
