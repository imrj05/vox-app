import { useEffect, useMemo, useRef, useState } from "react";
import { applyTransform, type TransformPreset } from "@/lib/native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { X, Sparkles, Wand2, Briefcase, MessageCircle, ListBullet, CheckCircle2 } from "@/components/icons";

interface TransformOverlayProps {
  open: boolean;
  onClose: () => void;
  initialText?: string;
  initialError?: string | null;
}

const PRESETS: { id: TransformPreset; label: string; icon: React.ReactNode }[] = [
  { id: "polish", label: "Polish", icon: <Sparkles className="h-4 w-4" /> },
  { id: "concise", label: "Make concise", icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: "professional", label: "Professional", icon: <Briefcase className="h-4 w-4" /> },
  { id: "casual", label: "Casual", icon: <MessageCircle className="h-4 w-4" /> },
  { id: "summarize", label: "Summarize", icon: <ListBullet className="h-4 w-4" /> },
  { id: "fixGrammar", label: "Fix grammar", icon: <Wand2 className="h-4 w-4" /> },
];

export function TransformOverlay({ open, onClose, initialText = "", initialError = null }: TransformOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const text = initialText;
  const error = applyError ?? initialError;

  const preview = useMemo(() => {
    if (!text) return "";
    if (text.length <= 180) return text;
    return `${text.slice(0, 180).trim()}…`;
  }, [text]);

  const runPreset = async (preset: TransformPreset) => {
    if (!text.trim()) return;
    setLoading(true);
    setApplyError(null);
    try {
      await applyTransform(text, preset);
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const runCustom = async () => {
    const instruction = customPrompt.trim();
    if (!instruction || !text.trim()) return;
    setLoading(true);
    setApplyError(null);
    try {
      await applyTransform(text, undefined, instruction);
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 p-4 supports-backdrop-filter:backdrop-blur-xs">
      <div className="w-full max-w-md rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">AI Transform</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        ) : text.trim() ? (
          <>
            <div className="mb-4 rounded-lg border border-border bg-muted px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Selected text</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/90">{preview}</p>
            </div>

            {loading && (
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Transforming…
              </div>
            )}

            <div className="mb-3 grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2"
                  onClick={() => void runPreset(preset.id)}
                  disabled={loading}
                >
                  {preset.icon}
                  {preset.label}
                </Button>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                ref={customInputRef}
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                placeholder="Or type a custom instruction…"
                className="h-9 flex-1"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && customPrompt.trim()) {
                    event.preventDefault();
                    void runCustom();
                  }
                }}
                disabled={loading}
              />
              <Button
                size="sm"
                onClick={() => void runCustom()}
                disabled={!customPrompt.trim() || loading}
              >
                {loading ? <Spinner className="size-4" /> : "Run"}
              </Button>
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No text selected. Select text in another app and try again.
          </div>
        )}
      </div>
    </div>
  );
}
