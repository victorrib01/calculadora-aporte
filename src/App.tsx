import { useMemo, useState } from "react";
import "./App.css";

type BenchmarkKey = "investidor" | "populacao";
type ScenarioKey = "pessimista" | "base" | "otimista" | "personalizado";
type ContributionIndexation = "inflationAdjusted" | "fixedNominal";
type ContributionTiming = "end" | "begin";
type DisplayMode = "real" | "nominal";

type Benchmark = {
  label: string;
  baseAge: number;
  income: number;
  startBalance: number;
};

type Scenario = {
  key: Exclude<ScenarioKey, "personalizado">;
  label: string;
  grossMonthlyPct: number; // bruto ao mês
};

const BENCHMARKS: Record<BenchmarkKey, Benchmark> = {
  investidor: {
    label: "Investidor BR (benchmark)",
    baseAge: 43,
    income: 6299,
    startBalance: 2270,
  },
  populacao: {
    label: "População geral (benchmark)",
    baseAge: 43,
    income: 4520,
    startBalance: 0,
  },
};

const SCENARIOS: Scenario[] = [
  { key: "pessimista", label: "Pessimista", grossMonthlyPct: 0.4 },
  { key: "base", label: "Base", grossMonthlyPct: 0.6 },
  { key: "otimista", label: "Otimista", grossMonthlyPct: 0.8 },
];

const brl0 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const brl2 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

function parseNumberBR(value: string): number {
  const v = value
    .trim()
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function annualToMonthlyRate(annualRate: number): number {
  // (1 + a)^(1/12) - 1
  if (annualRate <= -1) return -0.999999;
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

/**
 * “Imposto efetivo” simples:
 * - desconta imposto como % do ganho mensal (aproximação)
 * - depois converte de nominal -> real, descontando inflação
 */
function realMonthlyRateFromGross(params: {
  grossMonthlyRate: number; // ex: 0.01
  taxOnGainsRate: number; // ex: 0.15
  inflationMonthlyRate: number; // ex: 0.003
}) {
  const g = params.grossMonthlyRate;
  const tax = clamp(params.taxOnGainsRate, 0, 1);
  const infl = params.inflationMonthlyRate;

  const netNominal = 1 + g * (1 - tax);
  const real = netNominal / (1 + infl) - 1;

  return clamp(real, -0.99, 10);
}

type SimulationPoint = {
  month: number;
  age: number;
  inflFactor: number;
  balanceReal: number;
  balanceNominal: number;
  contributionNominal: number;
  contributionReal: number;
};

function simulateProjection(params: {
  pvToday: number; // valor de hoje
  pmt0: number; // “R$ de hoje”: se fixedNominal, é nominal fixo; se inflationAdjusted, é valor real constante reajustado
  months: number;
  ageNow: number;

  // taxas
  realMonthlyRate: number;
  inflationMonthlyRate: number;

  // aporte
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

    // contribuição do mês m (pensada “no mês m”)
    // - inflationAdjusted: contribuição real constante = pmt0; nominal cresce com inflação
    // - fixedNominal: nominal constante = pmt0; real diminui com inflação
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

    // não aplica dinâmica no último ponto (é só snapshot)
    if (m === months) break;

    // aplica a dinâmica do próximo mês
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

function finalBalanceReal(params: {
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

function monthsToTarget(params: {
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
  const maxMonths = params.maxMonths ?? 2400; // 200 anos
  if (params.targetToday <= params.pvToday) return 0;

  // simula até atingir
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

function solveRequiredPmt(params: {
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

  // função monotônica: quanto maior pmt0, maior saldo final
  const reaches = (pmt0: number) => {
    const end = finalBalanceReal({ ...params, pmt0 });
    return Number.isFinite(end) && end >= targetToday;
  };

  let low = 0;
  let high = Math.max(1, (targetToday - pvToday) / months);

  // expande high até atingir ou até ficar absurdo
  let guard = 0;
  while (!reaches(high) && guard < 60) {
    high *= 2;
    if (high > 1e9) return null;
    guard++;
  }

  // binary search
  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2;
    if (reaches(mid)) high = mid;
    else low = mid;
  }

  return Math.max(0, high);
}

function pct(n: number, digits = 2) {
  return `${n.toFixed(digits)}%`;
}

function LineChart(props: {
  points: number[];
  height?: number;
  formatY?: (v: number) => string;
}) {
  const height = props.height ?? 180;
  const width = 900; // viewBox “fixo”
  const values = props.points;

  const min = Math.min(...values);
  const max = Math.max(...values);

  const padX = 14;
  const padY = 12;

  const safeMax = max === min ? max + 1 : max;
  const toX = (i: number) =>
    padX + (i / Math.max(1, values.length - 1)) * (width - padX * 2);
  const toY = (v: number) =>
    padY + (1 - (v - min) / (safeMax - min)) * (height - padY * 2);

  const d = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${toX(i).toFixed(2)} ${toY(v).toFixed(2)}`
    )
    .join(" ");

  const fmt = props.formatY ?? ((v: number) => brl0.format(v));

  return (
    <div className="chartWrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chartSvg"
        preserveAspectRatio="none"
      >
        <path d={d} className="chartLine" />
      </svg>
      <div className="chartLegend">
        <span>
          min: <b>{fmt(min)}</b>
        </span>
        <span>
          max: <b>{fmt(max)}</b>
        </span>
      </div>
    </div>
  );
}

export default function App() {
  // Benchmark
  const [benchmarkKey, setBenchmarkKey] = useState<BenchmarkKey>("investidor");
  const [taxaAporteModeloPct, setTaxaAporteModeloPct] = useState("10"); // % da renda

  // Inputs
  const [carteiraAtual, setCarteiraAtual] = useState("50000");
  const [idadeAtual, setIdadeAtual] = useState("23");
  const [meta, setMeta] = useState("1000000");

  // Cenários
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("base");
  const [
    rendimentoMensalPctPersonalizado,
    setRendimentoMensalPctPersonalizado,
  ] = useState("1.0"); // %

  // Macros (sliders)
  const [inflacaoAnualPct, setInflacaoAnualPct] = useState(4.5);
  const [impostoEfetivoPct, setImpostoEfetivoPct] = useState(15);

  // Aporte e projeção
  const [indexation, setIndexation] =
    useState<ContributionIndexation>("inflationAdjusted");
  const [timing, setTiming] = useState<ContributionTiming>("end");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("real");

  // Idade alvo
  const [usarTempoDoModelo, setUsarTempoDoModelo] = useState(true);
  const [idadeAlvoManual, setIdadeAlvoManual] = useState("60");

  // “Meu aporte” (quanto tempo com X/mês)
  const [meuAporte, setMeuAporte] = useState("1000");

  const b = BENCHMARKS[benchmarkKey];

  const pvToday = useMemo(
    () => Math.max(0, parseNumberBR(carteiraAtual)),
    [carteiraAtual]
  );
  const ageNow = useMemo(
    () => Math.max(0, parseNumberBR(idadeAtual)),
    [idadeAtual]
  );
  const targetToday = useMemo(() => Math.max(0, parseNumberBR(meta)), [meta]);

  const inflAnnual = inflacaoAnualPct / 100;
  const inflM = useMemo(() => annualToMonthlyRate(inflAnnual), [inflAnnual]);

  const taxRate = impostoEfetivoPct / 100;

  const grossMonthlyPctUsed = useMemo(() => {
    if (scenarioKey === "personalizado")
      return parseNumberBR(rendimentoMensalPctPersonalizado);
    const preset = SCENARIOS.find((s) => s.key === scenarioKey);
    return preset?.grossMonthlyPct ?? 0.6;
  }, [scenarioKey, rendimentoMensalPctPersonalizado]);

  const grossMonthlyRate = useMemo(
    () => grossMonthlyPctUsed / 100,
    [grossMonthlyPctUsed]
  );

  const rReal = useMemo(() => {
    return realMonthlyRateFromGross({
      grossMonthlyRate,
      taxOnGainsRate: taxRate,
      inflationMonthlyRate: inflM,
    });
  }, [grossMonthlyRate, taxRate, inflM]);

  const netNominalMonthlyRate = useMemo(
    () => grossMonthlyRate * (1 - taxRate),
    [grossMonthlyRate, taxRate]
  );

  const modeloPmt = useMemo(() => {
    const pctIncome = Math.max(0, parseNumberBR(taxaAporteModeloPct)) / 100;
    return b.income * pctIncome;
  }, [b.income, taxaAporteModeloPct]);

  // Tempo do modelo (meses) até a meta, com as mesmas regras (indexation/timing)
  const modeloMesesAteMeta = useMemo(() => {
    return monthsToTarget({
      pvToday: b.startBalance,
      pmt0: modeloPmt,
      targetToday,
      ageNow: b.baseAge,
      realMonthlyRate: rReal,
      inflationMonthlyRate: inflM,
      indexation,
      timing,
      maxMonths: 2400,
    });
  }, [
    b.startBalance,
    modeloPmt,
    targetToday,
    b.baseAge,
    rReal,
    inflM,
    indexation,
    timing,
  ]);

  const idadeModeloNaMeta = useMemo(() => {
    if (modeloMesesAteMeta == null) return null;
    return b.baseAge + modeloMesesAteMeta / 12;
  }, [b.baseAge, modeloMesesAteMeta]);

  const idadeAlvo = useMemo(() => {
    if (usarTempoDoModelo && modeloMesesAteMeta != null)
      return ageNow + modeloMesesAteMeta / 12;
    const manual = parseNumberBR(idadeAlvoManual);
    return manual > 0 ? manual : null;
  }, [usarTempoDoModelo, modeloMesesAteMeta, ageNow, idadeAlvoManual]);

  const mesesAteAlvo = useMemo(() => {
    if (idadeAlvo == null) return null;
    const years = idadeAlvo - ageNow;
    return years > 0 ? Math.round(years * 12) : null;
  }, [idadeAlvo, ageNow]);

  const aporteNecessario = useMemo(() => {
    if (mesesAteAlvo == null) return null;
    return solveRequiredPmt({
      pvToday,
      targetToday,
      months: mesesAteAlvo,
      ageNow,
      realMonthlyRate: rReal,
      inflationMonthlyRate: inflM,
      indexation,
      timing,
    });
  }, [
    mesesAteAlvo,
    pvToday,
    targetToday,
    ageNow,
    rReal,
    inflM,
    indexation,
    timing,
  ]);

  const meuAporteNum = useMemo(
    () => Math.max(0, parseNumberBR(meuAporte)),
    [meuAporte]
  );

  const mesesComMeuAporte = useMemo(() => {
    return monthsToTarget({
      pvToday,
      pmt0: meuAporteNum,
      targetToday,
      ageNow,
      realMonthlyRate: rReal,
      inflationMonthlyRate: inflM,
      indexation,
      timing,
    });
  }, [
    pvToday,
    meuAporteNum,
    targetToday,
    ageNow,
    rReal,
    inflM,
    indexation,
    timing,
  ]);

  const idadeComMeuAporte = useMemo(() => {
    if (mesesComMeuAporte == null) return null;
    return ageNow + mesesComMeuAporte / 12;
  }, [ageNow, mesesComMeuAporte]);

  const projection = useMemo(() => {
    if (mesesAteAlvo == null) return null;
    const pmtToUse = aporteNecessario ?? 0;
    return simulateProjection({
      pvToday,
      pmt0: pmtToUse,
      months: mesesAteAlvo,
      ageNow,
      realMonthlyRate: rReal,
      inflationMonthlyRate: inflM,
      indexation,
      timing,
    });
  }, [
    mesesAteAlvo,
    aporteNecessario,
    pvToday,
    ageNow,
    rReal,
    inflM,
    indexation,
    timing,
  ]);

  const chartValues = useMemo(() => {
    if (!projection) return [];
    return projection.map((p) =>
      displayMode === "real" ? p.balanceReal : p.balanceNominal
    );
  }, [projection, displayMode]);

  const scenarioCompare = useMemo(() => {
    if (mesesAteAlvo == null) return [];
    return SCENARIOS.map((s) => {
      const rScenario = realMonthlyRateFromGross({
        grossMonthlyRate: s.grossMonthlyPct / 100,
        taxOnGainsRate: taxRate,
        inflationMonthlyRate: inflM,
      });

      const pmtNeed = solveRequiredPmt({
        pvToday,
        targetToday,
        months: mesesAteAlvo,
        ageNow,
        realMonthlyRate: rScenario,
        inflationMonthlyRate: inflM,
        indexation,
        timing,
      });

      return {
        key: s.key,
        label: s.label,
        grossMonthlyPct: s.grossMonthlyPct,
        realMonthlyPct: rScenario * 100,
        pmtNeed,
      };
    });
  }, [
    mesesAteAlvo,
    taxRate,
    inflM,
    pvToday,
    targetToday,
    ageNow,
    indexation,
    timing,
  ]);

  const faltaHoje = Math.max(0, targetToday - pvToday);

  const exportCSV = () => {
    if (!projection) return;

    const header = [
      "month",
      "age",
      "inflFactor",
      "balanceReal",
      "balanceNominal",
      "contributionReal",
      "contributionNominal",
    ].join(",");

    const rows = projection.map((p) =>
      [
        p.month,
        p.age.toFixed(4),
        p.inflFactor.toFixed(8),
        p.balanceReal.toFixed(2),
        p.balanceNominal.toFixed(2),
        p.contributionReal.toFixed(2),
        p.contributionNominal.toFixed(2),
      ].join(",")
    );

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "projecao_1m.csv";
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Rumo ao 1º Milhão</h1>
          <p>
            Meta em <b>R$ de hoje</b>. O cálculo usa{" "}
            <b>rendimento real líquido</b> (desconta inflação e um imposto
            efetivo aproximado).
          </p>
        </div>
        <div className="pill">
          <span>Taxa real liq.</span>
          <b>{pct(rReal * 100, 3)} a.m.</b>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Entradas</h2>

          <div className="twoCols">
            <label>
              Benchmark
              <select
                value={benchmarkKey}
                onChange={(e) =>
                  setBenchmarkKey(e.target.value as BenchmarkKey)
                }
              >
                {Object.entries(BENCHMARKS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Taxa de poupança do benchmark (% da renda)
              <input
                value={taxaAporteModeloPct}
                onChange={(e) => setTaxaAporteModeloPct(e.target.value)}
                inputMode="decimal"
              />
              <small>Define o “aporte médio do modelo”.</small>
            </label>

            <label>
              Carteira atual (R$)
              <input
                value={carteiraAtual}
                onChange={(e) => setCarteiraAtual(e.target.value)}
                inputMode="decimal"
              />
            </label>

            <label>
              Idade atual
              <input
                value={idadeAtual}
                onChange={(e) => setIdadeAtual(e.target.value)}
                inputMode="numeric"
              />
            </label>

            <label>
              Meta (R$ de hoje)
              <input
                value={meta}
                onChange={(e) => setMeta(e.target.value)}
                inputMode="decimal"
              />
            </label>

            <label>
              Cenário de rentabilidade
              <select
                value={scenarioKey}
                onChange={(e) => setScenarioKey(e.target.value as ScenarioKey)}
              >
                {SCENARIOS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({s.grossMonthlyPct}% a.m. bruto)
                  </option>
                ))}
                <option value="personalizado">Personalizado</option>
              </select>
            </label>

            <label>
              Rendimento bruto mensal (%)
              <input
                value={
                  scenarioKey === "personalizado"
                    ? rendimentoMensalPctPersonalizado
                    : String(grossMonthlyPctUsed)
                }
                onChange={(e) => {
                  setScenarioKey("personalizado");
                  setRendimentoMensalPctPersonalizado(e.target.value);
                }}
                inputMode="decimal"
              />
              <small>Editar aqui muda para “Personalizado”.</small>
            </label>
          </div>

          <div className="divider" />

          <h3>Macros</h3>

          <div className="twoCols">
            <div className="slider">
              <div className="sliderTop">
                <span>Inflação anual</span>
                <b>{pct(inflacaoAnualPct, 1)}</b>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={0.1}
                value={inflacaoAnualPct}
                onChange={(e) => setInflacaoAnualPct(Number(e.target.value))}
              />
              <small>
                Infl. mensal aprox.: <b>{pct(inflM * 100, 3)}</b>
              </small>
            </div>

            <div className="slider">
              <div className="sliderTop">
                <span>Imposto efetivo sobre ganhos</span>
                <b>{pct(impostoEfetivoPct, 1)}</b>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={0.5}
                value={impostoEfetivoPct}
                onChange={(e) => setImpostoEfetivoPct(Number(e.target.value))}
              />
              <small>Aproximação constante (não modela IR por prazo).</small>
            </div>
          </div>

          <div className="hintBox">
            <div>
              <b>Bruto a.m.:</b> {pct(grossMonthlyRate * 100, 3)}
            </div>
            <div>
              <b>Líquido nominal a.m.:</b> {pct(netNominalMonthlyRate * 100, 3)}
            </div>
            <div>
              <b>Real líquido a.m.:</b> {pct(rReal * 100, 3)}
            </div>
          </div>

          <div className="divider" />

          <h3>Aporte</h3>

          <div className="twoCols">
            <label>
              Aporte reajusta pela inflação?
              <select
                value={indexation}
                onChange={(e) =>
                  setIndexation(e.target.value as ContributionIndexation)
                }
              >
                <option value="inflationAdjusted">
                  Sim (constante em R$ de hoje)
                </option>
                <option value="fixedNominal">
                  Não (nominal fixo / perde poder de compra)
                </option>
              </select>
              <small>
                <b>Sim:</b> você mantém o mesmo poder de compra do aporte ao
                longo do tempo.
                <br />
                <b>Não:</b> você aporta o mesmo R$ nominal todo mês; em termos
                reais, ele “encolhe”.
              </small>
            </label>

            <label>
              Momento do aporte
              <select
                value={timing}
                onChange={(e) =>
                  setTiming(e.target.value as ContributionTiming)
                }
              >
                <option value="end">Fim do mês</option>
                <option value="begin">Começo do mês</option>
              </select>
            </label>
          </div>

          <div className="divider" />

          <h3>Alvo</h3>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={usarTempoDoModelo}
              onChange={(e) => setUsarTempoDoModelo(e.target.checked)}
            />
            Usar o <b>tempo do benchmark</b> como alvo (em vez de escolher
            manualmente)
          </label>

          {!usarTempoDoModelo && (
            <label style={{ maxWidth: 260 }}>
              Idade alvo (manual)
              <input
                value={idadeAlvoManual}
                onChange={(e) => setIdadeAlvoManual(e.target.value)}
                inputMode="numeric"
              />
            </label>
          )}
        </section>

        <section className="card">
          <h2>Resultado</h2>

          <div className="kpis">
            <div className="kpiRow">
              <span>Falta para a meta (hoje)</span>
              <b>{brl0.format(faltaHoje)}</b>
            </div>

            <div className="kpiRow">
              <span>Aporte médio do benchmark</span>
              <b>{brl2.format(modeloPmt)} / mês</b>
            </div>

            <div className="kpiRow">
              <span>Idade do benchmark na meta</span>
              <b>
                {idadeModeloNaMeta == null
                  ? "—"
                  : `${idadeModeloNaMeta.toFixed(1)} anos`}
              </b>
            </div>

            <div className="kpiRow">
              <span>Sua idade-alvo usada</span>
              <b>
                {idadeAlvo == null ? "—" : `${idadeAlvo.toFixed(1)} anos`}
                {mesesAteAlvo != null ? ` (${mesesAteAlvo} meses)` : ""}
              </b>
            </div>

            <div className="kpiRow highlight">
              <span>Aporte mensal sugerido</span>
              <b>
                {aporteNecessario == null
                  ? "—"
                  : `${brl2.format(aporteNecessario)} / mês`}
              </b>
            </div>

            <small className="subnote">
              {indexation === "inflationAdjusted"
                ? "Esse valor é em R$ de hoje e deve ser reajustado pela inflação ao longo do tempo."
                : "Esse valor é nominal fixo: você repetiria o mesmo R$ todo mês (em termos reais, ele perde poder de compra)."}
            </small>
          </div>

          <div className="divider" />

          <h3>“Se eu aportar X, quando chego?”</h3>
          <div className="twoCols">
            <label>
              Meu aporte mensal (R$)
              <input
                value={meuAporte}
                onChange={(e) => setMeuAporte(e.target.value)}
                inputMode="decimal"
              />
            </label>

            <div className="kpiRow">
              <span>Chega em</span>
              <b>
                {mesesComMeuAporte == null
                  ? "—"
                  : `${mesesComMeuAporte} meses (~${Math.ceil(
                      mesesComMeuAporte / 12
                    )} anos)`}
              </b>
            </div>
          </div>

          <div className="kpiRow">
            <span>Sua idade quando chega</span>
            <b>
              {idadeComMeuAporte == null
                ? "—"
                : `~${idadeComMeuAporte.toFixed(1)} anos`}
            </b>
          </div>

          <div className="divider" />

          <h3>Comparar cenários</h3>
          <p className="muted">
            Mesmo alvo de tempo. Só muda a rentabilidade (mantém
            inflação/imposto/forma de aporte).
          </p>

          <div className="table">
            <div className="thead">
              <div>Cenário</div>
              <div>Bruto a.m.</div>
              <div>Real liq. a.m.</div>
              <div>Aporte necessário</div>
            </div>

            {scenarioCompare.map((row) => (
              <div className="trow" key={row.key}>
                <div>{row.label}</div>
                <div>{pct(row.grossMonthlyPct, 2)}</div>
                <div>{pct(row.realMonthlyPct, 3)}</div>
                <div>
                  {row.pmtNeed == null ? "—" : brl2.format(row.pmtNeed)}
                </div>
              </div>
            ))}
          </div>

          <div className="divider" />

          <h3>Projeção</h3>

          <div className="twoCols">
            <label>
              Exibir gráfico em
              <select
                value={displayMode}
                onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
              >
                <option value="real">R$ de hoje (real)</option>
                <option value="nominal">R$ nominal (com inflação)</option>
              </select>
            </label>

            <button className="btn" onClick={exportCSV} disabled={!projection}>
              Exportar CSV
            </button>
          </div>

          {projection && chartValues.length > 1 ? (
            <LineChart
              points={chartValues}
              height={190}
              formatY={(v) =>
                displayMode === "real" ? brl0.format(v) : brl0.format(v)
              }
            />
          ) : (
            <div className="muted">—</div>
          )}

          <p className="muted" style={{ marginTop: 12 }}>
            Modelagem simplificada (taxas constantes). Na vida real:
            volatilidade, impostos por tipo/prazo, custos e aportes variáveis.
          </p>
        </section>
      </div>
    </div>
  );
}
