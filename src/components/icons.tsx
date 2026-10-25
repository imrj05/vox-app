import type { SVGProps } from "react";
import {
  HugeiconsIcon,
  type HugeiconsProps,
  type IconSvgElement,
} from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  BookOpenTextIcon,
  Briefcase01Icon,
  Cancel01Icon,
  CancelCircleIcon as HugeCancelCircleIcon,
  CancelSquareIcon,
  CheckmarkCircle01Icon,
  CodeIcon,
  CommandIcon as HugeCommandIcon,
  Comment01Icon,
  Copy01Icon,
  AppleIcon,
  CpuIcon,
  Database01Icon,
  Delete01Icon,
  Download01Icon,
  File01Icon,
  GlobeIcon,
  Home01Icon,
  InformationCircleIcon,
  KeyboardIcon,
  Loading02Icon,
  Login01Icon,
  MagicWand01Icon,
  Mail01Icon,
  Mic01Icon,
  Moon01Icon,
  MoreHorizontalIcon as HugeMoreHorizontalIcon,
  OctagonXIcon as HugeOctagonXIcon,
  PanelLeftIcon as HugePanelLeftIcon,
  PencilIcon,
  PlusSignIcon,
  QuestionIcon,
  RotateLeft01Icon,
  Search01Icon,
  Settings01Icon,
  SparklesIcon,
  Square01Icon,
  Sun01Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";

// Wrapper that turns a Huge Icons glyph definition into a React component.
// Acccepts standard SVG props (className, strokeWidth, aria-*) so these exports
// are drop-in replacements for the previous icon library. Huge icons default to
// `currentColor` with a 1.5px stroke, matching the rest of the UI.
function hi(icon: IconSvgElement) {
  return function Hugeicon(props: SVGProps<SVGSVGElement>) {
    return <HugeiconsIcon icon={icon} {...(props as unknown as HugeiconsProps)} />;
  };
}

// Huge Icons equivalents for each previously-Poppins icon, preserved under
// the `Ph*` names so every alias and re-export below keeps working.
const PhAppleLogo = hi(AppleIcon);
const PhArrowCounterClockwise = hi(RotateLeft01Icon);
const PhArrowSquareOut = hi(ArrowUpRight01Icon);
const PhBriefcase = hi(Briefcase01Icon);
const PhChatCircle = hi(Comment01Icon);
const PhCheckCircle = hi(CheckmarkCircle01Icon);
const PhCode = hi(CodeIcon);
const PhCommand = hi(HugeCommandIcon);
const PhCopy = hi(Copy01Icon);
const PhCpu = hi(CpuIcon);
const PhDatabase = hi(Database01Icon);
const PhDownload = hi(Download01Icon);
const PhEnvelope = hi(Mail01Icon);
const PhFileText = hi(File01Icon);
const PhGear = hi(Settings01Icon);
const PhGlobe = hi(GlobeIcon);
const PhHouse = hi(Home01Icon);
const PhMagicWand = hi(MagicWand01Icon);
const PhMagnifyingGlass = hi(Search01Icon);
const PhMicrophone = hi(Mic01Icon);
const PhMoon = hi(Moon01Icon);
const PhPencil = hi(PencilIcon);
const PhQuestion = hi(QuestionIcon);
const PhSparkle = hi(SparklesIcon);
const PhSquare = hi(Square01Icon);
const PhSun = hi(Sun01Icon);
const PhTrash = hi(Delete01Icon);
const PhX = hi(Cancel01Icon);
const PhXSquare = hi(CancelSquareIcon);

// Inline SVG components kept for glyphs without a faithful Huge Icons
// equivalent (chevrons, brand marks, bare check/minus, status shields,
// bullet lists and a plain monitor).
function CheckSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ListBulletsSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="3.5" cy="6" r="1" fill="currentColor" />
      <circle cx="3.5" cy="12" r="1" fill="currentColor" />
      <circle cx="3.5" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

function MonitorSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

function ShieldWarningSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
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

function MinusSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

function GithubSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
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

function AlertTriangleSvg({ ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

const BookOpenTextComp = hi(BookOpenTextIcon);
const InfoSvg = hi(InformationCircleIcon);
const KeyboardSvg = hi(KeyboardIcon);
const LoaderSvg = hi(Loading02Icon);
const LogInSvg = hi(Login01Icon);
const MoreHorizontalSvg = hi(HugeMoreHorizontalIcon);
const OctagonXSvg = hi(HugeOctagonXIcon);
const PanelLeftSvg = hi(HugePanelLeftIcon);
const PlusSvg = hi(PlusSignIcon);
const VolumeHighSvg = hi(VolumeHighIcon);
const CancelCircleSvg = hi(HugeCancelCircleIcon);

const PhCheck = CheckSvg;
const PhListBullets = ListBulletsSvg;
const PhMonitor = MonitorSvg;
const PhShieldWarning = ShieldWarningSvg;

// App-specific aliases — keep these stable so imports across the app keep working.
export const AppleLogo = PhAppleLogo;
export const ArrowTurnBackward = PhArrowCounterClockwise;
export const BookOpenText = BookOpenTextComp;
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
export const Github = GithubSvg;
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
export const CommandIcon = PhCommand;
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
export const XSquare = PhXSquare;
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
export { PhArrowCounterClockwise as ArrowCounterClockwise, PhArrowSquareOut as ArrowSquareOut, PhBriefcase, PhChatCircle as ChatCircle, PhCheck, PhCheckCircle as CheckCircle, PhCode, PhCopy, PhCpu, PhDatabase, PhDownload, PhEnvelope as Envelope, PhFileText, PhGear, PhGlobe, PhHouse as House, PhListBullets as ListBullets, PhMagicWand as MagicWand, PhMagnifyingGlass as MagnifyingGlass, PhMicrophone as Microphone, PhMoon, PhPencil, PhQuestion as Question, PhShieldWarning as ShieldWarning, PhSparkle as Sparkle, PhSquare, PhSun, PhTrash as Trash, PhX };
