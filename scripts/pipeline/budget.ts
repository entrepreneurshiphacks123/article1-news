// Article I — daily budget tracker.
// Hard cap: $1.67/day. Selector keeps running (cheap), generator halts when exhausted.

import { promises as fs } from 'fs';
import path from 'path';

export const DAILY_CAP_USD = 1.67;

const STATE_DIR = path.resolve(process.cwd(), 'state');
const BUDGET_PATH = path.join(STATE_DIR, 'budget.json');

interface BudgetState {
  [yyyymmdd: string]: number;  // total $ spent that day
}

const ensureDir = async () => {
  await fs.mkdir(STATE_DIR, { recursive: true });
};

const todayKey = (nowET: Date): string => {
  // Convert to ET, take YYYY-MM-DD
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(nowET);
};

const load = async (): Promise<BudgetState> => {
  try {
    const raw = await fs.readFile(BUDGET_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const save = async (state: BudgetState) => {
  await ensureDir();
  await fs.writeFile(BUDGET_PATH, JSON.stringify(state, null, 2));
};

export async function getTodaySpend(nowET: Date): Promise<number> {
  const state = await load();
  return state[todayKey(nowET)] ?? 0;
}

export async function getRemainingBudget(nowET: Date): Promise<number> {
  return Math.max(0, DAILY_CAP_USD - (await getTodaySpend(nowET)));
}

export async function recordSpend(nowET: Date, usd: number): Promise<number> {
  const state = await load();
  const k = todayKey(nowET);
  state[k] = (state[k] ?? 0) + usd;
  // Also: prune entries older than 90 days for hygiene
  const cutoff = new Date(nowET);
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffKey = todayKey(cutoff);
  for (const date of Object.keys(state)) {
    if (date < cutoffKey) delete state[date];
  }
  await save(state);
  return state[k];
}

export async function isHalted(nowET: Date): Promise<boolean> {
  return (await getTodaySpend(nowET)) >= DAILY_CAP_USD;
}

// Cost estimation. Keep these aligned with current Anthropic rates.
// Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// Rates are USD per million tokens.
export const RATES = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cachedInput: 0.30 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cachedInput: 0.10 },
  'claude-opus-4-7':  { input: 15.0, output: 75.0, cachedInput: 1.50 },
} as const;
export type ModelId = keyof typeof RATES;

export function computeCost(
  model: ModelId,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  const r = RATES[model];
  const freshInputCost = (inputTokens * r.input) / 1_000_000;
  const cachedInputCost = (cachedInputTokens * r.cachedInput) / 1_000_000;
  const outputCost = (outputTokens * r.output) / 1_000_000;
  return freshInputCost + cachedInputCost + outputCost;
}
