export type BenchmarkKey = "investidor" | "populacao";
export type ScenarioKey = "pessimista" | "base" | "otimista" | "personalizado";
export type ContributionIndexation = "inflationAdjusted" | "fixedNominal";
export type ContributionTiming = "end" | "begin";

export type SimulationPoint = {
  month: number;
  age: number;
  inflFactor: number;
  balanceReal: number;
  balanceNominal: number;
  contributionNominal: number;
  contributionReal: number;
};

export function parseNumberBR(value: string): number {
  const v = value
    .trim()
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function annualToMonthlyRate(annualRate: number): number {
  if (annualRate <= -1) return -0.999999;
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

export function realMonthlyRateFromGross(params: {
  grossMonthlyRate: number;
  taxOnGainsRate: number;
  inflationMonthlyRate: number;
}) {
  const g = params.grossMonthlyRate;
  const tax = clamp(params.taxOnGainsRate, 0, 1);
  const infl = params.inflationMonthlyRate;

  const netNominal = 1 + g * (1 - tax);
  const real = netNominal / (1 + infl) - 1;

  return clamp(real, -0.99, 10);
}

export function simulateProjection(params: {
  pvToday: number;
  pmt0: number;
  months: number;
  ageNow: number;
  realMonthlyRate: number;
  inflationMonthlyRate: number;
  indexation: ContributionIndexation;
  timing: ContributionTiming;
}) {
  const {
    pvToday,
    pmt0,
    months,
    ageNow,
    realMonthlyRate: r,
    inflationMonthlyRate: inflM,
    indexation,
    timing,
  } = params;

  const points: SimulationPoint[] = [];
  let balanceReal = Math.max(0, pvToday);

  for (let m = 0; m <= months; m++) {
    const inflFactor = Math.pow(1 + inflM, m);

    const contributionNominal =
      indexation === "inflationAdjusted" ? pmt0 * inflFactor : pmt0;

    const contributionReal =
      indexation === "inflationAdjusted" ? pmt0 : pmt0 / inflFactor;

    const balanceNominal = balanceReal * inflFactor;

    points.push({
      month: m,
      age: ageNow + m / 12,
      inflFactor,
      balanceReal,
      balanceNominal,
      contributionNominal,
      contributionReal,
    });

    if (m === months) break;

    if (timing === "begin") {
      balanceReal += contributionReal;
      balanceReal *= 1 + r;
    } else {
      balanceReal *= 1 + r;
      balanceReal += contributionReal;
    }

    if (!Number.isFinite(balanceReal)) break;
  }

  return points;
}

export function finalBalanceReal(params: {
  pvToday: number;
  pmt0: number;
  months: number;
  ageNow: number;
  realMonthlyRate: number;
  inflationMonthlyRate: number;
  indexation: ContributionIndexation;
  timing: ContributionTiming;
}) {
  const pts = simulateProjection(params);
  return pts.length ? pts[pts.length - 1].balanceReal : NaN;
}

export function monthsToTarget(params: {
  pvToday: number;
  pmt0: number;
  targetToday: number;
  ageNow: number;
  realMonthlyRate: number;
  inflationMonthlyRate: number;
  indexation: ContributionIndexation;
  timing: ContributionTiming;
  maxMonths?: number;
}) {
  const maxMonths = params.maxMonths ?? 2400;
  if (params.targetToday <= params.pvToday) return 0;

  let balanceReal = Math.max(0, params.pvToday);
  for (let m = 1; m <= maxMonths; m++) {
    const inflFactorPrev = Math.pow(1 + params.inflationMonthlyRate, m - 1);

    const contributionReal =
      params.indexation === "inflationAdjusted"
        ? params.pmt0
        : params.pmt0 / inflFactorPrev;

    if (params.timing === "begin") {
      balanceReal += contributionReal;
      balanceReal *= 1 + params.realMonthlyRate;
    } else {
      balanceReal *= 1 + params.realMonthlyRate;
      balanceReal += contributionReal;
    }

    if (!Number.isFinite(balanceReal)) return null;
    if (balanceReal >= params.targetToday) return m;
  }
  return null;
}

export function solveRequiredPmt(params: {
  pvToday: number;
  targetToday: number;
  months: number;
  ageNow: number;
  realMonthlyRate: number;
  inflationMonthlyRate: number;
  indexation: ContributionIndexation;
  timing: ContributionTiming;
}) {
  const { pvToday, targetToday, months } = params;
  if (months <= 0) return null;
  if (targetToday <= pvToday) return 0;

  const reaches = (pmt0: number) => {
    const end = finalBalanceReal({ ...params, pmt0 });
    return Number.isFinite(end) && end >= targetToday;
  };

  let low = 0;
  let high = Math.max(1, (targetToday - pvToday) / months);

  let guard = 0;
  while (!reaches(high) && guard < 60) {
    high *= 2;
    if (high > 1e9) return null;
    guard++;
  }

  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2;
    if (reaches(mid)) high = mid;
    else low = mid;
  }

  return Math.max(0, high);
}
