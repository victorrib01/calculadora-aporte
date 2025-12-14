import { describe, expect, it } from "vitest";
import {
  annualToMonthlyRate,
  monthsToTarget,
  parseNumberBR,
  realMonthlyRateFromGross,
  simulateProjection,
  solveRequiredPmt,
} from "./finance";

describe("number parsing", () => {
  it("parses Brazilian formatted numbers", () => {
    expect(parseNumberBR("1.234,56")).toBeCloseTo(1234.56);
    expect(parseNumberBR("  7.000  ")).toBe(7000);
    expect(parseNumberBR("R$ -2,5")).toBeCloseTo(-2.5);
  });
});

describe("rate conversions", () => {
  it("converts annual to monthly keeping sign", () => {
    expect(annualToMonthlyRate(0.12)).toBeCloseTo(0.009488, 6);
    expect(annualToMonthlyRate(-0.12)).toBeCloseTo(-0.010575, 6);
  });

  it("caps absurd negative annual rates", () => {
    expect(annualToMonthlyRate(-1.5)).toBeCloseTo(-0.999999, 6);
  });
});

describe("return modeling", () => {
  it("discounts taxes and inflation to get real rate", () => {
    const real = realMonthlyRateFromGross({
      grossMonthlyRate: 0.01,
      taxOnGainsRate: 0.15,
      inflationMonthlyRate: 0.003,
    });

    expect(real).toBeCloseTo(0.006522, 6);
  });

  it("projects balances across months", () => {
    const points = simulateProjection({
      pvToday: 1000,
      pmt0: 500,
      months: 2,
      ageNow: 30,
      realMonthlyRate: 0.01,
      inflationMonthlyRate: 0.002,
      indexation: "inflationAdjusted",
      timing: "end",
    });

    expect(points).toHaveLength(3);
    expect(points[2].balanceReal).toBeCloseTo(2025.05, 2);
    expect(points[1].contributionNominal).toBeCloseTo(501); // corrigido pela inflação
  });
});

describe("targets and aporte solving", () => {
  it("finds months to reach goal or returns null", () => {
    const months = monthsToTarget({
      pvToday: 0,
      pmt0: 100,
      targetToday: 5000,
      ageNow: 25,
      realMonthlyRate: 0.01,
      inflationMonthlyRate: 0.002,
      indexation: "fixedNominal",
      timing: "begin",
      maxMonths: 200,
    });

    expect(months).toBeGreaterThan(0);
    expect(months).toBeLessThan(200);

    const impossible = monthsToTarget({
      pvToday: 0,
      pmt0: 10,
      targetToday: 10_000_000,
      ageNow: 25,
      realMonthlyRate: 0,
      inflationMonthlyRate: 0.01,
      indexation: "fixedNominal",
      timing: "end",
      maxMonths: 120,
    });

    expect(impossible).toBeNull();
  });

  it("solves required contribution to hit target", () => {
    const payment = solveRequiredPmt({
      pvToday: 5000,
      targetToday: 50_000,
      months: 120,
      ageNow: 30,
      realMonthlyRate: 0.005,
      inflationMonthlyRate: 0.002,
      indexation: "inflationAdjusted",
      timing: "end",
    });

    expect(payment).not.toBeNull();
    expect(payment).toBeGreaterThan(0);
    expect(payment ?? 0).toBeCloseTo(298.5, 0);
  });
});
