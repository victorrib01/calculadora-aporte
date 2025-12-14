# Rumo ao 1º Milhão 💰 (React + TS)

Calculadora simples de aporte mensal para atingir uma meta (default: R$ 1.000.000),
com:

- cenários prontos de rentabilidade (pessimista/base/otimista) + modo personalizado
- sliders de inflação anual e “imposto efetivo” sobre ganhos (aproximação)
- cálculo em **valores reais (R$ de hoje)** (desconta inflação)
- opção de aporte **reajustado pela inflação** vs **nominal fixo**
- aporte no começo ou no fim do mês
- comparação entre cenários
- gráfico de projeção + exportação CSV

> Observação: é um modelo educacional (taxas constantes). Na prática, rentabilidade oscila, impostos variam por produto/prazo e pode haver taxas/custos.

## Rodar localmente

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Stack

React

TypeScript

Vite

## Modelagem (resumo)

Rentabilidade mensal bruta → aplica “imposto efetivo” (aprox.) → converte para taxa real descontando inflação.

Se o aporte for “reajustado”: mantém poder de compra constante (cresce nominalmente com inflação).

Se o aporte for “nominal fixo”: o aporte perde poder de compra ao longo do tempo.
