export const TOTAL_NUMBERS = 25;
export const DRAW_SIZE = 15;
export const SIMPLE_GAME_CENTS = 350;

export function combinationCount(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - index + 1) / index;
  return Math.round(result);
}

export const POSSIBLE_GAMES = combinationCount(TOTAL_NUMBERS, DRAW_SIZE);

export function coverageForBudget(budgetCents, contests) {
  const combinations = Math.min(POSSIBLE_GAMES, Math.floor(budgetCents / SIMPLE_GAME_CENTS));
  const perContest = combinations / POSSIBLE_GAMES;
  return {
    combinations,
    perContest,
    overall: perContest === 1 ? 1 : -Math.expm1(contests * Math.log1p(-perContest)),
    totalCents: combinations * SIMPLE_GAME_CENTS * contests,
  };
}

export function fixedSizeLogNormalizer(logWeights, size) {
  // The coefficient of x^size in the product of (1 + weight * x) sums all distinct games.
  const sums = new Float64Array(size + 1);
  sums[0] = 1;
  for (const logWeight of logWeights) {
    const weight = Math.exp(logWeight);
    for (let count = size; count > 0; count -= 1) {
      sums[count] += weight * sums[count - 1];
    }
  }
  return Math.log(sums[size]);
}
