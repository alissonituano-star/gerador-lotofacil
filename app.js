import { createDailyGame, testDailyGame } from "./daily-model.js";
import { decodeDiary, encodeDiary, gameKey, getPlayedGames, mergeDiary, setPlayedGames, validNumbers } from "./diary.js";

const NUMBERS = Array.from({ length: 25 }, (_, index) => index + 1);
const DATA_REFRESH_INTERVAL = 60_000;
const HISTORICAL_SIMILARITY_WINDOW = 500;
const BACKTEST_RECENT_WINDOW = 120;
const state = {
  data: null,
  analysis: null,
  games: [],
  daily: null,
  benchmarkBase: null,
  historyLimit: 12,
  manualDefaultContest: null,
  installPrompt: null,
};

const $ = (selector) => document.querySelector(selector);
const installButtons = () => [$("#installApp"), $("#installAppMobile")].filter(Boolean);

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

function combinationCount(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = result * (n - index + 1) / index;
  }
  return Math.round(result);
}

function estimatedGameCost(size) {
  return combinationCount(size, 15) * 3.5;
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
    state.games = [{ numbers: state.daily.numbers }];
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
  $("#generate").hidden = isDaily;
  $("#gameHeading").textContent = isDaily ? "Jogo do dia" : "Jogos sugeridos";
  $("#gameContest").textContent = `Concurso ${nextContest()}`;
  $("#savePlayed").disabled = !state.games.length || Boolean(state.daily?.registered);
  $("#savePlayed").textContent = state.daily?.registered ? "Jogo registrado" : "Registrar jogo";
  $("#dailyDetails").hidden = !isDaily;
  $("#coverage").hidden = isDaily;
  $("#fairChance").hidden = !isDaily;
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
  const notes = {
    daily: "Uma combinação de 15 dezenas por concurso. Registre o jogo que realmente fez para personalizar a próxima sugestão.",
    diversified: "Modo diversificar: reduz repeticao entre jogos para cobrir mais combinacoes possiveis.",
    closure20: "Modo base 20: monta jogos amarrados dentro de uma base forte de 20 dezenas.",
  };
  const budgetNote = budget > 0 && estimated > budget
    ? ` Custo estimado: R$ ${estimated.toFixed(2).replace(".", ",")}, acima do limite informado.`
    : ` Custo estimado: R$ ${estimated.toFixed(2).replace(".", ",")}.`;
  $("#strategyNote").textContent = `${notes[mode]}${budgetNote}`;
}

function renderSummary() {
  const data = state.data;
  const results = state.analysis.sorted;
  $("#metricContests").textContent = data.total_contests || results.length;
  $("#metricLatest").textContent = data.latest_contest || results[0].contest;
  $("#metricAvgSum").textContent = Math.round(state.analysis.avgSum);
  $("#metricRange").innerHTML = `<b>${results.at(-1).date}</b><em>ate</em><b>${results[0].date}</b>`;
  $("#metricUpdated").textContent = `Atualizado em: ${formatUpdatedAt(data.updated_at)}`;
  $("#updateMode").textContent = isLocalServer()
    ? "Neste modo, o botao Atualizar baixa os resultados agora."
    : "Online: use npm run sync no computador para atualizar e enviar ao GitHub.";
  $("#status").textContent = `Base: ${results.length} concursos. Atualizado: ${formatUpdatedAt(data.updated_at)}`;
}

function renderRanking() {
  $("#numberRanking").innerHTML = state.analysis.ranking.map((item) => `
    <article class="number-card">
      <div class="number-card-header">
        <span class="ball">${formatNumber(item.number)}</span>
        <strong>${(item.percentage * 100).toFixed(1)}%</strong>
      </div>
      <div class="stat-row"><span>Historico</span><b>${item.frequency} vezes</b></div>
      <div class="stat-row"><span>Janela recente</span><b>${item.recentFrequency} vezes</b></div>
      <div class="stat-row"><span>Atraso atual</span><b>${item.delay} concursos</b></div>
    </article>
  `).join("");
}

function renderPairs() {
  $("#pairRanking").innerHTML = state.analysis.pairs.map((pair) => `
    <div class="pair">
      <span>${pair.numbers.map(formatNumber).join(" + ")}</span>
      <small>${pair.count} vezes</small>
    </div>
  `).join("");
}

const formatPercent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const formatSmallPercent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 4 });
const formatPoints = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function renderDailyGame(game) {
  const personal = game.previousCount
    ? `Usa seus ${game.previousCount} registros mais recentes. ${game.playedRepeat} dezenas em comum com seu último jogo.`
    : "O diário ainda não tem jogos anteriores para personalizar a sugestão.";
  $("#games").innerHTML = `
    <article class="game">
      <div class="game-title">${game.registered ? "Jogo registrado" : "15 dezenas sugeridas"}</div>
      <div class="numbers">${game.numbers.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
      <div class="game-explain">
        <p class="helper">${game.drawnRepeat} dezenas do último sorteio. No histórico, dois sorteios consecutivos repetem ${formatPoints.format(game.averageRepeat)} dezenas em média.</p>
        <p class="helper">${personal}</p>
      </div>
    </article>
  `;
  $("#dailyFrequencies").innerHTML = `
    <p class="helper">O cálculo suaviza oscilações das janelas recentes, compara pares com a frequência das dezenas e reduz a repetição dos seus jogos anteriores.</p>
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
  if (!state.daily || !$("#dailyBenchmark").open || state.benchmarkBase === state.data) return;
  const test = testDailyGame(state.analysis.sorted);
  state.benchmarkBase = state.data;
  if (!test) {
    $("#dailyBenchmarkResult").textContent = "A base ainda não tem concursos suficientes para a simulação.";
    return;
  }
  $("#dailyBenchmarkResult").innerHTML = `
    <p class="helper">${test.sampleSize} concursos, do ${test.firstContest} ao ${test.lastContest}. Cada jogo foi escolhido usando só resultados anteriores e os jogos já simulados até aquele ponto.</p>
    <p class="helper">Média simulada de <strong>${formatPoints.format(test.mean)}</strong> acertos. Para jogos de 15 dezenas em sorteios justos, a média esperada é ${formatPoints.format(test.fairMean)} e a faixa aproximada de 95% para uma amostra deste tamanho vai de ${formatPoints.format(test.lowerFairMean)} a ${formatPoints.format(test.upperFairMean)}.</p>
    <table class="comparison-table">
      <thead><tr><th scope="col">Acertos</th><th scope="col">Simulação</th><th scope="col">Referência aleatória</th></tr></thead>
      <tbody>${test.rows.map(({ score, observed, expected }) => `
        <tr><th scope="row">${score === 15 ? "15" : `${score}+`}</th>
        <td>${observed}/${test.sampleSize} (${formatPercent.format(observed / test.sampleSize)})</td>
        <td>${score === 15 ? "1 em 3.268.760" : (score === 14 ? formatSmallPercent : formatPercent).format(expected)}</td></tr>
      `).join("")}</tbody>
    </table>
    <p class="helper">A simulação mede o desempenho passado. Use a referência aleatória para interpretar as diferenças observadas.</p>
  `;
}

function renderGames() {
  $("#games").innerHTML = state.games.map((game) => `
    <article class="game">
      <div class="game-title">
        Jogo ${game.index}
        <span class="game-meta">${game.numbers.length} numeros</span>
      </div>
      <div class="numbers">${game.numbers.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
      <div class="game-score">
        <strong>Nota estatistica: ${game.score.toFixed(2)}</strong>
        <span>${describeGame(game.numbers)}</span>
        <small>${gameIssues(game.numbers, state.analysis).length ? `Alertas: ${gameIssues(game.numbers, state.analysis).join(", ")}` : "Sem alertas do filtro anti-jogo-fraco"}</small>
      </div>
      <div class="game-explain">
        <strong>Por que este jogo?</strong>
        <ul>${explainGame(game.numbers, state.analysis).map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
    </article>
  `).join("");
}

function describeGame(numbers) {
  const profile = gameProfile(numbers);
  return `Soma ${profile.sum} | ${profile.odd} impares/${profile.even} pares | ${profile.low} baixos/${profile.high} altos`;
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
    <div><strong>${maxOverlap}</strong><small>maior repeticao entre jogos</small></div>
    <div><strong>${avgOverlap.toFixed(1)}</strong><small>repeticao media</small></div>
    ${base ? `<div><strong>${base.map(formatNumber).join(" ")}</strong><small>base 20 usada</small></div>` : ""}
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
    <div><strong>${best}</strong><small>maior acerto nos ultimos ${sample.length}</small></div>
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
    <h3>Ranking de estrategias</h3>
    <div class="strategy-table">
      ${rows.map((row) => `
        <div>
          <strong>${row.label}</strong>
          <span>media ${row.avg.toFixed(2)} | melhor ${row.best}</span>
          <small>11+: ${row.buckets[11] + row.buckets[12] + row.buckets[13] + row.buckets[14] + row.buckets[15]} | 13+: ${row.buckets[13] + row.buckets[14] + row.buckets[15]} | 15: ${row.buckets[15]}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function nextContest() {
  return state.analysis.sorted[0].contest + 1;
}

function diaryEntry(numbers, targetContest, mode, strategy, score = null) {
  return {
    key: gameKey(numbers), numbers, targetContest, mode, strategy, score,
    cost: estimatedGameCost(numbers.length), createdAt: new Date().toISOString(),
  };
}

function renderDiaryChange() {
  if (!state.analysis) return;
  if (state.daily) generateGames();
  else renderHistory();
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
  const digits = $("#manualNumbers").value.trim().split(/[\s,;-]+/);
  const numbers = digits.map(Number).sort((a, b) => a - b);
  if (!Number.isSafeInteger(contest) || contest < 1 || contest > nextContest()) {
    showToast(`Informe um concurso entre 1 e ${nextContest()}.`);
    return;
  }
  if (!digits.every((digit) => /^\d{1,2}$/.test(digit)) || !validNumbers(numbers, 15, 15)) {
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
    return `
      <article class="history-item">
        <div>
          <strong>Concurso ${entry.targetContest}</strong>
          <small>${formatUpdatedAt(entry.createdAt)} · ${diaryModeLabel(entry.mode)}</small>
        </div>
        <div class="numbers">${entry.numbers.map((number) => `<span class="mini-ball">${formatNumber(number)}</span>`).join("")}</div>
        <div class="history-result">${hits === null ? "aguardando resultado" : `${hits} acertos`}</div>
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
  const totalCost = entries.reduce((total, entry) => total + (entry.cost ?? estimatedGameCost(entry.numbers.length)), 0);
  const bestHits = resolved.length ? Math.max(...resolved.map((entry) => entry.hits)) : "-";
  const avgHits = resolved.length ? average(resolved.map((entry) => entry.hits)).toFixed(2) : "-";
  const prizeRange = resolved.filter((entry) => entry.hits >= 11).length;

  container.innerHTML = `
    <div><strong>${entries.length}</strong><small>jogos registrados</small></div>
    <div><strong>R$ ${totalCost.toFixed(2).replace(".", ",")}</strong><small>gasto estimado</small></div>
    <div><strong>${bestHits}</strong><small>melhor acerto</small></div>
    <div><strong>${avgHits}</strong><small>media de acertos</small></div>
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
    .map((game) => `Jogo ${game.index}: ${game.numbers.map(formatNumber).join(" ")}`)
    .join("\n");
  await navigator.clipboard.writeText(text);
  $("#copyGames").textContent = "Copiado";
  showToast("Jogos copiados.");
  setTimeout(() => {
    $("#copyGames").textContent = "Copiar";
  }, 1500);
}

async function loadData() {
  const response = await fetch("data/lotofacil.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Nao foi possivel carregar data/lotofacil.json");
  const data = await response.json();
  if (state.data && data.updated_at <= state.data.updated_at) return;
  state.data = data;
  refreshAnalysis();
}

async function forceUpdate() {
  const button = $("#forceUpdate");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Atualizando...";

  try {
    const response = await fetch("/api/update", { method: "POST" });
    if (!response.ok) {
      throw new Error("Atualizacao direta indisponivel neste ambiente.");
    }
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message || "Nao foi possivel atualizar.");
    await loadData();
    showToast("Base atualizada agora.");
  } catch (error) {
    showToast("Para forcar no online, rode no computador: npm run sync");
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
  installButtons().forEach((button) => {
    button.hidden = !visible;
  });
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
    showToast("No iPhone, toque em Compartilhar e depois em Adicionar a Tela de Inicio.");
    return;
  }

  showToast("Se o botao de instalar nao aparecer, abra pelo Chrome e aguarde alguns segundos.");
}

function setupPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      showToast("Nao consegui ativar o modo offline agora.");
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
}

async function init() {
  try {
    await loadData();
  } catch (error) {
    if (!state.data) $("#status").textContent = error.message;
  }
}

$("#generate").addEventListener("click", generateGames);
$("#recentWindow").addEventListener("change", refreshAnalysis);
$("#strategy").addEventListener("change", generateGames);
$("#gameSize").addEventListener("change", generateGames);
$("#generationMode").addEventListener("change", generateGames);
$("#lastRepeatRange").addEventListener("change", generateGames);
$("#dailyBudget").addEventListener("change", updateStrategyNote);
$("#downloadCsv").addEventListener("click", downloadCsv);
$("#copyGames").addEventListener("click", copyGames);
$("#savePlayed").addEventListener("click", savePlayedGames);
$("#manualGame").addEventListener("submit", saveManualGame);
$("#dailyBenchmark").addEventListener("toggle", renderDailyBenchmark);
$("#exportDiary").addEventListener("click", exportDiary);
$("#importDiary").addEventListener("click", () => $("#diaryFile").click());
$("#diaryFile").addEventListener("change", importDiary);
$("#showMoreHistory").addEventListener("click", () => {
  state.historyLimit += 12;
  renderHistory();
});
$("#clearHistory").addEventListener("click", clearHistory);
$("#forceUpdate").addEventListener("click", forceUpdate);
installButtons().forEach((button) => button.addEventListener("click", installApp));

setupPwa();
init();
setInterval(init, DATA_REFRESH_INTERVAL);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) init();
});
