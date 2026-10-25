import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { VocabularyPacksSection } from "@/components/settings-vocabulary";
import { COMMAND_TARGETS, subscribeCommand } from "@/lib/commands";
import {
  deleteCorrectionPair,
  getCorrections,
  getCorrectionsStats,
  saveCorrections,
  type CorrectionRow,
} from "@/lib/db";
import {
  evaluateVocabulary,
  recordVocabularyCorrection,
  type VocabularyEvalReport,
} from "@/lib/vocabulary";
import { ArrowTurnBackward, CheckCircle2, Plus, Trash2 } from "@/components/icons";

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Vocabulary (spec §13/§17): everything the app has learned about your words —
 * what it heard, what it became, how often — plus the packs that organize
 * technical terms. One page, so there is a single place to teach.
 */
export function VocabularyPage() {
  const [tab, setTab] = useState("learned");
  const [highlightedPair, setHighlightedPair] = useState<{
    source: string;
    canonical: string;
  } | null>(null);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [stats, setStats] = useState({
    totalCorrections: 0,
    dictationsImproved: 0,
    distinctTerms: 0,
    lowConfidenceCorrections: 0,
  });
  const [loading, setLoading] = useState(true);
  // The command palette can deep-link into a specific tab, and to a specific
  // correction pair.
  useEffect(() => {
    return subscribeCommand(COMMAND_TARGETS.vocabulary, (command) => {
      if (command.kind === "open-vocabulary-tab") {
        setTab(typeof command.payload === "string" ? command.payload : "packs");
        return;
      }
      if (command.kind === "focus-correction") {
        const pair = command.payload as { source: string; canonical: string };
        setTab("learned");
        setHighlightedPair(pair);
      }
    });
  }, []);
  const [heard, setHeard] = useState("");
  const [correct, setCorrect] = useState("");
  const [teaching, setTeaching] = useState(false);
  const [evalReport, setEvalReport] = useState<VocabularyEvalReport | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<{
    pairs: CorrectionRow[];
    stats: {
      totalCorrections: number;
      dictationsImproved: number;
      distinctTerms: number;
      lowConfidenceCorrections: number;
    };
  }> => {
    const [pairs, nextStats] = await Promise.all([getCorrections(), getCorrectionsStats()]);
    setCorrections(pairs);
    setStats(nextStats);
    return { pairs, stats: nextStats };
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.all([getCorrections(), getCorrectionsStats()])
      .then(([pairs, nextStats]) => {
        if (!ignore) {
          setCorrections(pairs);
          setStats(nextStats);
          setLoading(false);
        }
      })
      .catch(() => {
        // DB errors leave the page empty; never fatal.
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const runQualityCheck = async () => {
    setEvalLoading(true);
    setEvalError(null);
    try {
      setEvalReport(await evaluateVocabulary());
    } catch (error) {
      setEvalError(error instanceof Error ? error.message : String(error));
    } finally {
      setEvalLoading(false);
    }
  };

  const teachCorrection = async () => {
    const source = heard.trim().toLowerCase();
    const canonical = correct.trim();
    if (!source || !canonical) return;
    setTeaching(true);
    try {
      await saveCorrections([{ source, canonical }]);
      // Train the vocabulary engine so future dictations of `source`
      // canonicalize to `correct` (spec §17).
      await recordVocabularyCorrection(source, canonical).catch(() => undefined);
      setHeard("");
      setCorrect("");
      await refresh();
    } catch {
      // Non-fatal.
    } finally {
      setTeaching(false);
    }
  };

  const removeCorrection = async (row: CorrectionRow) => {
    await deleteCorrectionPair(row.source, row.canonical).catch(() => undefined);
    await refresh();
  };

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="page-shell">
          <header className="page-header">
            <div>
              <h1 className="page-title">Vocabulary</h1>
              <p className="page-description">
                What the app has learned about your words, and the terms you taught it.
                Teach a correction once and every future dictation is fixed automatically.
              </p>
            </div>
          </header>

          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex flex-col gap-5"
          >
            <TabsList>
              <TabsTrigger value="learned">Learned</TabsTrigger>
              <TabsTrigger value="packs">Packs</TabsTrigger>
            </TabsList>

            <TabsContent
              value="learned"
              className="flex flex-col gap-5 duration-200 animate-in fade-in slide-in-from-top-1"
            >
          <div className="stat-strip divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <StatCard label="Corrections applied" value={stats.totalCorrections.toLocaleString()} />
            <StatCard label="Dictations improved" value={stats.dictationsImproved.toLocaleString()} />
            <StatCard label="Terms improved" value={stats.distinctTerms.toLocaleString()} />
            <StatCard label="Needs review" value={stats.lowConfidenceCorrections.toLocaleString()} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Teach a correction</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              If the app keeps hearing something wrong, tell it the right form once — it applies
              to every future dictation and ranks the term higher over time.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
              <Input
                value={heard}
                onChange={(event) => setHeard(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void teachCorrection();
                }}
                placeholder="Heard: shad can"
                className="h-11 rounded-xl bg-background px-4"
              />
              <ArrowTurnBackward className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <Input
                value={correct}
                onChange={(event) => setCorrect(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void teachCorrection();
                }}
                placeholder="Correct: shadcn"
                className="h-11 rounded-xl bg-background px-4"
              />
              <Button
                onClick={() => void teachCorrection()}
                disabled={!heard.trim() || !correct.trim() || teaching}
                className="h-11 rounded-xl px-5"
              >
                <Plus className="h-4 w-4" />
                Teach
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Quality check</p>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  Run the built-in evaluation set against your active vocabulary.
                  It checks word errors, missed technical terms, and false
                  corrections — entirely on this device.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runQualityCheck()}
                disabled={evalLoading}
              >
                {evalLoading ? (
                  <Spinner className="size-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Run check
              </Button>
            </div>
            {evalError ? (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {evalError}
              </p>
            ) : null}
            {evalReport ? (
              <div className="mt-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <QualityMetric
                    label="Word error rate"
                    value={formatRate(evalReport.vocabularyWer)}
                  />
                  <QualityMetric
                    label="Technical term errors"
                    value={formatRate(evalReport.technicalTermErrorRate)}
                  />
                  <QualityMetric
                    label="False corrections"
                    value={formatRate(evalReport.falseCorrectionRate)}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {
                    evalReport.caseResults.filter((result) => result.passed)
                      .length
                  }{" "}
                  of {evalReport.caseResults.length} cases match the expected
                  output.
                </p>
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading corrections
            </div>
          ) : corrections.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground/45" />
              <p className="mt-4 text-sm font-medium text-muted-foreground">
                No corrections yet.
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground/80">
                When the app fixes a term during dictation — or you teach one above — it shows
                up here so you can review exactly what changed.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {corrections.map((row) => (
                <div
                  key={`${row.source}\u0000${row.canonical}`}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3",
                    highlightedPair?.source === row.source &&
                      highlightedPair?.canonical === row.canonical &&
                      "ring-1 ring-primary/50 bg-primary/5"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm text-muted-foreground line-through decoration-muted-foreground/40">
                        {row.source}
                      </span>
                      <ArrowTurnBackward className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      <span className="truncate text-sm font-medium text-foreground">
                        {row.canonical}
                      </span>
                      {row.count > 1 && (
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          {row.count}×
                        </Badge>
                      )}
                      {isLowConfidence(row) && (
                        <Badge
                          variant="outline"
                          className="h-5 text-[10px] text-muted-foreground"
                          title="This correction was applied with low match or ASR confidence"
                        >
                          Low confidence
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground/80">
                      Last corrected {formatTimestamp(row.last_used_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void removeCorrection(row)}
                    title="Remove this correction"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            )}
            </TabsContent>

            <TabsContent
              value="packs"
              className="duration-200 animate-in fade-in slide-in-from-top-1"
            >
              <VocabularyPacksSection />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-4 text-center">
      <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-medium tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** A correction is worth reviewing when either the lexical match or the ASR
 * confidence was weak. */
function isLowConfidence(row: CorrectionRow): boolean {
  const matchLow = row.match_confidence != null && row.match_confidence < 0.92;
  const asrLow = row.asr_confidence != null && row.asr_confidence < 0.7;
  return matchLow || asrLow;
}