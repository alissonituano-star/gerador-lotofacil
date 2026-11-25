import { DRAW_SIZE, TOTAL_NUMBERS } from "./lottery-math.js?v=13";

const RESULTS_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
const REQUEST_TIMEOUT = 8_000;
const REQUEST_BATCH = 4;
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });

async function readDraw(expected) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const url = expected ? `${RESULTS_URL}/${expected}` : RESULTS_URL;
    const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: controller.signal });
    if (!response.ok) throw new Error(`A Caixa retornou HTTP ${response.status}.`);
    const { numero: contest, dataApuracao: date, listaDezenas: numbers } = await response.json();
    const parts = typeof date === "string" && date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = parts && `${parts[3]}-${parts[2]}-${parts[1]}`;
    const dateValue = new Date(`${iso}T00:00:00Z`);
    if (!Number.isSafeInteger(contest) || contest < 1 || (expected && contest !== expected)
        || !parts || !Number.isFinite(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== iso
        || !Array.isArray(numbers) || numbers.length !== DRAW_SIZE
        || numbers.some((value) => (typeof value !== "string" && typeof value !== "number")
          || !/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > TOTAL_NUMBERS)) {
      throw new Error("A Caixa ainda não publicou um resultado completo para este concurso.");
    }
    const sorted = numbers.map(Number).sort((a, b) => a - b);
    if (new Set(sorted).size !== DRAW_SIZE) throw new Error("A Caixa retornou dezenas repetidas.");
    const day = weekday.format(dateValue);
    return { contest, date, numbers: sorted, weekday: day[0].toUpperCase() + day.slice(1) };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCaixaDraws(afterContest) {
  const latest = await readDraw();
  const draws = [latest];
  for (let contest = latest.contest - 1; contest > afterContest; contest -= REQUEST_BATCH) {
    const size = Math.min(REQUEST_BATCH, contest - afterContest);
    const batch = Array.from({ length: size }, (_, index) => readDraw(contest - index));
    draws.push(...await Promise.all(batch));
  }
  return draws;
}

export function mergeCaixaDraws(data, draws, updatedAt) {
  if (!draws.length || draws[0].contest < data.latest_contest) return data;
  const missing = draws[0].contest - data.latest_contest;
  if (missing && draws[missing - 1]?.contest !== data.latest_contest + 1) return data;
  const byContest = new Map(draws.map((draw) => [draw.contest, draw]));
  const changed = missing || data.results.some((saved) => {
    const draw = byContest.get(saved.contest);
    return draw && (saved.date !== draw.date || draw.numbers.some((number, index) => number !== saved.numbers[index]));
  });
  if (!changed) return data;
  const results = [...draws.slice(0, missing), ...data.results.map((draw) => byContest.get(draw.contest) ?? draw)];
  return { ...data, results, source: RESULTS_URL, latest_contest: draws[0].contest,
    total_contests: results.length, updated_at: updatedAt };
}
