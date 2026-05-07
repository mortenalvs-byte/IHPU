// reportModel.ts — builds a ReportModel from the analysis already computed
// by the UI/domain layer.
//
// CRITICAL invariant: this module never recomputes drop, dropPct, durations,
// or any other analysis number. Every value comes from `state.baselineDrop`,
// `state.targetDrop`, and `state.holdResult` — the same objects the dashboard
// is reading from. This is what guarantees that what the operator sees in
// the UI, what the CSV row contains, and what the PDF report prints, are
// the same numbers.

import type {
  HoldPeriodResult,
  ParseResult,
  PressureChannel,
  PressureDropResult
} from '../domain/types';
import type {
  ReportAnalysis,
  ReportBuildResult,
  ReportCriteria,
  ReportHold,
  ReportMetadata,
  ReportParserSummary,
  ReportSelectedPeriod
} from './reportTypes';

export interface BuildReportInput {
  parseResult: ParseResult | null;
  baselineDrop: PressureDropResult | null;
  targetDrop: PressureDropResult | null;
  holdResult: HoldPeriodResult | null;
  selectedChannel: PressureChannel;
  maxDropPct: number;
  targetPressure: number | null;
  selectedFromTimestampMs: number | null;
  selectedToTimestampMs: number | null;
  selectedFromTimeText: string;
  selectedToTimeText: string;
  selectedFileName: string | null;
  reportMetadata: ReportMetadata;
}

/**
 * Build a ReportModel from current UI state. Returns a discriminated union;
 * never throws. Callers must check `result.ok` before reading `result.report`.
 *
 * The function reads only the supplied input — no DOM, no fetch, no file IO.
 */
export function buildReportModel(input: BuildReportInput): ReportBuildResult {
  const pr = input.parseResult;
  if (!pr) {
    return {
      ok: false,
      error: { code: 'NO_FILE', message: 'Ingen fil lastet — kan ikke bygge rapport.' }
    };
  }
  if (pr.rows.length === 0) {
    return {
      ok: false,
      error: { code: 'NO_ROWS', message: 'Ingen gyldige trykkdata-rader fra parser.' }
    };
  }
  if (!input.baselineDrop) {
    return {
      ok: false,
      error: { code: 'NO_ANALYSIS', message: 'Trykkfallanalyse mangler — kan ikke bygge rapport.' }
    };
  }
  if (!input.holdResult) {
    return {
      ok: false,
      error: { code: 'NO_HOLD', message: 'Holdperiode-evaluering mangler — kan ikke bygge rapport.' }
    };
  }

  const baseline = input.baselineDrop;
  const target = input.targetDrop;
  const hold = input.holdResult;

  const parser: ReportParserSummary = {
    parsedRows: pr.meta.parsedRows,
    warnings: pr.warnings.length,
    errors: pr.errors.length,
    firstTimestamp: pr.rows.length > 0 ? pr.rows[0]!.localIso : null,
    lastTimestamp: pr.rows.length > 0 ? pr.rows[pr.rows.length - 1]!.localIso : null,
    durationMinutes: pr.meta.durationMinutes
  };

  const isFullRange = input.selectedFromTimestampMs === null && input.selectedToTimestampMs === null;
  const selectedPeriod: ReportSelectedPeriod = {
    fromIso: input.selectedFromTimestampMs !== null ? msToLocalIso(input.selectedFromTimestampMs) : null,
    toIso: input.selectedToTimestampMs !== null ? msToLocalIso(input.selectedToTimestampMs) : null,
    fromText: input.selectedFromTimeText,
    toText: input.selectedToTimeText,
    durationMinutes: baseline.durationMinutes,
    isFullRange
  };

  const analysis: ReportAnalysis = {
    channel: input.selectedChannel,
    startPressure: baseline.startPressure,
    endPressure: baseline.endPressure,
    dropBar: baseline.dropBar,
    dropPctOfStart: baseline.dropPct,
    dropPctOfTarget: target?.dropPct ?? null,
    barPerMinute: baseline.dropBarPerMinute,
    barPerHour: baseline.dropBarPerHour,
    pressureIncreased:
      baseline.dropBar === null || baseline.dropBar === undefined ? null : baseline.dropBar < 0
  };

  const criteria: ReportCriteria = {
    maxDropPct: input.maxDropPct,
    targetPressure: input.targetPressure,
    referencePressure: hold.drop.referencePressure
  };

  const usedDropPct = hold.drop.dropPct;
  const reportHold: ReportHold = {
    status: hold.status,
    usedDropPct,
    allowedDropPct: input.maxDropPct,
    marginPct: usedDropPct !== null ? input.maxDropPct - usedDropPct : null,
    warnings: hold.warnings.map((w) => `${w.code}: ${w.message}`),
    errors: hold.errors.map((e) => `${e.code}: ${e.message}`)
  };

  const report = {
    generatedAtIso: new Date().toISOString(),
    sourceFileName: input.selectedFileName ?? '',
    parser,
    selectedPeriod,
    analysis,
    criteria,
    hold: reportHold,
    metadata: { ...input.reportMetadata }
  };

  return { ok: true, report };
}

function msToLocalIso(ms: number): string {
  // Match the parser's localIso convention: build from UTC getters because
  // the deterministic timestampMs was constructed via Date.UTC.
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}
