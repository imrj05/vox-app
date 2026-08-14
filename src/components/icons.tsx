import type { SVGProps } from "react";
import {
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowSquareOut as PhArrowSquareOut,
  Briefcase as PhBriefcase,
  ChatCircle as PhChatCircle,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  Code as PhCode,
  Copy as PhCopy,
  Cpu as PhCpu,
  Database as PhDatabase,
  Download as PhDownload,
  Envelope as PhEnvelope,
  FileText as PhFileText,
  Gear as PhGear,
  Globe as PhGlobe,
  House as PhHouse,
  ListBullets as PhListBullets,
  MagicWand as PhMagicWand,
  MagnifyingGlass as PhMagnifyingGlass,
  Microphone as PhMicrophone,
  Monitor as PhMonitor,
  Moon as PhMoon,
  Pencil as PhPencil,
  Question as PhQuestion,
  ShieldWarning as PhShieldWarning,
  Sparkle as PhSparkle,
  Square as PhSquare,
  Sun as PhSun,
  Trash as PhTrash,
  X as PhX,
} from "@phosphor-icons/react";

// Inline SVG fallbacks for icons without a direct Phosphor equivalent.
function BookOpenTextSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      <path d="M6 7h2" />
      <path d="M6 11h2" />
      <path d="M16 7h2" />
      <path d="M16 11h2" />
    </svg>
  );
}

function ChevronDownSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronLeftSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronUpSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function InfoSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function KeyboardSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M7 16h10" />
    </svg>
  );
}

function LoaderSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function LogInSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" x2="3" y1="12" y2="12" />
    </svg>
  );
}

function MinusSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

function MoreHorizontalSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function OctagonXSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7.5 3.5h9l5 5v9l-5 5h-9l-5-5v-9z" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </svg>
  );
}

function PanelLeftSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function PlusSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function VolumeHighSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function ShieldCheckSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CancelCircleSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function AlertTriangleSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// App-specific aliases — keep these stable so imports across the app keep working.
export const ArrowTurnBackward = PhArrowCounterClockwise;
export const BookOpenText = BookOpenTextSvg;
export const Briefcase = PhBriefcase;
export const CancelIcon = PhX;
export const Check = PhCheck;
export const CheckCircle2 = PhCheckCircle;
export const ChevronDownIcon = ChevronDownSvg;
export const ChevronLeftIcon = ChevronLeftSvg;
export const ChevronRightIcon = ChevronRightSvg;
export const ChevronUpIcon = ChevronUpSvg;
export const CircleCheckIcon = PhCheckCircle;
export const CircleHelp = PhQuestion;
export const Code2 = PhCode;
export const Copy = PhCopy;
export const Cpu = PhCpu;
export const Database = PhDatabase;
export const Download = PhDownload;
export const ExternalLink = PhArrowSquareOut;
export const FileText = PhFileText;
export const Globe = PhGlobe;
export const Home = PhHouse;
export const InfoIcon = InfoSvg;
export const Keyboard = KeyboardSvg;
export const ListBullet = PhListBullets;
export const LoaderCircle = LoaderSvg;
export const LogIn = LogInSvg;
export const Mail = PhEnvelope;
export const Mic = PhMicrophone;
export const MinusIcon = MinusSvg;
export const Monitor = PhMonitor;
export const MonitorSmartphone = PhMonitor;
export const MessageCircle = PhChatCircle;
export const Moon = PhMoon;
export const MoreHorizontalIcon = MoreHorizontalSvg;
export const OctagonXIcon = OctagonXSvg;
export const PanelLeftIcon = PanelLeftSvg;
export const Pencil = PhPencil;
export const PlusIcon = PlusSvg;
export const Plus = PlusIcon;
export const Search = PhMagnifyingGlass;
export const Settings = PhGear;
export const ShieldAlert = PhShieldWarning;
export const ShieldCheck = ShieldCheckSvg;
export const Sparkles = PhSparkle;
export const Square = PhSquare;
export const Sun = PhSun;
export const Trash2 = PhTrash;
export const TrashIcon = PhTrash;
export const Volume2 = VolumeHighSvg;
export const Wand2 = PhMagicWand;
export const X = PhX;
export const XCircle = CancelCircleSvg;

// shadcn/ui wrapper aliases.
export const CheckIcon = PhCheck;
export const SearchIcon = PhMagnifyingGlass;
export const XIcon = PhX;

// Legacy aliases used by shadcn/ui wrappers and older code.
export const AlertTriangleIcon = AlertTriangleSvg;
export const TriangleAlertIcon = AlertTriangleSvg;
export const CancelCircleIcon = CancelCircleSvg;

// Direct re-exports for components that prefer the Phosphor names.
export {
  PhArrowCounterClockwise as ArrowCounterClockwise,
  PhArrowSquareOut as ArrowSquareOut,
  PhBriefcase,
  PhChatCircle as ChatCircle,
  PhCheck,
  PhCheckCircle as CheckCircle,
  PhCode,
  PhCopy,
  PhCpu,
  PhDatabase,
  PhDownload,
  PhEnvelope as Envelope,
  PhFileText,
  PhGear,
  PhGlobe,
  PhHouse as House,
  PhListBullets as ListBullets,
  PhMagicWand as MagicWand,
  PhMagnifyingGlass as MagnifyingGlass,
  PhMicrophone as Microphone,
  PhMoon,
  PhPencil,
  PhQuestion as Question,
  PhShieldWarning as ShieldWarning,
  PhSparkle as Sparkle,
  PhSquare,
  PhSun,
  PhTrash as Trash,
  PhX,
};
