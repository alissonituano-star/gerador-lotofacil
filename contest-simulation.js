export function simulateHistoricalGame(numbers, draws, playedContests = null) {
  const picked = new Set(numbers);
  const hits = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  const best = [];
  let sampleSize = 0;

  for (const draw of draws) {
    if (playedContests && !playedContests.has(draw.contest)) continue;

    sampleSize += 1;
    let points = 0;
    for (const number of draw.numbers) {
      if (picked.has(number)) points += 1;
    }

    if (points >= 11) {
      hits[points] += 1;
      best.push({ contest: draw.contest, date: draw.date, points });
    }
  }

  best.sort((a, b) => b.points - a.points || b.contest - a.contest);
  return { sampleSize, hits, best: best.slice(0, 10) };
}
