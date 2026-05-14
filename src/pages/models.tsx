import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Cpu, Download, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  downloadWhisperModel,
  listWhisperModels,
  type WhisperModelInfo,
} from "@/lib/native";

interface DownloadProgress {
  modelName: string;
  downloaded: number;
  total: number;
}

function formatModelSize(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function ModelsPage() {
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void listWhisperModels()
      .then((models) => {
        if (active) setModels(models);
      })
      .catch(() => {
        if (active) {
          setModels([]);
          setError("Model management is only available in the Tauri desktop app.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Listen for download progress events from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<DownloadProgress>("vox-download-progress", (event) => {
      setProgress(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleDownload = async (modelName: string) => {
    setDownloading(modelName);
    setProgress(null);
    setError(null);

    try {
      await downloadWhisperModel(modelName);
      setModels(await listWhisperModels());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-3xl">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Local Whisper Models
          </h2>
          <p className="text-xs text-muted-foreground">
            Download and manage local speech recognition models. Larger models
            offer better accuracy but require more memory.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-border bg-card p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-3">
          {loading && (
            <p className="text-xs text-muted-foreground">
              Loading local model status...
            </p>
          )}

          {models.map((model) => {
            const isDownloading = downloading === model.name;
            const pct =
              isDownloading && progress && progress.total > 0
                ? Math.round((progress.downloaded / progress.total) * 100)
                : null;

            return (
              <div
                key={model.name}
                className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-ring transition-colors"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent shrink-0">
                  <Cpu className="h-5 w-5 text-accent-foreground" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {model.displayName}
                    </h3>
                    <Badge
                      variant={model.downloaded ? "accent" : "secondary"}
                      className="text-[10px]"
                    >
                      {model.downloaded
                        ? "Downloaded"
                        : model.recommended
                          ? "Recommended"
                          : "Available"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <span>{formatModelSize(model.size)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{model.name}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{model.recommended ? "Default choice" : "Higher accuracy"}</span>
                  </div>

                  {/* Progress bar */}
                  {isDownloading && pct !== null && (
                    <div className="mt-2 space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-150"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {pct}% — {Math.round((progress?.downloaded ?? 0) / 1024 / 1024)} / {Math.round((progress?.total ?? 0) / 1024 / 1024)} MB
                      </p>
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  {model.downloaded ? (
                    <div className="flex items-center gap-1.5 text-primary">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-xs font-medium">Ready</span>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownload(model.name)}
                      disabled={downloading !== null}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {isDownloading ? `${pct ?? 0}%` : "Download"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
