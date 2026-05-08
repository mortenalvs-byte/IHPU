// Multi-file overlay/comparison foundation.
//
// A pure domain module that lets the renderer hold N parsed pressure logs
// alongside the primary single-file analysis and present them side-by-side.
// Each `OverlayEntry` is built by re-using the existing canonical pipeline
// (parseIhpuPressureLog → calculatePressureDrop → evaluateHoldPeriod) — there
// is NO parallel parser or analysis path. That guarantees the comparison
// table cannot disagree numerically with the primary dashboard.
//
// Pure TypeScript: no DOM, Electron, Chart.js, jsPDF, PapaParse, localStorage,
// reports, or session code. Runs identically in the renderer and in Vitest.
//
// See docs/development/multi-file-comparison-foundation.md.

import { evaluateHoldPeriod } from './holdPeriod';
import { parseIhpuPressureLog } from './ihpuParser';
import { calculatePressureDrop } from './pressureAnalysis';
import type {
  HoldPeriodCriteria,
  HoldPeriodResult,
  HoldPeriodStatus,
  ParseResult,
  PressureChannel,
  PressureDropResult
} from './types';

/** Stable, opaque id used to address an overlay entry from UI events. */
export type OverlayEntryId = string;

export interface OverlayChannelAnalysis {
  channel: PressureChannel;
  pressureSummary: PressureDropResult;
  holdPeriod: HoldPeriodResult;
}

/**
 * One uploaded comparison file plus its parser + per-channel analysis at
 * upload time.
 *
 * - `parseResult` is preserved verbatim — same shape as the primary single-file
 *   ParseResult, so any future feature that needs raw rows for a comparison
 *   entry has them available without re-parsing.
 * - `p1` / `p2` are null when the channel was not present in the parsed file.
 * - `addedAtMs` is the wall-clock timestamp at which the entry was added; it is
 *   used purely for display ("Lagt til kl HH:MM:SS") and stable id generation.
 */
export interface OverlayEntry {
  id: OverlayEntryId;
  filename: string;
  addedAtMs: number;
  parseResult: ParseResult;
  p1: OverlayChannelAnalysis | null;
  p2: OverlayChannelAnalysis | null;
}

export interface OverlayBuildOptions {
  /** Optional fixed id; useful for tests. Default = generated stable id. */
  id?: OverlayEntryId;
  /** Filename as picked by the operator. Stored verbatim, also fed to the parser as sourceName. */
  filename: string;
  /** Raw file text. The caller is responsible for reading the file off disk. */
  fileText: string;
  /** Optional explicit timestamp; default = Date.now(). Used for display + id stability. */
  addedAtMs?: number;
  /** Optional analysis criteria. Defaults to maxDropPct = 5, no targetPressure. */
  criteria?: HoldPeriodCriteria;
}

export type OverlayBuildFailureReason =
  /** Empty input or whitespace-only input. */
  | 'EMPTY_TEXT'
  /** Parser produced zero rows (all lines skipped). */
  | 'NO_VALID_ROWS'
  /** Parser produced explicit errors (malformed log). */
  | 'PARSE_FAILED';

/**
 * Result of attempting to build an overlay entry. Discriminated union so the
 * caller can branch on `ok` and never accidentally read a null entry.
 *
 * The function NEVER throws on a normal parse failure — it returns the
 * `parseResult` so the UI can surface row counts / first-error messages.
 */
export type OverlayBuildResult =
  | { ok: true; entry: OverlayEntry }
  | {
      ok: false;
      reason: OverlayBuildFailureReason;
      message: string;
      parseResult?: ParseResult;
    };

const DEFAULT_CRITERIA: HoldPeriodCriteria = { maxDropPct: 5 };

let overlayIdCounter = 0;

/**
 * Generate a deterministic-enough id from filename + timestamp + a process-local
 * monotonic counter. Two entries added in the same millisecond will not collide.
 *
 * Format: `oe_<addedAtMs>_<counter>_<sanitisedFilename>`. Length-bounded.
 * Exported for tests that want to assert id shape.
 */
export function generateOverlayEntryId(filename: string, addedAtMs: number): OverlayEntryId {
  overlayIdCounter = (overlayIdCounter + 1) % 1_000_000;
  const safe = filename.replace(/[^a-z0-9_-]/gi, '_').slice(0, 32);
  return `oe_${addedAtMs}_${overlayIdCounter}_${safe}`;
}

/**
 * Build an overlay entry from raw file text by re-using the canonical parser
 * and analysis pipeline. Any of three failure paths is reported via the
 * discriminated union; the function never throws on bad text.
 */
export function buildOverlayEntry(options: OverlayBuildOptions): OverlayBuildResult {
  const filename = options.filename || 'unknown';
  const addedAtMs = options.addedAtMs ?? Date.now();
  const id = options.id ?? generateOverlayEntryId(filename, addedAtMs);
  const criteria = options.criteria ?? DEFAULT_CRITERIA;

  const fileText = options.fileText;
  if (typeof fileText !== 'string' || fileText.trim().length === 0) {
    return {
      ok: false,
      reason: 'EMPTY_TEXT',
      message: 'fil-innholdet er tomt'
    };
  }

  const parseResult = parseIhpuPressureLog(fileText, { sourceName: filename });

  if (parseResult.rows.length === 0) {
    const reason: OverlayBuildFailureReason =
      parseResult.errors.length > 0 ? 'PARSE_FAILED' : 'NO_VALID_ROWS';
    return {
      ok: false,
      reason,
      message: parseResult.errors[0]?.message ?? 'parser returnerte ingen gyldige rader',
      parseResult
    };
  }

  const presence = parseResult.meta.channelsPresent;
  const p1 = presence.p1 ? buildChannelAnalysis(parseResult, 'p1', criteria) : null;
  const p2 = presence.p2 ? buildChannelAnalysis(parseResult, 'p2', criteria) : null;

  return {
    ok: true,
    entry: {
      id,
      filename,
      addedAtMs,
      parseResult,
      p1,
      p2
    }
  };
}

function buildChannelAnalysis(
  parseResult: ParseResult,
  channel: PressureChannel,
  criteria: HoldPeriodCriteria
): OverlayChannelAnalysis {
  const pressureSummary = calculatePressureDrop(parseResult.rows, channel, {
    targetPressure: criteria.targetPressure
  });
  const holdPeriod = evaluateHoldPeriod(parseResult.rows, channel, criteria);
  return { channel, pressureSummary, holdPeriod };
}

// =====================================================================
// View-model — derived from entries + current operator criteria.
// =====================================================================

export interface OverlayChannelViewModel {
  channel: PressureChannel;
  startBar: number | null;
  endBar: number | null;
  dropBar: number | null;
  /** dropPct in PERCENT POINTS, matching the primary dashboard. */
  dropPct: number | null;
  durationMinutes: number | null;
  verdict: HoldPeriodStatus;
}

export interface OverlayEntryViewModel {
  id: OverlayEntryId;
  filename: string;
  addedAtMs: number;
  rowCount: number;
  durationMinutes: number | null;
  channelsPresent: { p1: boolean; p2: boolean };
  p1: OverlayChannelViewModel | null;
  p2: OverlayChannelViewModel | null;
  /** True when this entry has the lowest comparable T2 dropPct (best). */
  isBestT2DropPct: boolean;
  /** True when this entry has the highest comparable T2 dropPct (worst). */
  isWorstT2DropPct: boolean;
}

export interface OverlayComparison {
  entryCount: number;
  entries: OverlayEntryViewModel[];
  /** True if AT LEAST one entry has the channel present. */
  channelsPresentAny: { p1: boolean; p2: boolean };
  bestT2DropPctEntryId: OverlayEntryId | null;
  worstT2DropPctEntryId: OverlayEntryId | null;
  /** Number of entries whose T2 dropPct could not be compared (channel missing or non-finite). */
  incomparableCount: number;
}

/**
 * Compute a comparison view-model from the supplied entries against the given
 * criteria.
 *
 * Re-runs `calculatePressureDrop` and `evaluateHoldPeriod` per entry against
 * `criteria` so the comparison table reflects the operator's CURRENT criteria
 * (maxDropPct, targetPressure) — not whatever criteria were active when the
 * file was uploaded. This keeps the table coherent when the operator tightens
 * or loosens thresholds after upload.
 *
 * The function:
 *  - preserves entry order (no implicit sorting)
 *  - never mutates `entries`
 *  - identifies the lowest and highest T2 dropPct as best / worst markers
 *  - skips entries whose T2 dropPct is null / non-finite when ranking
 *  - sets only `isBestT2DropPct` (not `isWorstT2DropPct`) when there is exactly
 *    one comparable entry, to avoid a single row showing both markers
 */
export function computeOverlayComparison(
  entries: readonly OverlayEntry[],
  criteria: HoldPeriodCriteria
): OverlayComparison {
  // Snapshot order; do not mutate input.
  const ordered = entries.slice();
  const viewModels = ordered.map((entry) => buildEntryViewModel(entry, criteria));

  let bestId: OverlayEntryId | null = null;
  let bestValue = Number.POSITIVE_INFINITY;
  let worstId: OverlayEntryId | null = null;
  let worstValue = Number.NEGATIVE_INFINITY;
  let comparable = 0;

  for (const vm of viewModels) {
    const v = vm.p2?.dropPct;
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    comparable++;
    if (v < bestValue) {
      bestValue = v;
      bestId = vm.id;
    }
    if (v > worstValue) {
      worstValue = v;
      worstId = vm.id;
    }
  }

  // If there's only one comparable entry, mark only "best" (not also "worst").
  if (comparable === 1) {
    worstId = null;
  }

  for (const vm of viewModels) {
    vm.isBestT2DropPct = bestId !== null && vm.id === bestId;
    vm.isWorstT2DropPct = worstId !== null && vm.id === worstId;
  }

  const channelsPresentAny = {
    p1: viewModels.some((v) => v.channelsPresent.p1),
    p2: viewModels.some((v) => v.channelsPresent.p2)
  };

  return {
    entryCount: viewModels.length,
    entries: viewModels,
    channelsPresentAny,
    bestT2DropPctEntryId: bestId,
    worstT2DropPctEntryId: worstId,
    incomparableCount: viewModels.length - comparable
  };
}

function buildEntryViewModel(
  entry: OverlayEntry,
  criteria: HoldPeriodCriteria
): OverlayEntryViewModel {
  const presence = entry.parseResult.meta.channelsPresent;
  const p1 = presence.p1 ? buildChannelViewModel(entry, 'p1', criteria) : null;
  const p2 = presence.p2 ? buildChannelViewModel(entry, 'p2', criteria) : null;

  return {
    id: entry.id,
    filename: entry.filename,
    addedAtMs: entry.addedAtMs,
    rowCount: entry.parseResult.meta.parsedRows,
    durationMinutes: entry.parseResult.meta.durationMinutes,
    channelsPresent: { p1: presence.p1, p2: presence.p2 },
    p1,
    p2,
    isBestT2DropPct: false,
    isWorstT2DropPct: false
  };
}

function buildChannelViewModel(
  entry: OverlayEntry,
  channel: PressureChannel,
  criteria: HoldPeriodCriteria
): OverlayChannelViewModel {
  const drop = calculatePressureDrop(entry.parseResult.rows, channel, {
    targetPressure: criteria.targetPressure
  });
  const hold = evaluateHoldPeriod(entry.parseResult.rows, channel, criteria);
  return {
    channel,
    startBar: drop.startPressure,
    endBar: drop.endPressure,
    dropBar: drop.dropBar,
    dropPct: drop.dropPct,
    durationMinutes: drop.durationMinutes,
    verdict: hold.status
  };
}
