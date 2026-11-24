export function compareContest(contest, draw, diary) {
  const drawnNumbers = draw ? new Set(draw.numbers) : null;
  const plays = diary.filter((entry) => entry.targetContest === contest).map((entry) => {
    const picked = new Set(entry.numbers);
    return {
      entry,
      hits: drawnNumbers ? entry.numbers.filter((number) => drawnNumbers.has(number)) : null,
      missing: draw ? draw.numbers.filter((number) => !picked.has(number)) : null,
    };
  });

  return { draw: draw ?? null, plays };
}
