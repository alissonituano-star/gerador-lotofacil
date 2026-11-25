import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_URL = "https://lotorama.com.br/lotofacil/todos-os-resultados/";
const CSV_URL = "https://lotorama.com.br/wp-content/uploads/loterias-pro/lotofacil-download-resultados.csv";
const CAIXA_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
const OUTPUT = resolve(import.meta.dirname, "../data/lotofacil.json");
const weekdayFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });

function parseContest(contestText, date, digits) {
  const contest = Number(contestText);
  const numbers = digits.map(Number).sort((a, b) => a - b);
  const dateParts = date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const drawDate = dateParts ? new Date(`${dateParts[3]}-${dateParts[2]}-${dateParts[1]}T00:00:00Z`) : null;

  if (!/^\d+$/.test(contestText) || !Number.isSafeInteger(contest) || contest < 1 ||
      !drawDate || Number.isNaN(drawDate.getTime()) || drawDate.getUTCDate() !== Number(dateParts[1]) ||
      digits.length !== 15 || !digits.every((digit) => /^\d{1,2}$/.test(digit)) ||
      numbers[0] < 1 || numbers.at(-1) > 25 || new Set(numbers).size !== 15) {
    throw new Error(`Resultado inválido para o concurso ${contestText}.`);
  }

  const weekday = weekdayFormat.format(drawDate);
  return { contest, weekday: weekday[0].toUpperCase() + weekday.slice(1), date, numbers };
}

function parseResults(csv) {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  if (header.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() !== "concurso,data,numeros") {
    throw new Error("O arquivo de resultados do Lotorama mudou de formato.");
  }

  const results = rows.filter((row) => row.trim()).map((row) => {
    const [contestText, date, ...digits] = row.trim().split(",");
    return parseContest(contestText, date, digits);
  }).sort((a, b) => b.contest - a.contest);

  if (!results.length || results.some(({ contest }, index) => contest !== results.length - index)) {
    throw new Error("O histórico do Lotorama está incompleto ou contém concursos duplicados.");
  }

  return results;
}

function parsePage(html) {
  const cards = /<div class="resultado-card">([\s\S]*?)(?=<div class="resultado-card">|<div class="pagination|<footer|$)/g;
  const results = [...html.matchAll(cards)].map(([, card]) => {
    const heading = card.replace(/<[^>]+>/g, " ").match(/Concurso\s+(\d+)\s+-\s+[^\d]+(\d{2}\/\d{2}\/\d{4})/);
    if (!heading) throw new Error("Não consegui ler o concurso na página do Lotorama.");
    const digits = [...card.matchAll(/result-number[^>]*>\s*(\d{1,2})\s*</g)].map(([, digit]) => digit);
    return parseContest(heading[1], heading[2], digits);
  });
  if (!results.length) throw new Error("Nenhum concurso encontrado na página do Lotorama.");
  return results;
}

async function fetchResults(url) {
  const response = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} retornou HTTP ${response.status}.`);
  return response.text();
}

async function readCurrent() {
  try {
    const current = JSON.parse(await readFile(OUTPUT, "utf8"));
    return Array.isArray(current?.results) ? current : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readLotoramaResults(current) {
  const html = await fetchResults(SOURCE_URL);
  const recent = parsePage(html);
  const latest = Math.max(...recent.map(({ contest }) => contest));
  if (current?.latest_contest > latest) {
    throw new Error("O Lotorama retornou um histórico mais antigo que a base salva.");
  }

  const byContest = new Map();
  const addResults = (entries) => {
    for (const entry of entries) {
      if (!byContest.has(entry.contest)) byContest.set(entry.contest, entry);
    }
  };
  addResults(current?.results ?? []);
  addResults(recent);

  if (byContest.size < latest) {
    addResults(parseResults(await fetchResults(CSV_URL)));
  }
  const totalPages = Number(html.match(/P(?:á|&aacute;)gina\s+\d+\s+de\s+(\d+)/i)?.[1] ?? 1);
  for (let page = 2; page <= totalPages && byContest.size < latest; page += 1) {
    addResults(parsePage(await fetchResults(`${SOURCE_URL}?paged=${page}`)));
  }

  const results = [...byContest.values()].sort((a, b) => b.contest - a.contest);
  if (results.length !== latest || results.some(({ contest }, index) => contest !== latest - index)) {
    throw new Error(`O histórico retornado está incompleto. Esperados os concursos 1 a ${latest}.`);
  }
  return results;
}

async function readCaixaContest(url) {
  const { numero, dataApuracao, listaDezenas } = JSON.parse(await fetchResults(url));
  return parseContest(String(numero), dataApuracao, listaDezenas ?? []);
}

async function readCaixaResults(current) {
  if (!current?.results.length) throw new Error("A base histórica é necessária para a atualização pela Caixa.");

  const latest = await readCaixaContest(CAIXA_URL);
  if (current.latest_contest > latest.contest) throw new Error("A Caixa retornou um histórico mais antigo que a base salva.");

  const byContest = new Map(current.results.map((entry) => [entry.contest, entry]));
  byContest.set(latest.contest, latest);
  const results = [];
  for (let contest = latest.contest; contest >= 1; contest -= 1) {
    const entry = byContest.get(contest) ?? await readCaixaContest(`${CAIXA_URL}/${contest}`);
    if (entry.contest !== contest) throw new Error(`A Caixa retornou um resultado diferente do concurso ${contest}.`);
    results.push(entry);
  }
  return results;
}

async function syncResults() {
  const current = await readCurrent();
  let source = SOURCE_URL;
  let results;
  if (!current?.results.length) {
    results = await readLotoramaResults(current);
  } else {
    try {
      results = await readCaixaResults(current);
      source = CAIXA_URL;
      console.log(`Resultados confirmados pela Caixa até o concurso ${results[0].contest}.`);
    } catch (error) {
      console.warn(`Consulta à Caixa indisponível: ${error.message} Consultando o Lotorama.`);
      results = await readLotoramaResults(current);
    }
  }

  if (current && JSON.stringify(current.results) === JSON.stringify(results)) {
    return current;
  }

  const payload = {
    source,
    updated_at: new Date().toISOString(),
    total_contests: results.length,
    latest_contest: results[0].contest,
    oldest_contest: results.at(-1).contest,
    results,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  const temporaryFile = `${OUTPUT}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temporaryFile, OUTPUT);
  } finally {
    await rm(temporaryFile, { force: true });
  }
  return payload;
}

let activeUpdate;

export function update() {
  activeUpdate ??= syncResults().finally(() => {
    activeUpdate = undefined;
  });
  return activeUpdate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const payload = await update();
    console.log(`OK: ${payload.total_contests} concursos salvos (${payload.oldest_contest} a ${payload.latest_contest}).`);
  } catch (error) {
    console.error(`Erro ao atualizar resultados: ${error.message}`);
    process.exitCode = 1;
  }
}
