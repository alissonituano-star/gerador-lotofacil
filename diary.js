const DIARY_FORMAT = "gerador-lotofacil-diario";
const STORAGE_KEY = "lotofacil-played-games-v1";

export function getPlayedGames() {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function setPlayedGames(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function gameKey(numbers) {
  return [...numbers].sort((a, b) => a - b).map((number) => String(number).padStart(2, "0")).join("-");
}

export function diaryEntryKey(entry) {
  return `${entry.targetContest}:${gameKey(entry.numbers)}`;
}

export function validNumbers(numbers, minSize = 15, maxSize = 20) {
  return Array.isArray(numbers) && numbers.length >= minSize && numbers.length <= maxSize
    && numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= 25)
    && new Set(numbers).size === numbers.length;
}

export function mergeDiary(entries, additions) {
  const existing = new Set(entries.map(diaryEntryKey));
  const added = [];
  for (const entry of additions) {
    const identity = diaryEntryKey(entry);
    if (existing.has(identity)) continue;
    existing.add(identity);
    added.push(entry);
  }
  return [...added, ...entries].sort((a, b) => b.targetContest - a.targetContest
    || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function encodeDiary(entries) {
  return JSON.stringify({ format: DIARY_FORMAT, version: 1, entries }, null, 2);
}

export function decodeDiary(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== DIARY_FORMAT || backup.version !== 1 || !Array.isArray(backup.entries)) {
    throw new Error("Arquivo de backup inválido.");
  }

  return backup.entries.map((entry) => {
    if (!validNumbers(entry?.numbers) || !Number.isSafeInteger(entry.targetContest) || entry.targetContest < 1
        || !Number.isFinite(Date.parse(entry.createdAt))) {
      throw new Error("O backup contém um jogo inválido.");
    }

    const numbers = [...entry.numbers].sort((a, b) => a - b);
    const modes = ["daily", "manual", "diversified", "closure20"];
    const strategies = ["daily", "manual", "balanced", "hot", "overdue", "mixed"];
    return {
      key: gameKey(numbers), numbers, targetContest: entry.targetContest,
      createdAt: new Date(entry.createdAt).toISOString(),
      mode: modes.includes(entry.mode) ? entry.mode : "manual",
      strategy: strategies.includes(entry.strategy) ? entry.strategy : "manual",
      score: Number.isFinite(entry.score) ? entry.score : null,
      cost: Number.isFinite(entry.cost) && entry.cost >= 0 ? entry.cost : null,
    };
  });
}
