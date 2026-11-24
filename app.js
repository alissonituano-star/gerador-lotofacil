import { auditDailyForecast, createDailyGame, FORECAST_START_CONTEST, testDailyGame } from "./daily-model.js?v=15";
import { decodeDiary, diaryEntryKey, encodeDiary, gameKey, getPlayedGames, mergeDiary, setPlayedGames, validNumbers } from "./diary.js?v=16";
import { buildRatingProfile, MIN_DAILY_RATING, rateGame, RATING_LEVELS, RATING_WINDOW } from "./game-rating.js?v=15";
import { combinationCount, coverageForBudget, DRAW_SIZE, POSSIBLE_GAMES, SIMPLE_GAME_CENTS } from "./lottery-math.js?v=13";
import { compareContest } from "./contest-comparison.js?v=14";
import { simulateHistoricalGame } from "./contest-simulation.js?v=15";
import { createDiaryReport } from "./report-screen.js?v=17";
import { copyNumbersButton, copyText, installFieldActions } from "./field-actions.js?v=17";

const NUMBERS = Array.from({ length: 25 }, (_, index) => index + 1);
const DATA_REFRESH_INTERVAL = 60_000;
const DATA_LOAD_TIMEOUT = 12_000;
const HISTORICAL_SIMILARITY_WINDOW = 500;
const BACKTEST_RECENT_WINDOW = 120;
const state = {
  data: null,
  analysis: null,
  games: [],
  daily: null,
  benchmarkBase: null,
  forecastAuditBase: null,
  historyLimit: 12,
  manualDefaultContest: null,
  lastComparedContest: null,
  comparisonCleared: false,
  simulation: null,
  installPrompt: null,
};

const $ = (selector) => document.querySelector(selector);
const screens = [...document.querySelectorAll("[data-screen]")];
const tabs = [...document.querySelectorAll("[data-tab]")];
const ratingProfiles = new Map();

function renderScreen(focusHeading = false) {
  const [target, selectedContest] = window.location.hash.slice(1).split("/");
  if (target === "conteudo") return;
  const screen = screens.find(({ id }) => id === target) ?? screens[0];
  const screenChanged = screen.hidden;
  for (const item of screens) item.hidden = item !== screen;
  for (const tab of tabs) {
    if (tab.dataset.tab === screen.id) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  if (screen.id === "estatisticas") {
    renderDailyBenchmark();
    renderForecastAudit();
  }
  if (screen.id === "concursos") {
    if (screenChanged || selectedContest) state.comparisonCleared = false;
    renderContestComparison(true);
    if (screenChanged) refreshHistoricalSimulation();
    if (focusHeading && !screenChanged) window.scrollTo(0, 0);
  }
  refreshDiaryReport();
  if (focusHeading && screenChanged) {
    window.scrollTo(0, 0);
    screen.querySelector("h1").focus({ preventScroll: true });
  }
}

function formatNumber(value) {
  return String(value).padStart(2, "0");
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function formatUpdatedAt(value) {
  if (!value) return "sem registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function isLocalServer() {
  return ["localhost", "127.0.0.1", "192.168.1.6"].includes(window.location.hostname)
    || window.location.hostname.startsWith("192.168.")
    || window.location.hostname.startsWith("10.")
    || window.location.hostname.startsWith("172.");
}

function combinations(items, size) {
  const output = [];
  const walk = (start, combo) => {
    if (combo.length === size) {
      output.push([...combo]);
      return;
    }
    for (let index = start; index <= items.length - (size - combo.length); index += 1) {
      combo.push(items[index]);
      walk(index + 1, combo);
      combo.pop();
    }
  };
  walk(0, []);
  return output;
}

function estimatedGameCost(size) {
  return combinationCount(size, DRAW_SIZE) * SIMPLE_GAME_CENTS / 100;
}

function intersectionCount(a, b) {
  return a.filter((number) => b.includes(number)).length;
}

function numberMask(numbers) {
  return numbers.reduce((mask, number) => mask | (1 << (number - 1)), 0);
}

function maxSequentialRun(numbers) {
  let best = 1;
  let current = 1;
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] === numbers[index - 1] + 1) current += 1;
    else current = 1;
    best = Math.max(best, current);
  }
  return best;
}

function gameProfile(numbers) {
  const sum = numbers.reduce((total, number) => total + number, 0);
  const odd = numbers.filter((number) => number % 2).length;
  const even = numbers.length - odd;
  const low = numbers.filter((number) => number <= 13).length;
  const high = numbers.length - low;
  const rows = [0, 0, 0, 0, 0];
  const cols = [0, 0, 0, 0, 0];
  numbers.forEach((number) => {
    rows[Math.floor((number - 1) / 5)] += 1;
    cols[(number - 1) % 5] += 1;
  });
  return { sum, odd, even, low, high, rows, cols, sequence: maxSequentialRun(numbers) };
}

function gameIssues(numbers, analysis) {
  const profile = gameProfile(numbers);
  const latest = analysis.sorted[0]?.numbers || [];
  const repeatLatest = intersectionCount(numbers, latest);
  const maxOldSimilarity = maxHistoricalSimilarity(numbers, analysis);
  const [minRepeat, maxRepeat] = selectedLastRepeatRange(numbers.length);
  const idealHalf = numbers.length / 2;
  const issues = [];

  if (Math.abs(profile.sum - analysis.avgSum) > 38) issues.push("soma fora do padrao");
  if (Math.abs(profile.odd - idealHalf) > 2) issues.push("paridade desequilibrada");
  if (Math.abs(profile.low - idealHalf) > 2) issues.push("baixos/altos desequilibrado");
  if (profile.sequence >= 6) issues.push("sequencia longa");
  if (profile.rows.some((value) => value === 0 || value > 5)) issues.push("linhas concentradas");
  if (repeatLatest > Math.ceil(numbers.length * 0.75)) issues.push("repete demais o ultimo sorteio");
  if (repeatLatest < minRepeat || repeatLatest > maxRepeat) issues.push("fora da faixa de repeticao do ultimo");
  if (maxOldSimilarity >= 14) issues.push("muito parecido com concurso antigo");
  return issues;
}

function isStrongEnough(numbers, analysis) {
  return gameIssues(numbers, analysis).length === 0;
}

function buildRanking(frequency, recentFrequency, delay, total) {
  const maxFreq = Math.max(...NUMBERS.map((number) => frequency[number]));
  const maxRecent = Math.max(1, ...NUMBERS.map((number) => recentFrequency[number]));
  const maxDelay = Math.max(...NUMBERS.map((number) => delay[number] ?? total));

  return NUMBERS.map((number) => {
    const freqScore = frequency[number] / maxFreq;
    const recentScore = recentFrequency[number] / maxRecent;
    const delayScore = (delay[number] ?? maxDelay) / Math.max(maxDelay, 1);
    const score = freqScore * 0.45 + recentScore * 0.35 + delayScore * 0.2;
    return {
      number,
      frequency: frequency[number],
      percentage: frequency[number] / total,
      recentFrequency: recentFrequency[number],
      delay: delay[number] ?? total,
      score,
    };
  }).sort((a, b) => b.score - a.score);
}

function analyze(results, recentWindow) {
  const sorted = [...results].sort((a, b) => b.contest - a.contest);
  const recent = sorted.slice(0, recentWindow);
  const frequency = new Uint32Array(26);
  const recentFrequency = new Uint32Array(26);
  const delay = [];
  const pairCounts = new Map();
  const sums = [];

  sorted.forEach(({ numbers }, drawIndex) => {
    sums.push(numbers.reduce((sum, number) => sum + number, 0));
    numbers.forEach((number, index) => {
      frequency[number] += 1;
      delay[number] ??= drawIndex;
      for (let other = index + 1; other < numbers.length; other += 1) {
        const key = number * 26 + numbers[other];
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    });
  });

  recent.forEach(({ numbers }) => {
    for (const number of numbers) recentFrequency[number] += 1;
  });

  const ranking = buildRanking(frequency, recentFrequency, delay, sorted.length);
  const pairs = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => ({ count, numbers: [Math.floor(key / 26), key % 26] }));

  return {
    sorted,
    recent,
    ranking,
    rankByNumber: Object.fromEntries(ranking.map((item) => [item.number, item])),
    pool: buildWeightedPool(ranking),
    historicalMasks: sorted.slice(0, HISTORICAL_SIMILARITY_WINDOW).map(({ numbers }) => numberMask(numbers)),
    pairs,
    avgSum: average(sums),
    minSum: Math.min(...sums),
    maxSum: Math.max(...sums),
  };
}

function selectedLastRepeatRange(size) {
  const value = $("#lastRepeatRange")?.value || "auto";
  if (value === "auto") {
    if (size <= 15) return [7, 10];
    if (size <= 17) return [8, 12];
    return [9, 14];
  }
  return value.split("-").map(Number);
}

function maxHistoricalSimilarity(numbers, analysis) {
  const mask = numberMask(numbers);
  let best = 0;
  for (const historicalMask of analysis.historicalMasks) {
    let shared = mask & historicalMask;
    let count = 0;
    while (shared) {
      shared &= shared - 1;
      count += 1;
    }
    best = Math.max(best, count);
  }
  return best;
}

function explainGame(numbers, analysis) {
  const latest = analysis.sorted[0]?.numbers || [];
  const profile = gameProfile(numbers);
  const ranked = Object.fromEntries(analysis.ranking.map((item, index) => [item.number, index + 1]));
  const topNumbers = numbers.filter((number) => ranked[number] <= 10).length;
  const overdue = numbers.filter((number) => (analysis.ranking.find((item) => item.number === number)?.delay || 0) >= 4).length;
  const repeatLatest = intersectionCount(numbers, latest);
  const similarity = maxHistoricalSimilarity(numbers, analysis);
  return [
    `soma ${profile.sum}, media historica ${Math.round(analysis.avgSum)}`,
    `${profile.odd}/${profile.even} impares/pares`,
    `${topNumbers} numeros no top 10 do ranking`,
    `${overdue} numeros com atraso relevante`,
    `${repeatLatest} repetidos do ultimo sorteio`,
    `maximo ${similarity} iguais a concurso antigo`,
  ];
}

function scoreGame(numbers, analysis, strategy, issueCount = gameIssues(numbers, analysis).length) {
  const profile = gameProfile(numbers);

  const profileWeights = {
    balanced: { score: 0.55, delay: 0.15, freq: 0.15, recent: 0.15 },
    hot: { score: 0.35, delay: 0.05, freq: 0.45, recent: 0.15 },
    overdue: { score: 0.25, delay: 0.45, freq: 0.1, recent: 0.2 },
    mixed: { score: 0.35, delay: 0.25, freq: 0.2, recent: 0.2 },
  }[strategy];

  const raw = numbers.reduce((total, number) => {
    const item = analysis.rankByNumber[number];
    return total
      + item.score * profileWeights.score
      + item.delay * profileWeights.delay / 100
      + item.frequency * profileWeights.freq / 1000
      + item.recentFrequency * profileWeights.recent / 100;
  }, 0);

  const sumPenalty = Math.abs(profile.sum - analysis.avgSum) / 30;
  const oddPenalty = Math.abs(profile.odd - numbers.length / 2) * 0.18;
  const lowPenalty = Math.abs(profile.low - numbers.length / 2) * 0.12;
  const rowPenalty = profile.rows.filter((value) => value === 0 || value > 4).length * 0.18;
  const colPenalty = profile.cols.filter((value) => value === 0 || value > 4).length * 0.12;
  const issuePenalty = issueCount * 0.45;

  return raw - sumPenalty - oddPenalty - lowPenalty - rowPenalty - colPenalty - issuePenalty;
}

function buildWeightedPool(ranking) {
  return ranking.flatMap((item, index) => {
    const weight = Math.max(1, Math.round((26 - index) * (1 + item.score)));
    return Array.from({ length: weight }, () => item.number);
  });
}

function pickNumbers(pool, size) {
  const chosen = new Set();

  while (chosen.size < size) {
    chosen.add(pool[Math.floor(Math.random() * pool.length)]);
  }

  return [...chosen].sort((a, b) => a - b);
}

function generateGames() {
  if (!state.analysis) return;
  const mode = $("#generationMode").value;
  const analysis = state.analysis;
  const diary = getPlayedGames();
  state.daily = mode === "daily" ? createDailyGame(analysis.sorted, diary) : null;

  if (state.daily) {
    state.games = state.daily.numbers.length ? [{ numbers: state.daily.numbers }] : [];
    finishGeneration();
    return;
  }

  const count = Number($("#gameCount").value);
  const size = Number($("#gameSize").value);
  const strategy = $("#strategy").value;
  const playedKeys = new Set(diary.map((entry) => gameKey(entry.numbers)));
  const seen = new Set();
  const candidates = [];

  if (mode === "closure20") {
    state.games = generateClosureGames(count, strategy, playedKeys);
    finishGeneration();
    return;
  }

  for (let attempt = 0; attempt < count * 160; attempt += 1) {
    const numbers = pickNumbers(analysis.pool, size);
    const key = gameKey(numbers);
    if (!seen.has(key) && !playedKeys.has(key) && isStrongEnough(numbers, analysis)) {
      seen.add(key);
      candidates.push({ numbers, score: scoreGame(numbers, analysis, strategy, 0) });
    }
  }

  for (let attempt = 0; candidates.length < count && attempt < count * 120; attempt += 1) {
    const numbers = pickNumbers(analysis.pool, size);
    const key = gameKey(numbers);
    if (!seen.has(key) && !playedKeys.has(key)) {
      seen.add(key);
      candidates.push({ numbers, score: scoreGame(numbers, analysis, strategy) });
    }
  }

  state.games = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((game, index) => ({ ...game, index: index + 1 }));

  finishGeneration();
}

function generateClosureGames(count, strategy, playedKeys) {
  const base = state.analysis.ranking.slice(0, 20).map((item) => item.number).sort((a, b) => a - b);
  const removable = [...base].sort((a, b) => {
    const scoreA = state.analysis.ranking.find((item) => item.number === a)?.score || 0;
    const scoreB = state.analysis.ranking.find((item) => item.number === b)?.score || 0;
    return scoreA - scoreB;
  });
  const games = [];
  const seen = new Set();

  for (let attempt = 0; attempt < count * 120 && games.length < count; attempt += 1) {
    const offset = attempt % removable.length;
    const shuffled = [...removable.slice(offset), ...removable.slice(0, offset)];
    const remove = new Set(shuffled.filter((_, index) => index % count === games.length % Math.max(count, 1)).slice(0, 5));
    while (remove.size < 5) remove.add(shuffled[Math.floor(Math.random() * shuffled.length)]);
    const numbers = base.filter((number) => !remove.has(number)).sort((a, b) => a - b);
    const key = gameKey(numbers);
    if (!seen.has(key) && !playedKeys.has(key) && isStrongEnough(numbers, state.analysis)) {
      seen.add(key);
      games.push({ numbers, score: scoreGame(numbers, state.analysis, strategy, 0), base });
    }
  }

  for (let attempt = 0; games.length < count && attempt < count * 80; attempt += 1) {
    const numbers = pickNumbers(state.analysis.pool, 15);
    const key = gameKey(numbers);
    if (!seen.has(key) && !playedKeys.has(key)) {
      seen.add(key);
      games.push({ numbers, score: scoreGame(numbers, state.analysis, strategy), base });
    }
  }

  return games
    .sort((a, b) => b.score - a.score)
    .map((game, index) => ({ ...game, index: index + 1 }));
}

function finishGeneration() {
  const isDaily = Boolean(state.daily);
  updateStrategyNote();
  $("#gameControls").classList.toggle("daily-mode", isDaily);
  $("#generate").textContent = isDaily ? "Ver jogo do dia" : "Gerar e ver jogos";
  $("#gameHeading").textContent = isDaily ? "Jogo do dia" : "Jogos sugeridos";
  $("#gameContest").textContent = `Concurso ${nextContest()}`;
  $("#savePlayed").disabled = !state.games.length || Boolean(state.daily?.registered);
  $("#savePlayed").textContent = state.daily?.registered ? "Jogo registrado" : "Registrar jogo";
  $("#copyGames").disabled = !state.games.length;
  $("#copyGames").textContent = isDaily ? "Copiar dezenas" : "Copiar jogos";
  const hasDailyGame = isDaily && state.games.length > 0;
  $("#gameInsights").hidden = !hasDailyGame;
  $("#jogo").classList.toggle("multiple-games", !hasDailyGame);
  $("#dailyDetails").hidden = !isDaily;
  $("#coverage").hidden = isDaily;
  $("#legacyBacktestNote").hidden = isDaily;
  $("#backtest").hidden = isDaily;
  $("#strategyBacktest").hidden = isDaily;
  $("#dailyBenchmark").hidden = !isDaily;
  if (isDaily) {
    renderDailyGame(state.daily);
    renderDailyBenchmark();
  } else {
    renderGames();
    renderCoverage();
    renderBacktest();
  }
  renderHistory();
}

function updateStrategyNote() {
  const mode = $("#generationMode").value;
  const budget = Number($("#dailyBudget").value || 0);
  const count = mode === "daily" ? 1 : Number($("#gameCount").value || 1);
  const estimated = count * estimatedGameCost(mode === "daily" ? 15 : Number($("#gameSize").value || 15));
  const budgetNote = budget > 0 && estimated > budget ? " · acima do limite diário" : "";
  $("#strategyNote").textContent = `Custo estimado de R$ ${estimated.toFixed(2).replace(".", ",")}${budgetNote}`;
}

function renderSummary() {
  const data = state.data;
  const results = state.analysis.sorted;
  $("#metricContests").textContent = data.total_contests || results.length;
  $("#metricLatest").textContent = data.latest_contest || results[0].contest;
  $("#metricAvgSum").textContent = Math.round(state.analysis.avgSum);
  $("#metricRange").textContent = `${results[results.length - 1].date} a ${results[0].date}`;
  $("#metricUpdated").textContent = `Última atualização da base em ${formatUpdatedAt(data.updated_at)}`;
  $("#status").textContent = `Base até ${results[0].contest}`;
}

function renderRanking() {
  $("#rankingWindow").textContent = `Últimos ${state.analysis.recent.length}`;
  $("#copyRanking").innerHTML = copyNumbersButton(state.analysis.ranking.map(({ number }) => number), "Copiar dezenas do ranking");
  $("#numberRanking").innerHTML = state.analysis.ranking.map((item) => `
    <tr>
      <th scope="row"><span class="ball">${formatNumber(item.number)}</span></th>
      <td>${formatPercent.format(item.percentage)}</td>
      <td>${item.recentFrequency}</td>
      <td>${item.delay}</td>
    </tr>
  `).join("");
}

function renderPairs() {
  $("#pairRanking").innerHTML = state.analysis.pairs.map((pair) => `
    <div class="pair">
      <span>${pair.numbers.map(formatNumber).join(" + ")}</span>
      <small>${pair.count} vezes</small>
      ${copyNumbersButton(pair.numbers, `Copiar par ${pair.numbers.map(formatNumber).join(" e ")}`)}
    </div>
  `).join("");
}

const formatPercent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const formatSmallPercent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 4 });
const formatChancePercent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 8 });
const formatPoints = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const formatInteger = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatOdds(probability) {
  if (probability === 0 || probability === 1) return formatPercent.format(probability);
  const inverse = 1 / probability;
  if (Number.isInteger(inverse)) return `1 em ${formatInteger.format(inverse)}`;
  return `≈ 1 em ${(inverse < 100 ? formatPoints : formatInteger).format(inverse)}`;
}

function renderChanceCalculator() {
  const budgetCents = Math.round($("#chanceBudget").valueAsNumber * 100);
  const contests = $("#chanceContests").valueAsNumber;
  const result = $("#chanceResults");
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0
      || !Number.isInteger(contests) || contests < 1 || contests > 10000) {
    result.textContent = "Informe um orçamento válido e de 1 a 10.000 concursos.";
    return;
  }
  const coverage = coverageForBudget(budgetCents, contests);
  result.innerHTML = `
    <div><strong>${formatInteger.format(coverage.combinations)}</strong><small>Combinações por concurso</small></div>
    <div><strong>${formatCurrency.format(coverage.totalCents / 100)}</strong><small>Gasto total simulado</small></div>
    <div><strong>${formatOdds(coverage.perContest)}</strong><small>Chance em um concurso</small></div>
    ${contests > 1 ? `<div><strong>${formatChancePercent.format(coverage.overall)}</strong><small>Chance de pelo menos um 15 nos ${formatInteger.format(contests)} concursos</small></div>` : ""}
  `;
}

function renderChanceFormats() {
  $("#chanceFormats").innerHTML = Array.from({ length: 6 }, (_, index) => {
    const size = DRAW_SIZE + index;
    const count = combinationCount(size, DRAW_SIZE);
    return `<tr><th scope="row">${size}</th><td>${formatInteger.format(count)}</td>
      <td>${formatCurrency.format(count * SIMPLE_GAME_CENTS / 100)}</td>
      <td>${formatOdds(count / POSSIBLE_GAMES)}</td></tr>`;
  }).join("");
}

function renderForecastAudit() {
  if (!state.analysis || $("#estatisticas").hidden || !$("#forecastAudit").open || state.forecastAuditBase === state.data) return;
  const { historical, forward } = auditDailyForecast(state.analysis.sorted);
  state.forecastAuditBase = state.data;
  const historicalText = historical?.sampleSize
    ? `Nos ${historical.sampleSize} concursos testados (${historical.firstContest} a ${historical.lastContest}), o modelo atribuiu, em média geométrica, <strong>${formatPercent.format(Math.abs(historical.ratio - 1))} ${historical.ratio >= 1 ? "mais" : "menos"}</strong> probabilidade aos conjuntos sorteados do que a referência uniforme.`
    : "A base é pequena demais para esta avaliação histórica.";
  const status = forward.supported
    ? "O teste prospectivo atingiu o limiar e o modelo passou a orientar a seleção."
    : "A seleção continua usando os critérios de equilíbrio e o diário enquanto o sinal é avaliado.";
  $("#forecastAuditResult").innerHTML = `
    <p class="helper">O teste avalia a previsão do conjunto completo de 15 dezenas. Para cada concurso, o modelo usa só os resultados anteriores.</p>
    <p class="helper">${historicalText}</p>
    <p class="helper">Acompanhamento prospectivo a partir do concurso ${FORECAST_START_CONTEST} · ${forward.sampleSize} resultados avaliados. ${status}</p>
  `;
}

function ratingFor(numbers, contest) {
  if (!ratingProfiles.has(contest)) {
    ratingProfiles.set(contest, buildRatingProfile(state.analysis.sorted, contest));
  }
  return rateGame(numbers, ratingProfiles.get(contest));
}

function ratingBadge({ score, level }) {
  return `<span class="rating-badge ${level.tone}"><strong>${score}/100</strong> ${level.label}</span>`;
}

function ratingBreakdown(rating) {
  return `
    <ul class="rating-breakdown">
      ${rating.criteria.map(({ name, value, points, weight }) => `
        <li><span>${name}${value === null ? "" : ` · ${value}`}</span>
          <strong>${points === null ? "Indisponível" : `${formatPoints.format(points)} de ${weight} pts`}</strong></li>
      `).join("")}
    </ul>
  `;
}

function renderRatingLegends() {
  const legend = `
    <ul class="rating-legend">
      ${RATING_LEVELS.map(({ range, label, tone }) => `<li class="rating-badge ${tone}"><strong>${range}</strong> ${label}</li>`).join("")}
    </ul>
    <p class="helper">A nota compara soma, ímpares, dezenas baixas e repetição com até ${RATING_WINDOW} sorteios anteriores ao concurso do jogo. A chance matemática é igual para combinações do mesmo tamanho.</p>
  `;
  document.querySelectorAll("[data-rating-legend]").forEach((container) => {
    container.innerHTML = legend;
  });
}

function renderDailyGame(game) {
  if (!game.numbers.length) {
    $("#games").textContent = `A busca terminou sem encontrar um jogo novo com nota ${MIN_DAILY_RATING} ou maior.`;
    return;
  }
  const rating = ratingFor(game.numbers, game.contest);
  $("#games").innerHTML = `
    <div class="daily-numbers" aria-label="15 dezenas">${game.numbers.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
    <div>${ratingBadge(rating)}</div>
  `;
  $("#insightsHeading").textContent = game.registered ? "Leitura do jogo registrado" : "Leitura da sugestão";
  $("#dailyInsights").innerHTML = `
    ${game.registered ? "" : `<p class="helper">O Jogo do dia exige nota mínima de ${MIN_DAILY_RATING}/100.</p>`}
    ${game.forecastEnabled && !game.registered ? '<p class="helper">Seleção orientada pelo modelo prospectivo.</p>' : ""}
    <dl class="insights-list">
      <div><dt>Em comum com o último sorteio</dt><dd>${game.drawnRepeat} dezenas</dd></div>
      <div><dt>Média histórica entre sorteios consecutivos</dt><dd>${formatPoints.format(game.averageRepeat)} dezenas</dd></div>
      ${game.previousCount
        ? `<div><dt>Em comum com seu último jogo</dt><dd>${game.playedRepeat} dezenas</dd></div>`
        : ""}
    </dl>
    <details><summary>Como a nota foi calculada</summary>${ratingBreakdown(rating)}</details>
    ${game.previousCount ? "" : '<p class="helper">Registre o jogo que fizer para personalizar as próximas sugestões.</p>'}
  `;
  $("#dailyFrequencies").innerHTML = `
    <p class="helper">Compare a frequência das 15 dezenas nos sorteios recentes e no histórico.</p>
    <table class="comparison-table">
      <thead><tr><th scope="col">Dezena</th><th scope="col">Últimos ${game.shortDraws}</th><th scope="col">Últimos ${game.recentDraws}</th><th scope="col">Histórico (${game.historicalDraws})</th></tr></thead>
      <tbody>${game.frequencies.map(({ number, short, recent, full }) => `
        <tr><th scope="row">${formatNumber(number)}</th><td>${formatPercent.format(short)}</td>
          <td>${formatPercent.format(recent)}</td><td>${formatPercent.format(full)}</td></tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderDailyBenchmark() {
  if (!state.daily || $("#estatisticas").hidden || !$("#dailyBenchmark").open || state.benchmarkBase === state.data) return;
  const test = testDailyGame(state.analysis.sorted);
  state.benchmarkBase = state.data;
  if (!test) {
    $("#dailyBenchmarkResult").textContent = "Sem jogos suficientes para esta simulação.";
    return;
  }
  $("#dailyBenchmarkResult").innerHTML = `
    <p class="helper">${test.sampleSize} concursos, do ${test.firstContest} ao ${test.lastContest}. Cada sugestão usou a nota mínima de ${MIN_DAILY_RATING}/100 e os dados anteriores ao sorteio.${test.played < test.sampleSize ? ` A regra permitiu sugerir jogos em ${test.played} concursos.` : ""}</p>
    <p class="helper"><strong>${formatPoints.format(test.mean)}</strong> acertos em média na simulação. Para uma amostra desse tamanho, o acaso tem média esperada de ${formatPoints.format(test.fairMean)} e faixa de 95% de ${formatPoints.format(test.lowerFairMean)} a ${formatPoints.format(test.upperFairMean)}.</p>
    <table class="comparison-table">
      <thead><tr><th scope="col">Acertos</th><th scope="col">Simulação</th><th scope="col">Referência aleatória</th></tr></thead>
      <tbody>${test.rows.map(({ score, observed, expected }) => `
        <tr><th scope="row">${score === 15 ? "15" : `${score}+`}</th>
        <td>${observed}/${test.played} (${formatPercent.format(observed / test.played)})</td>
        <td>${score === 15 ? "1 em 3.268.760" : (score === 14 ? formatSmallPercent : formatPercent).format(expected)}</td></tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderGames() {
  $("#games").innerHTML = state.games.map((game) => {
    const issues = gameIssues(game.numbers, state.analysis);
    const rating = ratingFor(game.numbers, nextContest());
    return `
    <article class="game">
      <div class="game-title">
        Jogo ${game.index}
        <span class="game-meta">${game.numbers.length} dezenas</span>
        ${ratingBadge(rating)}
        ${copyNumbersButton(game.numbers, `Copiar dezenas do jogo ${game.index}`)}
      </div>
      <div class="numbers">${game.numbers.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
      <details class="game-explain">
        <summary>Ver critérios do jogo</summary>
        ${ratingBreakdown(rating)}
        <ul>${explainGame(game.numbers, state.analysis).map((item) => `<li>${item}</li>`).join("")}</ul>
        ${issues.length ? `<p>Alertas: ${issues.join(", ")}</p>` : ""}
      </details>
    </article>
    `;
  }).join("");
}

function renderCoverage() {
  if (!state.games.length) {
    $("#coverage").innerHTML = "";
    return;
  }
  const allNumbers = new Set(state.games.flatMap((game) => game.numbers));
  const overlaps = [];
  combinations(state.games, 2).forEach(([a, b]) => overlaps.push(intersectionCount(a.numbers, b.numbers)));
  const maxOverlap = overlaps.length ? Math.max(...overlaps) : 0;
  const avgOverlap = overlaps.length ? average(overlaps) : 0;
  const base = state.games.find((game) => game.base)?.base;

  $("#coverage").innerHTML = `
    <div><strong>${allNumbers.size}</strong><small>dezenas cobertas</small></div>
    <div><strong>${maxOverlap}</strong><small>maior repetição entre jogos</small></div>
    <div><strong>${formatPoints.format(avgOverlap)}</strong><small>repetição média</small></div>
    ${base ? `<div><strong>${base.map(formatNumber).join(" ")}</strong><small>base 20 usada</small>
      ${copyNumbersButton(base, "Copiar dezenas da base", "Copiar base")}</div>` : ""}
  `;
}

function renderBacktest() {
  if (!state.games.length) return;
  const sample = state.analysis.sorted.slice(0, Math.min(120, state.analysis.sorted.length));
  const hits = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  let best = 0;

  sample.forEach((draw) => {
    state.games.forEach((game) => {
      const match = game.numbers.filter((number) => draw.numbers.includes(number)).length;
      best = Math.max(best, match);
      if (match >= 11) hits[match] = (hits[match] || 0) + 1;
    });
  });

  $("#backtest").innerHTML = `
    <div><strong>${best}</strong><small>maior acerto nos últimos ${sample.length}</small></div>
    <div><strong>${hits[11] || 0}</strong><small>resultados com 11 acertos</small></div>
    <div><strong>${hits[12] || 0}</strong><small>resultados com 12 acertos</small></div>
    <div><strong>${hits[13] || 0}</strong><small>resultados com 13 acertos</small></div>
    <div><strong>${hits[14] || 0}</strong><small>resultados com 14 acertos</small></div>
    <div><strong>${hits[15] || 0}</strong><small>resultados com 15 acertos</small></div>
  `;
  renderStrategyBacktest();
}

function buildBacktestPools(sorted, sampleSize) {
  const pools = [];
  const frequency = new Uint32Array(26);
  const lastSeen = [];

  // Each pool uses only draws older than the draw being simulated.
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    for (const number of sorted[index].numbers) {
      frequency[number] += 1;
      lastSeen[number] = index;
    }
    if (index > sampleSize) continue;

    const recentFrequency = new Uint32Array(26);
    const recentEnd = Math.min(index + BACKTEST_RECENT_WINDOW, sorted.length);
    for (let recentIndex = index; recentIndex < recentEnd; recentIndex += 1) {
      for (const number of sorted[recentIndex].numbers) recentFrequency[number] += 1;
    }
    const delay = lastSeen.map((lastIndex) => lastIndex - index);
    const ranking = buildRanking(frequency, recentFrequency, delay, sorted.length - index);
    pools[index - 1] = buildWeightedPool(ranking);
  }
  return pools;
}

function renderStrategyBacktest() {
  const strategies = ["balanced", "hot", "overdue", "mixed"];
  const { sorted } = state.analysis;
  const sampleSize = Math.min(80, sorted.length - 140);
  if (sampleSize <= 10) {
    $("#strategyBacktest").innerHTML = "";
    return;
  }

  const pools = buildBacktestPools(sorted, sampleSize);
  const rows = strategies.map((strategy) => {
    const matches = pools.map((pool, index) => intersectionCount(pickNumbers(pool, 15), sorted[index].numbers));
    const buckets = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
    matches.forEach((hits) => {
      if (hits >= 11) buckets[hits] += 1;
    });
    return {
      label: strategyLabel(strategy),
      avg: average(matches),
      best: Math.max(...matches),
      buckets,
    };
  }).sort((a, b) => b.avg - a.avg);

  $("#strategyBacktest").innerHTML = `
    <h3>Ranking de estratégias</h3>
    <div class="strategy-table">
      ${rows.map((row) => `
        <div>
          <strong>${row.label}</strong>
          <span>Média de ${formatPoints.format(row.avg)} · melhor ${row.best}</span>
          <small>11+: ${row.buckets[11] + row.buckets[12] + row.buckets[13] + row.buckets[14] + row.buckets[15]} | 13+: ${row.buckets[13] + row.buckets[14] + row.buckets[15]} | 15: ${row.buckets[15]}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function nextContest() {
  return state.analysis.sorted[0].contest + 1;
}

function comparisonContest() {
  if (window.location.hash === "#conteudo" && state.lastComparedContest) return state.lastComparedContest;
  const [, selection] = window.location.hash.split("/");
  const contest = Number(selection);
  return Number.isSafeInteger(contest) && contest > 0 ? contest : nextContest() - 1;
}

function openContestComparison(contest) {
  state.comparisonCleared = false;
  const hash = `#concursos/${contest}`;
  if (window.location.hash === hash) renderContestComparison(true);
  else window.location.hash = hash;
}

function renderContestComparison(updateInput = false) {
  if (!state.analysis || $("#concursos").hidden) return;

  const contest = comparisonContest();
  const latest = nextContest() - 1;
  const first = state.analysis.sorted[state.analysis.sorted.length - 1].contest;
  const input = $("#comparisonContest");
  input.disabled = false;
  input.min = first;
  input.max = latest + 1;
  if (!state.comparisonCleared) {
    if (updateInput || !input.value || input.valueAsNumber === state.lastComparedContest) input.value = contest;
    state.lastComparedContest = contest;
  }

  const inRange = !state.comparisonCleared && contest >= first && contest <= latest + 1;
  $("#contestSearchButton").disabled = false;
  $("#previousContest").disabled = !inRange || contest <= first;
  $("#nextContestButton").disabled = !inRange || contest >= latest + 1;
  $("#contestRetry").hidden = true;
  $("#contestComparison").hidden = !inRange;
  $("#comparisonStatus").hidden = inRange;
  if (!inRange) {
    $("#comparisonStatus").textContent = state.comparisonCleared
      ? "Digite um número de concurso para conferir."
      : `Escolha um concurso de ${first} a ${latest + 1}.`;
    return;
  }

  const drawIndex = state.analysis.sorted.findIndex((draw) => draw.contest === contest);
  const result = state.analysis.sorted[drawIndex];
  const { draw, plays } = compareContest(contest, result, getPlayedGames());
  $("#drawDate").textContent = draw
    ? `Concurso ${contest} · ${draw.date}`
    : `Concurso ${contest} · Aguardando resultado na base`;

  const drawn = new Set(draw?.numbers);
  $("#drawBoard").innerHTML = draw ? `
    <ol class="draw-board" role="list" aria-label="Volante do concurso ${contest}">
      ${NUMBERS.map((number) => {
        const selected = drawn.has(number);
        return `<li class="draw-cell${selected ? " is-drawn" : ""}" aria-label="${formatNumber(number)}${selected ? ", sorteada" : ""}">${formatNumber(number)}</li>`;
      }).join("")}
    </ol>
    <div class="section-heading">
      <p class="helper">As dezenas em roxo saíram no sorteio.</p>
      ${copyNumbersButton(draw.numbers, `Copiar dezenas sorteadas no concurso ${contest}`, "Copiar sorteadas")}
    </div>
    ${renderDrawProfile(draw, state.analysis.sorted[drawIndex + 1])}
  ` : "";

  $("#contestPlays").innerHTML = plays.length
    ? renderComparedPlays(plays, Boolean(draw))
    : '<p class="empty-state">Nenhum jogo registrado para este concurso no seu Diário.</p>';
}

function renderDrawProfile(draw, previous) {
  const { odd, even, sum, low } = gameProfile(draw.numbers);
  return `
    <dl class="draw-profile" aria-label="Perfil do sorteio">
      <div><dt>Ímpares / pares</dt><dd>${odd} / ${even}</dd></div>
      <div><dt>Soma</dt><dd>${sum}</dd></div>
      <div><dt>Dezenas de 01 a 13</dt><dd>${low}</dd></div>
      ${previous?.contest === draw.contest - 1
        ? `<div><dt>Repetidas do anterior</dt><dd>${intersectionCount(draw.numbers, previous.numbers)}</dd></div>`
        : ""}
    </dl>
  `;
}

function renderComparedPlays(plays, hasResult) {
  return `
    ${hasResult ? '<p class="helper">O ✓ indica as dezenas que você acertou.</p>' : ""}
    ${plays.map(({ entry, hits, missing }, index) => {
      const matched = new Set(hits);
      return `
        <article class="compared-play">
          <div class="section-heading">
            <h3>Jogo ${index + 1} · ${entry.numbers.length} dezenas</h3>
            <span class="result-count${hits?.length === DRAW_SIZE ? " is-full" : ""}">
              ${hits ? `${hits.length} de ${DRAW_SIZE} acertos` : "Aguardando resultado"}
            </span>
          </div>
          <div class="numbers" aria-label="Dezenas jogadas">
            ${entry.numbers.map((number) => matched.has(number)
              ? `<span class="mini-ball is-hit" aria-label="${formatNumber(number)}, acerto">${formatNumber(number)}&nbsp;✓</span>`
              : `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}
          </div>
          <div class="copy-row">
            ${copyNumbersButton(entry.numbers, `Copiar dezenas do jogo ${index + 1}`, "Copiar jogo")}
            ${copyNumbersButton(hits ?? [], `Copiar acertos do jogo ${index + 1}`, "Copiar acertos")}
          </div>
          ${missing?.length ? `
            <details><summary>Sorteadas que ficaram de fora (${missing.length})</summary>
              <div class="numbers">${missing.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
              <div class="copy-row">${copyNumbersButton(missing, `Copiar dezenas que ficaram de fora do jogo ${index + 1}`)}</div>
            </details>
          ` : ""}
        </article>
      `;
    }).join("")}
  `;
}

function parseFifteenNumbers(value) {
  const digits = value.trim().split(/[\s,;-]+/);
  const numbers = digits.map(Number).sort((a, b) => a - b);
  return digits.every((digit) => /^\d{1,2}$/.test(digit)) && validNumbers(numbers, DRAW_SIZE, DRAW_SIZE)
    ? numbers : null;
}

function clearSearchField(field, previous) {
  if (field.id === "comparisonContest") {
    state.comparisonCleared = true;
    state.lastComparedContest = null;
    window.history.replaceState(null, "", "#concursos");
    renderContestComparison();
  }
  if (field.id === "simulationDiary" && previous) $("#simulationNumbers").value = "";
}

function refreshHistoricalSimulation() {
  const select = $("#simulationDiary");
  const selected = select.value;
  const diary = getPlayedGames();
  const playable = diary.filter((entry) => Number.isSafeInteger(entry.targetContest)
    && validNumbers(entry.numbers, DRAW_SIZE, DRAW_SIZE));
  select.innerHTML = `
    <option value="">${playable.length ? "Escolha um jogo registrado" : "Nenhum jogo de 15 dezenas registrado"}</option>
    ${playable.map((entry) => `
      <option value="${diaryEntryKey(entry)}">Concurso ${entry.targetContest} · ${entry.numbers.map(formatNumber).join(" ")}</option>
    `).join("")}
  `;
  select.value = selected;
  select.disabled = !playable.length;
  $("#simulationSubmit").disabled = !state.analysis;
  if (state.simulation) renderHistoricalSimulation(diary);
}

function resetHistoricalSimulation() {
  state.simulation = null;
  $("#simulationResults").hidden = true;
  $("#simulationStatus").textContent = "";
}

function startHistoricalSimulation(event) {
  event.preventDefault();
  if (!state.analysis) return;
  const numbers = parseFifteenNumbers($("#simulationNumbers").value);
  if (!numbers) {
    resetHistoricalSimulation();
    $("#simulationStatus").textContent = "Digite 15 dezenas diferentes entre 01 e 25.";
    return;
  }
  state.simulation = { numbers, onlyPlayed: $("#simulationScope").value === "played" };
  renderHistoricalSimulation(getPlayedGames());
}

function renderHistoricalSimulation(diary) {
  const { numbers, onlyPlayed } = state.simulation;
  const playedContests = onlyPlayed ? new Set(diary.map((entry) => entry.targetContest)) : null;
  const { sampleSize, hits, best } = simulateHistoricalGame(numbers, state.analysis.sorted, playedContests);
  $("#simulationResults").hidden = sampleSize === 0;
  if (!sampleSize) {
    $("#simulationStatus").textContent = "Seu Diário ainda não tem concursos com resultado para simular.";
    return;
  }
  const qualifying = Object.values(hits).reduce((sum, count) => sum + count, 0);
  $("#simulationStatus").textContent = `Esse jogo teria alcançado uma faixa de prêmio (11 a 15 acertos) em ${formatInteger.format(qualifying)} de ${formatInteger.format(sampleSize)} concursos analisados.`;
  $("#simulationCounts").innerHTML = Object.entries(hits).map(([points, count]) => `
    <div><strong>${formatInteger.format(count)}</strong><small>${points} acertos</small></div>
  `).join("");
  $("#simulationBest").hidden = best.length === 0;
  $("#simulationMatches").innerHTML = best.map(({ contest, date, points }) => `
    <tr><th scope="row"><a href="#concursos/${contest}">${contest}</a></th>
      <td>${date}</td><td>${points}</td></tr>
  `).join("");
}

function diaryEntry(numbers, targetContest, mode, strategy, score = null) {
  return {
    key: gameKey(numbers), numbers, targetContest, mode, strategy, score,
    cost: estimatedGameCost(numbers.length), createdAt: new Date().toISOString(),
  };
}

function renderDiaryChange() {
  refreshDiaryReport();
  if (!state.analysis) return;
  if (state.daily) generateGames();
  else renderHistory();
  renderContestComparison();
  refreshHistoricalSimulation();
}

function storeDiaryEntries(additions) {
  const current = getPlayedGames();
  const entries = mergeDiary(current, additions);
  const added = entries.length - current.length;
  if (!added) return 0;
  setPlayedGames(entries);
  renderDiaryChange();
  return added;
}

function savePlayedGames() {
  if (!state.games.length || state.daily?.registered) return;
  const mode = $("#generationMode").value;
  const strategy = state.daily ? "daily" : $("#strategy").value;
  const contest = nextContest();
  const entries = state.games.map(({ numbers, score }) => diaryEntry(numbers, contest, mode, strategy, score));
  try {
    const added = storeDiaryEntries(entries);
    showToast(added ? `Jogo(s) registrado(s) para o concurso ${contest}.` : "Jogo já registrado neste concurso.");
  } catch {
    showToast("Não foi possível salvar o jogo neste navegador.");
  }
}

function saveManualGame(event) {
  event.preventDefault();
  if (!state.analysis) {
    showToast("Aguarde o carregamento dos concursos.");
    return;
  }
  const contest = $("#manualContest").valueAsNumber;
  const numbers = parseFifteenNumbers($("#manualNumbers").value);
  if (!Number.isSafeInteger(contest) || contest < 1 || contest > nextContest()) {
    showToast(`Informe um concurso entre 1 e ${nextContest()}.`);
    return;
  }
  if (!numbers) {
    showToast("Informe 15 dezenas diferentes entre 01 e 25.");
    return;
  }
  try {
    const added = storeDiaryEntries([diaryEntry(numbers, contest, "manual", "manual")]);
    $("#manualNumbers").value = "";
    showToast(added ? `Jogo registrado para o concurso ${contest}.` : "Jogo já registrado neste concurso.");
  } catch {
    showToast("Não foi possível salvar o jogo neste navegador.");
  }
}

function exportDiary() {
  downloadFile(encodeDiary(getPlayedGames()), "application/json", "diario-lotofacil.json");
}

async function importDiary(event) {
  const input = event.currentTarget;
  const [file] = input.files;
  if (!file) return;
  try {
    const entries = decodeDiary(await file.text());
    const added = storeDiaryEntries(entries);
    showToast(added ? `${added} jogo(s) importado(s).` : "O backup não trouxe jogos novos.");
  } catch (error) {
    showToast(error.name === "QuotaExceededError"
      ? "Sem espaço para importar o diário neste navegador."
      : error instanceof SyntaxError ? "Arquivo de backup inválido." : error.message);
  } finally {
    input.value = "";
  }
}

function renderHistory() {
  const entries = getPlayedGames();
  $("#showMoreHistory").hidden = entries.length <= state.historyLimit;
  const byContest = Object.fromEntries(state.analysis.sorted.map((draw) => [draw.contest, draw]));
  renderHistoryStats(entries, byContest);
  if (!entries.length) {
    $("#history").innerHTML = `<div class="empty-state">Nenhum jogo registrado ainda.</div>`;
    return;
  }

  $("#history").innerHTML = entries.slice(0, state.historyLimit).map((entry) => {
    const hits = entryHits(entry, byContest);
    const rating = ratingFor(entry.numbers, entry.targetContest);
    return `
      <article class="history-item">
        <div>
          <strong><a href="#concursos/${entry.targetContest}">Concurso ${entry.targetContest}</a></strong>
          <small>${formatUpdatedAt(entry.createdAt)} · ${diaryModeLabel(entry.mode)}</small>
        </div>
        <div class="numbers">${entry.numbers.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
        <div class="history-actions">
          ${ratingBadge(rating)}
          <div class="history-result">${hits === null ? "Aguardando resultado" : `${hits} acertos`}</div>
          ${copyNumbersButton(entry.numbers, `Copiar jogo do concurso ${entry.targetContest}`)}
          <button class="ghost danger" type="button" data-delete-game="${diaryEntryKey(entry)}"
            aria-label="Excluir jogo do concurso ${entry.targetContest}">Excluir</button>
        </div>
      </article>
    `;
  }).join("");
}

function entryHits(entry, byContest) {
  const draw = byContest[entry.targetContest];
  return draw ? intersectionCount(entry.numbers, draw.numbers) : null;
}

function diaryModeLabel(mode) {
  return {
    daily: "Jogo do dia",
    manual: "Registro manual",
    diversified: "Diversificar jogos",
    closure20: "Base 20",
  }[mode] ?? "Jogo registrado";
}

function renderHistoryStats(entries, byContest) {
  const container = $("#historyStats");
  if (!entries.length) {
    container.innerHTML = "";
    return;
  }

  const resolved = entries
    .map((entry) => ({ ...entry, hits: entryHits(entry, byContest) }))
    .filter((entry) => entry.hits !== null);
  const pending = entries.length - resolved.length;
  const totalCost = entries.reduce((total, entry) => total + (entry.spentCents != null
    ? entry.spentCents / 100 : entry.cost ?? estimatedGameCost(entry.numbers.length)), 0);
  const costLabel = entries.every((entry) => entry.spentCents != null) ? "gastos informados" : "gasto estimado";
  const bestHits = resolved.length ? Math.max(...resolved.map((entry) => entry.hits)) : "-";
  const avgHits = resolved.length ? formatPoints.format(average(resolved.map((entry) => entry.hits))) : "–";
  const prizeRange = resolved.filter((entry) => entry.hits >= 11).length;

  container.innerHTML = `
    <div><strong>${entries.length}</strong><small>jogos registrados</small></div>
    <div><strong>${formatCurrency.format(totalCost)}</strong><small>${costLabel}</small></div>
    <div><strong>${bestHits}</strong><small>melhor acerto</small></div>
    <div><strong>${avgHits}</strong><small>média de acertos</small></div>
    <div><strong>${pending}</strong><small>aguardando resultado</small></div>
    <div><strong>${prizeRange}</strong><small>jogos com 11 ou mais acertos</small></div>
  `;
}

function strategyLabel(strategy) {
  return {
    balanced: "Equilibrado",
    hot: "Mais sorteados",
    overdue: "Mais atrasados",
    mixed: "Misto agressivo",
  }[strategy] || strategy;
}

function clearHistory() {
  if (!confirm("Apagar o diário deste navegador? Salve um backup antes se quiser recuperá-lo depois.")) return;
  try {
    setPlayedGames([]);
    state.historyLimit = 12;
    renderDiaryChange();
    showToast("Diário limpo.");
  } catch {
    showToast("Não foi possível limpar o diário.");
  }
}

function deletePlayedGame(event) {
  const button = event.target.closest("[data-delete-game]");
  if (!button) return;
  const key = button.dataset.deleteGame;
  const entry = getPlayedGames().find((game) => diaryEntryKey(game) === key);
  if (!entry || !confirm(`Excluir do diário este jogo do concurso ${entry.targetContest}?\n\n${entry.numbers.map(formatNumber).join(" ")}`)) return;
  try {
    setPlayedGames(getPlayedGames().filter((game) => diaryEntryKey(game) !== key));
    renderDiaryChange();
    showToast("Jogo excluído do diário.");
  } catch {
    showToast("Não consegui excluir o jogo neste navegador.");
  }
}

function downloadCsv() {
  if (!state.analysis) return;
  const header = "numero,frequencia,percentual,frequencia_recente,atraso,pontuacao";
  const rows = state.analysis.ranking.map((item) => [
    formatNumber(item.number),
    item.frequency,
    (item.percentage * 100).toFixed(2),
    item.recentFrequency,
    item.delay,
    item.score.toFixed(4),
  ].join(","));
  downloadFile([header, ...rows].join("\n"), "text/csv;charset=utf-8", "ranking-lotofacil.csv");
}

function downloadFile(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyGames() {
  const text = state.games
    .map((game) => game.numbers.map(formatNumber).join(" "))
    .join("\n");
  await copyText(text, showToast);
}

let pendingLoad;

function loadData() {
  pendingLoad ??= readPublishedData().finally(() => {
    pendingLoad = undefined;
  });
  return pendingLoad;
}

async function readPublishedData() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_LOAD_TIMEOUT);
  try {
    const response = await fetch("data/lotofacil.json", { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error("Base indisponível");
    const data = await response.json();
    if (!data?.results?.length || !data.updated_at) throw new Error("Base de concursos inválida");
    const previous = state.data;
    if (previous && data.updated_at <= previous.updated_at) return;
    const previousAnalysis = state.analysis;
    state.data = data;
    ratingProfiles.clear();
    try {
      refreshAnalysis();
    } catch (error) {
      state.data = previous;
      state.analysis = previousAnalysis;
      throw error;
    }
    $("#retryLoading").hidden = true;
  } finally {
    clearTimeout(timer);
  }
}

async function forceUpdate() {
  const button = $("#forceUpdate");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Consultando…";

  try {
    if (isLocalServer()) {
      const response = await fetch("/api/update", { method: "POST" });
      if (!response.ok || !(await response.json()).ok) throw new Error("Atualização indisponível.");
    }
    await loadData();
    showToast(`Base consultada até o concurso ${state.analysis.sorted[0].contest}.`);
  } catch {
    showToast("Não consegui consultar os resultados. Tente novamente em instantes.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

function updateInstallButtons(visible) {
  $("#installPanel").hidden = !visible;
  $("#installApp").hidden = !visible;
}

async function installApp() {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;
    state.installPrompt = null;
    updateInstallButtons(false);
    if (choice.outcome === "accepted") showToast("App instalado.");
    return;
  }

  if (isIos()) {
    showToast("No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.");
    return;
  }

  showToast("A instalação não está disponível neste navegador.");
}

function setupPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {
      showToast("O modo offline está indisponível.");
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallButtons(!isStandalone());
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    updateInstallButtons(false);
    showToast("Instalado na tela inicial.");
  });

  if (isIos() && !isStandalone()) {
    updateInstallButtons(true);
  }
}

function refreshAnalysis() {
  if (!state.data) return;
  state.analysis = analyze(state.data.results, Number($("#recentWindow").value));
  const contest = nextContest();
  const manualContest = $("#manualContest");
  if (!manualContest.value || (manualContest.valueAsNumber === state.manualDefaultContest && !$("#manualNumbers").value)) {
    manualContest.value = contest;
  }
  manualContest.max = contest;
  state.manualDefaultContest = contest;
  renderSummary();
  renderRanking();
  renderPairs();
  generateGames();
  renderForecastAudit();
  renderContestComparison();
  refreshHistoricalSimulation();
  refreshDiaryReport();
}

async function init() {
  const retry = $("#retryLoading");
  const contestRetry = $("#contestRetry");
  retry.disabled = true;
  contestRetry.disabled = true;
  try {
    await loadData();
    retry.hidden = true;
    contestRetry.hidden = true;
  } catch (error) {
    if (!state.data) {
      $("#status").textContent = "Base indisponível";
      $("#gameContest").textContent = "Não consegui carregar o concurso";
      $("#comparisonStatus").textContent = "Não consegui carregar a base de concursos";
      retry.hidden = false;
      contestRetry.hidden = false;
      console.error(error);
    }
  } finally {
    retry.disabled = false;
    contestRetry.disabled = false;
  }
}

$("#generate").addEventListener("click", () => {
  if ($("#generationMode").value !== "daily") generateGames();
  window.location.hash = "jogo";
});
$("#recentWindow").addEventListener("change", refreshAnalysis);
$("#strategy").addEventListener("change", generateGames);
$("#gameSize").addEventListener("change", generateGames);
$("#generationMode").addEventListener("change", generateGames);
$("#lastRepeatRange").addEventListener("change", generateGames);
$("#dailyBudget").addEventListener("change", (event) => {
  updateStrategyNote();
  $("#chanceBudget").value = event.currentTarget.value;
  renderChanceCalculator();
});
$("#chanceBudget").addEventListener("input", renderChanceCalculator);
$("#chanceContests").addEventListener("input", renderChanceCalculator);
$("#downloadCsv").addEventListener("click", downloadCsv);
$("#copyGames").addEventListener("click", copyGames);
$("#savePlayed").addEventListener("click", savePlayedGames);
$("#manualGame").addEventListener("submit", saveManualGame);
$("#dailyBenchmark").addEventListener("toggle", renderDailyBenchmark);
$("#forecastAudit").addEventListener("toggle", renderForecastAudit);
$("#exportDiary").addEventListener("click", exportDiary);
$("#importDiary").addEventListener("click", () => $("#diaryFile").click());
$("#diaryFile").addEventListener("change", importDiary);
$("#showMoreHistory").addEventListener("click", () => {
  state.historyLimit += 12;
  renderHistory();
});
$("#clearHistory").addEventListener("click", clearHistory);
$("#history").addEventListener("click", deletePlayedGame);
$("#forceUpdate").addEventListener("click", forceUpdate);
$("#contestSearch").addEventListener("submit", (event) => {
  event.preventDefault();
  const contest = $("#comparisonContest").valueAsNumber;
  if (Number.isSafeInteger(contest) && contest > 0) openContestComparison(contest);
});
$("#previousContest").addEventListener("click", () => openContestComparison(comparisonContest() - 1));
$("#nextContestButton").addEventListener("click", () => openContestComparison(comparisonContest() + 1));
$("#historicalSimulation").addEventListener("submit", startHistoricalSimulation);
$("#simulationDiary").addEventListener("change", (event) => {
  const entry = getPlayedGames().find((row) => diaryEntryKey(row) === event.currentTarget.value);
  if (entry) $("#simulationNumbers").value = entry.numbers.map(formatNumber).join(" ");
  resetHistoricalSimulation();
});
$("#simulationNumbers").addEventListener("input", () => {
  $("#simulationDiary").value = "";
  resetHistoricalSimulation();
});
$("#simulationScope").addEventListener("change", resetHistoricalSimulation);
$("#retryLoading").addEventListener("click", init);
$("#contestRetry").addEventListener("click", init);
$("#installApp").addEventListener("click", installApp);
window.addEventListener("online", init);
window.addEventListener("hashchange", () => renderScreen(true));

const refreshDiaryReport = createDiaryReport({
  getDraws: () => state.analysis?.sorted ?? [],
  onDiaryChanged: renderDiaryChange,
  notify: showToast,
});
installFieldActions({ onClear: clearSearchField, notify: showToast });
renderScreen();
renderRatingLegends();
renderChanceCalculator();
renderChanceFormats();
setupPwa();
init();
setInterval(init, DATA_REFRESH_INTERVAL);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) init();
});
