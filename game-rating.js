const POPULATION_SIZE = 25;
const DRAW_SIZE = 15;
export const RATING_WINDOW = 120;
const PRIOR_DRAWS = 30;

const CRITERIA = [
  { name: "Soma das dezenas", weight: 30, mean: 13, variance: 52 },
  { name: "Dezenas ímpares", weight: 25, mean: 13 / 25, variance: (13 / 25) * (12 / 25) },
  { name: "Dezenas de 01 a 13", weight: 20, mean: 13 / 25, variance: (13 / 25) * (12 / 25) },
  { name: "Repetidas do sorteio anterior", weight: 25, mean: 15 / 25, variance: (15 / 25) * (10 / 25) },
];

export const RATING_LEVELS = [
  { minimum: 85, range: "85–100", label: "Bem equilibrado", tone: "balanced" },
  { minimum: 65, range: "65–84", label: "Aceitável", tone: "acceptable" },
  { minimum: 0, range: "0–64", label: "Fora do padrão", tone: "unusual" },
];

function varianceFactor(size) {
  return size * (POPULATION_SIZE - size) / (POPULATION_SIZE - 1);
}

function measure(numbers, previousDraw) {
  return [
    numbers.reduce((sum, number) => sum + number, 0),
    numbers.filter((number) => number % 2 === 1).length,
    numbers.filter((number) => number <= 13).length,
    previousDraw ? numbers.filter((number) => previousDraw.includes(number)).length : null,
  ];
}

export function buildRatingProfile(draws, contest) {
  const start = draws.findIndex((draw) => draw.contest < contest);
  const observations = start < 0 ? [] : draws.slice(start, start + RATING_WINDOW)
    .map((draw, index) => {
      const previous = draws[start + index + 1];
      return measure(draw.numbers, previous?.contest === draw.contest - 1 ? previous.numbers : null);
    });
  const previous = draws[start];

  const criteria = CRITERIA.map((criterion, index) => {
    const expected = criterion.mean * DRAW_SIZE;
    const variance = criterion.variance * varianceFactor(DRAW_SIZE);
    let weight = PRIOR_DRAWS;
    let sum = weight * expected;
    let sumSquares = weight * (variance + expected ** 2);
    for (const row of observations) {
      const value = row[index];
      if (value === null) continue;
      weight += 1;
      sum += value;
      sumSquares += value ** 2;
    }
    const mean = sum / weight;
    return { ...criterion, center: mean, variance: sumSquares / weight - mean ** 2 };
  });

  return { criteria, previousDraw: previous?.contest === contest - 1 ? previous.numbers : null };
}

export function rateGame(numbers, profile) {
  const measures = measure(numbers, profile.previousDraw);
  const size = numbers.length;
  const spreadScale = Math.sqrt(varianceFactor(size) / varianceFactor(DRAW_SIZE));
  let maximum = 0;
  let total = 0;
  const criteria = profile.criteria.map((criterion, index) => {
    const value = measures[index];
    if (value === null) return { name: criterion.name, value, points: null };

    const center = criterion.center * size / DRAW_SIZE;
    const spread = Math.sqrt(criterion.variance) * spreadScale;
    const distance = Math.abs(value - center) / spread;
    // Full points within one standard deviation, tapering to zero at 2.5.
    const fraction = Math.min(1, Math.max(0, (2.5 - distance) / 1.5));
    const points = fraction * criterion.weight;
    maximum += criterion.weight;
    total += points;
    return { name: criterion.name, value, points, weight: criterion.weight };
  });

  const score = Math.round(100 * total / maximum);
  const level = RATING_LEVELS.find(({ minimum }) => score >= minimum);
  return { score, level, criteria };
}
