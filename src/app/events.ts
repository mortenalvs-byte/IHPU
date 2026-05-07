// events.ts — wires DOM inputs to AppState mutations and re-renders.
//
// File reading uses File.text() (browser/Electron renderer API). The parser
// and analysis modules are pure domain functions — they receive the text and
// return structured ParseResult / PressureDropResult / HoldPeriodResult.

import { evaluateHoldPeriod } from '../domain/holdPeriod';
import { parseIhpuPressureLog } from '../domain/ihpuParser';
import { calculatePressureDrop } from '../domain/pressureAnalysis';
import type { PressureChannel } from '../domain/types';
import { render } from './render';
import type { AppState } from './state';

interface AppContext {
  root: HTMLElement;
  state: AppState;
}

export function wireEvents(ctx: AppContext): void {
  const fileInput = qs<HTMLInputElement>(ctx.root, 'file-input');
  const channelSelect = qs<HTMLSelectElement>(ctx.root, 'channel-select');
  const maxDropInput = qs<HTMLInputElement>(ctx.root, 'max-drop-input');
  const targetInput = qs<HTMLInputElement>(ctx.root, 'target-pressure-input');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      void handleFileSelected(ctx, fileInput);
    });
  }

  if (channelSelect) {
    channelSelect.value = ctx.state.selectedChannel;
    channelSelect.addEventListener('change', () => {
      const v = channelSelect.value;
      if (v === 'p1' || v === 'p2') {
        ctx.state.selectedChannel = v as PressureChannel;
        recomputeAnalysis(ctx);
        render(ctx.root, ctx.state);
      }
    });
  }

  if (maxDropInput) {
    maxDropInput.value = String(ctx.state.maxDropPct);
    maxDropInput.addEventListener('input', () => {
      const n = Number(maxDropInput.value);
      if (Number.isFinite(n) && n >= 0) {
        ctx.state.maxDropPct = n;
        recomputeAnalysis(ctx);
        render(ctx.root, ctx.state);
      }
    });
  }

  if (targetInput) {
    targetInput.addEventListener('input', () => {
      const raw = targetInput.value.trim();
      if (raw === '') {
        ctx.state.targetPressure = null;
      } else {
        const n = Number(raw);
        ctx.state.targetPressure = Number.isFinite(n) ? n : null;
      }
      recomputeAnalysis(ctx);
      render(ctx.root, ctx.state);
    });
  }
}

async function handleFileSelected(ctx: AppContext, input: HTMLInputElement): Promise<void> {
  const file = input.files && input.files[0];
  if (!file) return;

  ctx.state.userMessage = null;
  ctx.state.selectedFileName = file.name;

  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    ctx.state.parseResult = null;
    ctx.state.baselineDrop = null;
    ctx.state.targetDrop = null;
    ctx.state.holdResult = null;
    ctx.state.userMessage = {
      severity: 'error',
      text: `Kunne ikke lese filen: ${err instanceof Error ? err.message : String(err)}`
    };
    render(ctx.root, ctx.state);
    return;
  }

  try {
    ctx.state.parseResult = parseIhpuPressureLog(text, { sourceName: file.name });
  } catch (err) {
    // parseIhpuPressureLog is documented as never-throwing, but we guard
    // anyway so the UI never goes blank on an unexpected runtime error.
    ctx.state.parseResult = null;
    ctx.state.userMessage = {
      severity: 'error',
      text: `Uventet parser-feil: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  recomputeAnalysis(ctx);
  render(ctx.root, ctx.state);
}

function recomputeAnalysis(ctx: AppContext): void {
  const pr = ctx.state.parseResult;
  if (!pr || pr.rows.length === 0) {
    ctx.state.baselineDrop = null;
    ctx.state.targetDrop = null;
    ctx.state.holdResult = null;
    return;
  }

  const channel = ctx.state.selectedChannel;

  ctx.state.baselineDrop = calculatePressureDrop(pr.rows, channel);

  if (ctx.state.targetPressure !== null && Number.isFinite(ctx.state.targetPressure)) {
    ctx.state.targetDrop = calculatePressureDrop(pr.rows, channel, {
      targetPressure: ctx.state.targetPressure
    });
  } else {
    ctx.state.targetDrop = null;
  }

  ctx.state.holdResult = evaluateHoldPeriod(pr.rows, channel, {
    targetPressure: ctx.state.targetPressure ?? undefined,
    maxDropPct: ctx.state.maxDropPct
  });
}

function qs<T extends HTMLElement>(root: HTMLElement, testId: string): T | null {
  return root.querySelector<T>(`[data-testid="${testId}"]`);
}
