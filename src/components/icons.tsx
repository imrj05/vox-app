/* eslint-disable react-refresh/only-export-components */
import { forwardRef, type SVGProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AlertTriangle as HugeAlertTriangle,
  BookOpenTextIcon as HugeBookOpenText,
  Cancel01Icon as HugeX,
  CancelCircleIcon as HugeXCircle,
  Checkmark as HugeCheck,
  CheckmarkCircle02Icon as HugeCheckCircle,
  ChevronDown as HugeChevronDown,
  ChevronLeft as HugeChevronLeft,
  ChevronRight as HugeChevronRight,
  ChevronUp as HugeChevronUp,
  CodeIcon as HugeCode,
  CopyIcon as HugeCopy,
  CpuIcon as HugeCpu,
  Database01Icon as HugeDatabase,
  Download01Icon as HugeDownload,
  ExternalLink as HugeExternalLink,
  FileText as HugeFileText,
  GlobeIcon as HugeGlobe,
  HelpCircleIcon as HugeCircleHelp,
  Home01Icon as HugeHome,
  InformationCircleIcon as HugeInfo,
  KeyboardIcon as HugeKeyboard,
  LoaderCircle as HugeLoaderCircle,
  LogIn as HugeLogIn,
  Mail01Icon as HugeMail,
  MicIcon as HugeMic,
  MinusSignIcon as HugeMinus,
  Monitor as HugeMonitor,
  MonitorSmartphone as HugeMonitorSmartphone,
  Moon02Icon as HugeMoon,
  MoreHorizontalIcon as HugeMoreHorizontal,
  OctagonXIcon as HugeOctagonX,
  PanelLeftIcon as HugePanelLeft,
  PencilEdit01Icon as HugePencil,
  PlusSignIcon as HugePlus,
  Search01Icon as HugeSearch,
  Settings02Icon as HugeSettings,
  ShieldAlert as HugeShieldAlert,
  ShieldCheck as HugeShieldCheck,
  SparklesIcon as HugeSparkles,
  SquareIcon as HugeSquare,
  Sun03Icon as HugeSun,
  Trash as HugeTrash,
  VolumeHighIcon as HugeVolume,
  WandSparkles as HugeWand,
} from "@hugeicons/core-free-icons";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};

function createIcon(icon: IconSvgElement) {
  return forwardRef<SVGSVGElement, IconProps>(function Icon(
    { color = "currentColor", strokeWidth = 1.75, ...props },
    ref
  ) {
    return (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        color={color}
        strokeWidth={strokeWidth}
        {...props}
      />
    );
  });
}

export const AlertTriangleIcon = createIcon(HugeAlertTriangle);
export const BookOpenText = createIcon(HugeBookOpenText);
export const CancelIcon = createIcon(HugeX);
export const Check = createIcon(HugeCheck);
export const CheckCircle2 = createIcon(HugeCheckCircle);
export const CheckIcon = Check;
export const ChevronDownIcon = createIcon(HugeChevronDown);
export const ChevronLeftIcon = createIcon(HugeChevronLeft);
export const ChevronRightIcon = createIcon(HugeChevronRight);
export const ChevronUpIcon = createIcon(HugeChevronUp);
export const CircleCheckIcon = CheckCircle2;
export const CircleHelp = createIcon(HugeCircleHelp);
export const Code2 = createIcon(HugeCode);
export const Copy = createIcon(HugeCopy);
export const Cpu = createIcon(HugeCpu);
export const Database = createIcon(HugeDatabase);
export const Download = createIcon(HugeDownload);
export const ExternalLink = createIcon(HugeExternalLink);
export const FileText = createIcon(HugeFileText);
export const Globe = createIcon(HugeGlobe);
export const Home = createIcon(HugeHome);
export const InfoIcon = createIcon(HugeInfo);
export const Keyboard = createIcon(HugeKeyboard);
export const LoaderCircle = createIcon(HugeLoaderCircle);
export const LogIn = createIcon(HugeLogIn);
export const Mail = createIcon(HugeMail);
export const Mic = createIcon(HugeMic);
export const MinusIcon = createIcon(HugeMinus);
export const Monitor = createIcon(HugeMonitor);
export const MonitorSmartphone = createIcon(HugeMonitorSmartphone);
export const Moon = createIcon(HugeMoon);
export const MoreHorizontalIcon = createIcon(HugeMoreHorizontal);
export const OctagonXIcon = createIcon(HugeOctagonX);
export const PanelLeftIcon = createIcon(HugePanelLeft);
export const Pencil = createIcon(HugePencil);
export const Plus = createIcon(HugePlus);
export const Search = createIcon(HugeSearch);
export const SearchIcon = Search;
export const Settings = createIcon(HugeSettings);
export const ShieldAlert = createIcon(HugeShieldAlert);
export const ShieldCheck = createIcon(HugeShieldCheck);
export const Sparkles = createIcon(HugeSparkles);
export const Square = createIcon(HugeSquare);
export const Sun = createIcon(HugeSun);
export const Trash2 = createIcon(HugeTrash);
export const TriangleAlertIcon = AlertTriangleIcon;
export const Volume2 = createIcon(HugeVolume);
export const Wand2 = createIcon(HugeWand);
export const X = CancelIcon;
export const XCircle = createIcon(HugeXCircle);
export const XIcon = CancelIcon;
