// Hold-period evaluation for IHPU trykktest logs.
//
// A "hold period" is a time range in which pressure should remain stable. The
// evaluation reuses calculatePressureDrop and adds a PASS / FAIL / UNKNOWN
// verdict against a maxDropPct threshold.
//
// Pure TypeScript domain logic. No DOM, no Electron, no Chart.js, no jsPDF.
// See docs/development/pressure-analysis-contract.md.

import { calculatePressureDrop, selectRowsInTimeRange } from './pressureAnalysis';
import type {
  AnalysisIssue,
  HoldPeriodCriteria,
  HoldPeriodResult,
  HoldPeriodStatus,
  PressureChannel,
  PressureRow
} from './types';

/**
 * Evaluate a hold-period over the supplied rows for the given channel.
 *
 * Behavior:
 * - Selects rows in [criteria.fromTimestampMs, criteria.toTimestampMs] (inclusive,
 *   either bound optional).
 * - Computes drop via calculatePressureDrop with options.targetPressure ←
 *   criteria.targetPressure.
 * - Status:
 *     - 'UNKNOWN' if criteria.maxDropPct is undefined, or if drop calculation
 *       produced any errors (no valid rows, insufficient points, zero duration,
 *       channel missing, invalid reference, …).
 *     - 'PASS' if drop.dropPct <= maxDropPct.
 *     - 'FAIL' if drop.dropPct > maxDropPct.
 *
 * Negative dropPct (pressure increased over the period) automatically passes
 * any positive maxDropPct, which is the desired semantic for hold tests.
 */
export function evaluateHoldPeriod(
  rows: PressureRow[],
  channel: PressureChannel,
  criteria: HoldPeriodCriteria
): HoldPeriodResult {
  const warnings: AnalysisIssue[] = [];
  const errors: AnalysisIssue[] = [];

  // Validate range early so we can surface a clean error before forwarding.
  if (
    criteria.fromTimestampMs !== undefined &&
    criteria.toTimestampMs !== undefined &&
    criteria.fromTimestampMs > criteria.toTimestampMs
  ) {
    errors.push({
      severity: 'error',
      code: 'INVALID_RANGE',
      message: 'criteria.fromTimestampMs is greater than criteria.toTimestampMs'
    });
  }

  const selected = selectRowsInTimeRange(
    rows,
    criteria.fromTimestampMs,
    criteria.toTimestampMs
  );

  if (selected.length === 0 && rows.length > 0 && errors.length === 0) {
    warnings.push({
      severity: 'warning',
      code: 'EMPTY_RANGE',
      message: 'no rows fall inside the requested time range'
    });
  }

  const drop = calculatePressureDrop(selected, channel, {
    targetPressure: criteria.targetPressure
  });

  // Bubble drop errors up to the hold-period level so callers can decide on a
  // single field. The drop result itself is preserved verbatim.
  for (const e of drop.errors) errors.push(e);
  for (const w of drop.warnings) warnings.push(w);

  let status: HoldPeriodStatus;
  if (criteria.maxDropPct === undefined) {
    warnings.push({
      severity: 'warning',
      code: 'MISSING_CRITERIA',
      message: 'criteria.maxDropPct is undefined — status set to UNKNOWN'
    });
    status = 'UNKNOWN';
  } else if (errors.length > 0 || drop.dropPct === null) {
    status = 'UNKNOWN';
  } else if (drop.dropPct <= criteria.maxDropPct) {
    status = 'PASS';
  } else {
    status = 'FAIL';
  }

  return {
    status,
    channel,
    criteria,
    drop,
    warnings,
    errors
  };
}
