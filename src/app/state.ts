// AppState — the single source of truth for the renderer.
//
// State is intentionally a plain mutable object. Updates happen in events.ts;
// render.ts reads from state and pushes textContent into the DOM. No reducers,
// no observables, no framework — for a small Electron app this is enough.

import type {
  HoldPeriodResult,
  ParseResult,
  PressureChannel,
  PressureDropResult
} from '../domain/types';

export type AppMessageSeverity = 'info' | 'warning' | 'error';

export interface AppMessage {
  severity: AppMessageSeverity;
  text: string;
}

export interface AppState {
  selectedFileName: string | null;
  parseResult: ParseResult | null;
  selectedChannel: PressureChannel;
  /** maxDropPct in PERCENT POINTS. UI input default = 5 (= 5 %). */
  maxDropPct: number;
  /** targetPressure in bar; null when the user has not specified one. */
  targetPressure: number | null;
  /** PressureDropResult with reference = startPressure (always populated when rows exist). */
  baselineDrop: PressureDropResult | null;
  /** PressureDropResult with reference = targetPressure (only when targetPressure is set). */
  targetDrop: PressureDropResult | null;
  /** Hold-period evaluation using current targetPressure and maxDropPct. */
  holdResult: HoldPeriodResult | null;
  /** Last user-facing message (file read failure, etc.). Cleared on next file load. */
  userMessage: AppMessage | null;
}

export const DEFAULT_CHANNEL: PressureChannel = 'p2';
export const DEFAULT_MAX_DROP_PCT = 5;

export function createState(): AppState {
  return {
    selectedFileName: null,
    parseResult: null,
    selectedChannel: DEFAULT_CHANNEL,
    maxDropPct: DEFAULT_MAX_DROP_PCT,
    targetPressure: null,
    baselineDrop: null,
    targetDrop: null,
    holdResult: null,
    userMessage: null
  };
}
