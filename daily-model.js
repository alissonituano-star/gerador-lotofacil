import { combinationCount, DRAW_SIZE as GAME_SIZE, fixedSizeLogNormalizer, POSSIBLE_GAMES, TOTAL_NUMBERS } from "./lottery-math.js?v=13";

const SHORT_WINDOW = 30;
const RECENT_WINDOW = 120;
const DIARY_WINDOW = 12;
const CANDIDATE_COUNT = 160;
export const FORECAST_START_CONTEST = 3836;
const FORECAST_EVIDENCE_THRESHOLD = Math.log(20);
const FAIR_FREQUENCY = GAME_SIZE / TOTAL_NUMBERS;
const PAIR_COUNT = GAME_SIZE * (GAME_SIZE - 1) / 2;
const PAIR_CORRECTION = (GAME_SIZE - 1) / GAME_SIZE * TOTAL_NUMBERS / (TOTAL_NUMBERS - 1);
const STRIDE = TOTAL_NUMBERS + 1;
const NUMBERS = Array.from({ length: TOTAL_NUMBERS }, (_, index) => index + 1);

function pairIndex(first, second) {
  return Math.min(first, second) * STRIDE + Math.max(first, second);
}

function summarizeDraws(draws, start = 0) {
  const totals = { frequency: new Uint32Array(STRIDE), pairs: new Uint32Array(STRIDE ** 2), repeats: 0 };
  for (let index = start; index < draws.length; index += 1) {
    addDraw(totals, draws[index].numbers, draws[index + 1]?.numbers);
  }
  return totals;
}

function addDraw(totals, numbers, previous) {
  numbers.forEach((number, index) => {
    totals.frequency[number] += 1;
    for (let other = index + 1; other < numbers.length; other += 1) {
      totals.pairs[pairIndex(number, numbers[other])] += 1;
    }
    if (previous?.includes(number)) totals.repeats += 1;
  });
}

function buildModel(draws, start, totals) {
  const count = draws.length - start;
  const shortCount = Math.min(SHORT_WINDOW, count);
  const recentCount = Math.min(RECENT_WINDOW, count);
  const short = new Uint32Array(STRIDE);
  const recent = new Uint32Array(STRIDE);
  for (let offset = 0; offset < recentCount; offset += 1) {
    for (const number of draws[start + offset].numbers) {
      recent[number] += 1;
      if (offset < shortCount) short[number] += 1;
    }
  }

  const historical = new Float64Array(STRIDE);
  const signal = new Float64Array(STRIDE);
  for (const number of NUMBERS) {
    historical[number] = (totals.frequency[number] + 30 * FAIR_FREQUENCY) / (count + 30);
    // Compare the latest draws with the older period, shrinking short samples toward that baseline.
    const older = (totals.frequency[number] - recent[number] + 30 * FAIR_FREQUENCY) / (count - recentCount + 30);
    const medium = (recent[number] + 60 * older) / (recentCount + 60);
    const near = (short[number] + 60 * medium) / (shortCount + 60);
    signal[number] = 0.25 * (historical[number] - FAIR_FREQUENCY)
      + 0.45 * (medium - older) + 0.30 * (near - older);
  }

  const pairSignal = new Float64Array(STRIDE ** 2);
  for (const first of NUMBERS) {
    for (let second = first + 1; second <= TOTAL_NUMBERS; second += 1) {
      const index = pairIndex(first, second);
      const expected = historical[first] * historical[second] * PAIR_CORRECTION;
      pairSignal[index] = (totals.pairs[index] - count * expected) / (count + 150);
    }
  }
  return {
    count, shortCount, recentCount, short, recent, frequency: totals.frequency, signal, pairSignal,
    latest: new Set(draws[start]?.numbers),
    averageRepeat: count > 1 ? totals.repeats / (count - 1) : GAME_SIZE * FAIR_FREQUENCY,
  };
}

function contestRandom(contest) {
  let seed = ((contest ^ 0xc31d9b65) >>> 0) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
}

function sampleNumbers(random) {
  const numbers = [...NUMBERS];
  for (let index = 0; index < GAME_SIZE; index += 1) {
    const other = index + Math.floor(random() * (TOTAL_NUMBERS - index));
    [numbers[index], numbers[other]] = [numbers[other], numbers[index]];
  }
  return numbers.slice(0, GAME_SIZE).sort((a, b) => a - b);
}

function forecastWeight(numbers, weights) {
  return numbers.reduce((total, number) => total + weights[number - 1], 0);
}

function selectGame(model, contest, diary, forecast = null) {
  const previous = diary.filter((entry) => entry.targetContest < contest)
    .sort((a, b) => b.targetContest - a.targetContest || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const recent = previous.slice(0, DIARY_WINDOW);
  const used = new Set(previous.filter((entry) => entry.numbers.length === GAME_SIZE)
    .map((entry) => [...entry.numbers].sort((a, b) => a - b).join(",")));
  const usage = new Uint32Array(STRIDE);
  for (const entry of recent) {
    for (const number of entry.numbers) usage[number] += 1;
  }
  const lastPlayed = new Set(recent[0]?.numbers);
  const random = contestRandom(contest);
  let best;
  if (forecast) {
    const ranked = [...NUMBERS].sort((first, second) => forecast[second - 1] - forecast[first - 1]);
    const top = ranked.slice(0, GAME_SIZE).sort((a, b) => a - b);
    if (!used.has(top.join(","))) return { numbers: top, previousCount: recent.length, lastPlayed };
    // If the most likely set was already played, compare all one-number swaps and the sampled alternatives.
    for (const replacement of ranked.slice(GAME_SIZE)) {
      for (const number of top) {
        const numbers = top.map((value) => value === number ? replacement : value).sort((a, b) => a - b);
        if (used.has(numbers.join(","))) continue;
        const score = forecastWeight(numbers, forecast);
        if (!best || score > best.score) best = { numbers, score };
      }
    }
  }
  for (let attempt = 0; attempt < CANDIDATE_COUNT; attempt += 1) {
    const numbers = sampleNumbers(random);
    if (used.has(numbers.join(","))) continue;
    if (forecast) {
      const score = forecastWeight(numbers, forecast);
      if (!best || score > best.score) best = { numbers, score };
      continue;
    }
    let total = 0;
    let pairTotal = 0;
    let drawnRepeat = 0;
    let playedRepeat = 0;
    numbers.forEach((number, index) => {
      total += model.signal[number] - 0.024 * usage[number] / Math.max(recent.length, 1);
      if (model.latest.has(number)) drawnRepeat += 1;
      if (lastPlayed.has(number)) playedRepeat += 1;
      for (let other = index + 1; other < numbers.length; other += 1) {
        pairTotal += model.pairSignal[pairIndex(number, numbers[other])];
      }
    });
    const score = total / GAME_SIZE + 0.35 * pairTotal / PAIR_COUNT
      - 0.001 * (drawnRepeat - model.averageRepeat) ** 2
      - 0.002 * Math.max(playedRepeat - 9, 0) ** 2;
    if (!best || score > best.score) best = { numbers, score };
  }
  let numbers = best?.numbers;
  if (!numbers) {
    do {
      numbers = sampleNumbers(random);
    } while (used.size < POSSIBLE_GAMES && used.has(numbers.join(",")));
  }
  return { numbers, previousCount: recent.length, lastPlayed };
}

export function createDailyGame(draws, diary) {
  const contest = draws[0].contest + 1;
  const model = buildModel(draws, 0, summarizeDraws(draws));
  const registered = diary.find((entry) => entry.targetContest === contest && entry.numbers.length === GAME_SIZE);
  const forecastEnabled = forwardForecastTest(draws).supported;
  const forecast = forecastEnabled ? forecastLogWeights(model) : null;
  const { numbers: suggested, previousCount, lastPlayed } = selectGame(model, contest, diary, forecast);
  const numbers = registered?.numbers ?? suggested;
  return {
    contest, registered: Boolean(registered), numbers, previousCount, forecastEnabled,
    recentDraws: model.recentCount,
    shortDraws: model.shortCount,
    historicalDraws: model.count,
    drawnRepeat: numbers.filter((number) => model.latest.has(number)).length,
    playedRepeat: recentOverlap(numbers, lastPlayed),
    averageRepeat: model.averageRepeat,
    frequencies: numbers.map((number) => ({
      number, full: model.frequency[number] / model.count,
      recent: model.recent[number] / model.recentCount,
      short: model.short[number] / model.shortCount,
    })),
  };
}

function recentOverlap(numbers, played) {
  return played.size ? numbers.filter((number) => played.has(number)).length : null;
}

function forecastLogWeights(model) {
  return NUMBERS.map((number) => {
    const probability = Math.min(0.99, Math.max(0.01, FAIR_FREQUENCY + model.signal[number]));
    return Math.log(probability / (1 - probability));
  });
}

function evaluateForecast(draws, start, count) {
  const sampleSize = Math.max(0, Math.min(count, draws.length - start - RECENT_WINDOW));
  if (!sampleSize) return { sampleSize: 0, logEvidence: 0, ratio: 1 };

  const end = start + sampleSize;
  const totals = summarizeDraws(draws, end);
  const uniformLogProbability = -Math.log(POSSIBLE_GAMES);
  let logEvidence = 0;
  for (let index = end - 1; index >= start; index -= 1) {
    const weights = forecastLogWeights(buildModel(draws, index + 1, totals));
    const logProbability = forecastWeight(draws[index].numbers, weights) - fixedSizeLogNormalizer(weights, GAME_SIZE);
    logEvidence += logProbability - uniformLogProbability;
    addDraw(totals, draws[index].numbers, draws[index + 1]?.numbers);
  }
  return {
    sampleSize, logEvidence, ratio: Math.exp(logEvidence / sampleSize),
    firstContest: draws[end - 1].contest, lastContest: draws[start].contest,
  };
}

const forwardTests = new WeakMap();

function forwardForecastTest(draws) {
  if (forwardTests.has(draws)) return forwardTests.get(draws);
  const start = draws.findIndex((draw) => draw.contest < FORECAST_START_CONTEST);
  const test = evaluateForecast(draws, 0, start < 0 ? draws.length : start);
  // The product of likelihood ratios is tracked only on draws after the fixed launch cutoff.
  const result = { ...test, supported: test.logEvidence >= FORECAST_EVIDENCE_THRESHOLD };
  forwardTests.set(draws, result);
  return result;
}

export function auditDailyForecast(draws) {
  const start = draws.findIndex((draw) => draw.contest < FORECAST_START_CONTEST);
  const historical = start < 0 ? null : evaluateForecast(draws, start, 240);
  return { historical, forward: forwardForecastTest(draws) };
}

export function fairHitProbability(minimum) {
  let total = 0;
  for (let hits = minimum; hits <= GAME_SIZE; hits += 1) {
    total += combinationCount(GAME_SIZE, hits) * combinationCount(TOTAL_NUMBERS - GAME_SIZE, GAME_SIZE - hits);
  }
  return total / POSSIBLE_GAMES;
}

export function testDailyGame(draws, maxTests = 120) {
  const sampleSize = Math.min(maxTests, draws.length - RECENT_WINDOW - DIARY_WINDOW);
  if (sampleSize < 1) return null;
  const maxIndex = sampleSize + DIARY_WINDOW - 1;
  const totals = summarizeDraws(draws, maxIndex + 1);
  const diary = [];
  const hits = new Uint32Array(GAME_SIZE + 1);
  for (let index = maxIndex; index >= 0; index -= 1) {
    const draw = draws[index];
    const model = buildModel(draws, index + 1, totals);
    const { numbers } = selectGame(model, draw.contest, diary);
    if (index < sampleSize) {
      hits[numbers.filter((number) => draw.numbers.includes(number)).length] += 1;
    }
    diary.unshift({ numbers, targetContest: draw.contest });
    addDraw(totals, draw.numbers, draws[index + 1]?.numbers);
  }
  const mean = hits.reduce((sum, count, score) => sum + count * score, 0) / sampleSize;
  const fairMean = GAME_SIZE * FAIR_FREQUENCY;
  const fairVariance = GAME_SIZE * FAIR_FREQUENCY * (1 - FAIR_FREQUENCY)
    * (TOTAL_NUMBERS - GAME_SIZE) / (TOTAL_NUMBERS - 1);
  const margin = 1.96 * Math.sqrt(fairVariance / sampleSize);
  return {
    sampleSize,
    firstContest: draws[sampleSize - 1].contest,
    lastContest: draws[0].contest,
    mean,
    fairMean,
    lowerFairMean: fairMean - margin,
    upperFairMean: fairMean + margin,
    rows: [11, 12, 13, 14, 15].map((score) => ({
      score,
      observed: hits.slice(score).reduce((sum, count) => sum + count, 0),
      expected: fairHitProbability(score),
    })),
  };
}
