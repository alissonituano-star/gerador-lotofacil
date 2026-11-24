import { fetchContestPayouts } from "./contest-payout.js?v=16";
import { buildDiaryReport, moveReportDate, reportPeriod } from "./diary-report.js?v=16";
import { diaryEntryKey, getPlayedGames, setPlayedGames } from "./diary.js?v=16";
import { copyNumbersButton } from "./field-actions.js?v=17";

const ROWS_PER_PAGE = 30;
const REQUEST_BATCH = 4;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");
const saoPauloDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
const $ = (id) => document.getElementById(id);

function today() {
  const parts = Object.fromEntries(saoPauloDate.formatToParts().map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDate(iso) {
  return iso.split("-").reverse().join("/");
}

function money(cents) {
  return cents === null ? "–" : currency.format(cents / 100);
}

function metric(value, label) {
  return `<div><strong>${value}</strong><small>${label}</small></div>`;
}

function renderTotals({ totals, hitCounts }, fetchingCount) {
  const { games, spentCents, prizeCents, confirmedPrizeCents, officialPrizeCents, unconfirmedSpend,
    unavailableSpend, unknownPrize, pendingGames, winningGames } = totals;
  const net = prizeCents - spentCents;
  const partial = unavailableSpend || unknownPrize || pendingGames;
  const estimated = unconfirmedSpend || officialPrizeCents > 0;
  const netLabel = partial ? "Saldo parcial" : estimated ? "Saldo estimado" : "Saldo";
  $("reportTotals").innerHTML = [
    metric(money(spentCents), "Gastos"),
    metric(money(prizeCents), "Prêmios apurados"),
    metric(money(net), netLabel),
    metric(integer.format(games), "Jogos no período"),
    metric(integer.format(winningGames), "Jogos com 11 a 15 acertos"),
  ].join("");

  const notes = [];
  if (!games) notes.push("Nenhum jogo do Diário neste período.");
  if (games) notes.push(`Dos prêmios apurados, ${money(confirmedPrizeCents)} foram informados e ${money(officialPrizeCents)} vêm do rateio da Caixa.`);
  if (unconfirmedSpend) notes.push(`${integer.format(unconfirmedSpend)} jogo(s) com gasto estimado.`);
  if (unavailableSpend) notes.push(`${integer.format(unavailableSpend)} jogo(s) sem valor pago.`);
  if (pendingGames) notes.push(`${integer.format(pendingGames)} jogo(s) aguardando resultado.`);
  if (fetchingCount) notes.push(`Consultando prêmios de ${integer.format(fetchingCount)} concurso(s)…`);
  if (unknownPrize && !fetchingCount) notes.push(`${integer.format(unknownPrize)} jogo(s) com prêmio sem valor disponível.`);
  $("reportNote").textContent = notes.join(" ");
  $("reportRetry").hidden = unknownPrize === 0;
  $("reportRetry").disabled = fetchingCount > 0;
  $("reportHits").innerHTML = Object.entries(hitCounts)
    .map(([points, count]) => metric(integer.format(count), `${points} acertos`)).join("");
}

function renderCharts(buckets, hasGames) {
  $("reportCharts").hidden = !hasGames;
  if (!hasGames) return;

  const maximum = Math.max(1, ...buckets.flatMap(({ spentCents, prizeCents }) => [spentCents, prizeCents]));
  $("reportCashChart").innerHTML = buckets.map(({ label, spentCents, prizeCents }) => `
    <div class="report-column" title="${label} · Gastos ${money(spentCents)} · Prêmios ${money(prizeCents)}">
      <div class="report-bars" aria-hidden="true">
        <span class="report-bar report-spent" style="--bar-size:${100 * spentCents / maximum}%"></span>
        <span class="report-bar report-prize" style="--bar-size:${100 * prizeCents / maximum}%"></span>
      </div>
      <span class="report-bucket-label">${label}</span>
    </div>
  `).join("");
  $("reportCashTable").innerHTML = buckets.map(({ label, spentCents, prizeCents }) => `
    <tr><th scope="row">${label}</th><td>${money(spentCents)}</td><td>${money(prizeCents)}</td></tr>
  `).join("");

  let net = 0;
  const balances = buckets.map(({ label, spentCents, prizeCents }) => {
    net += prizeCents - spentCents;
    return { label, net };
  });
  const maximumBalance = Math.max(1, ...balances.map(({ net }) => Math.abs(net)));
  $("reportBalanceChart").innerHTML = balances.map(({ label, net }) => `
    <div class="balance-row">
      <span>${label}</span>
      <span class="balance-track" aria-hidden="true">
        <span class="balance-bar ${net < 0 ? "is-negative" : "is-positive"}"
          style="--bar-size:${50 * Math.abs(net) / maximumBalance}%"></span>
      </span>
      <strong>${money(net)}</strong>
    </div>
  `).join("");
}

function renderRows(rows, limit) {
  $("reportEntriesPanel").hidden = rows.length === 0;
  $("reportMore").hidden = rows.length <= limit;
  const prizeLabels = { confirmed: "Informado", official: "Rateio da Caixa", unavailable: "Valor indisponível" };
  $("reportRows").innerHTML = rows.slice(0, limit).map((row) => `
    <tr>
      <th scope="row"><a href="#concursos/${row.entry.targetContest}">${row.entry.targetContest}</a><br><small>${formatDate(row.date)}</small></th>
      <td>${row.points ?? "Pendente"}</td>
      <td>${money(row.spentCents)}${row.spentCents !== null && !row.spentConfirmed ? "<br><small>Estimado</small>" : ""}</td>
      <td>${money(row.prizeCents)}${prizeLabels[row.prizeSource] ? `<br><small>${prizeLabels[row.prizeSource]}</small>` : ""}</td>
      <td><div class="copy-row">
        ${copyNumbersButton(row.entry.numbers, `Copiar jogo do concurso ${row.entry.targetContest}`)}
        <button class="ghost" type="button" data-report-edit="${diaryEntryKey(row.entry)}"
          aria-label="Editar valores do jogo no concurso ${row.entry.targetContest}">Editar</button>
      </div></td>
    </tr>
  `).join("");
}

function readAmount(input) {
  if (input.value === "") return undefined;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < 0) return NaN;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : NaN;
}

export function createDiaryReport({ getDraws, onDiaryChanged, notify }) {
  const payouts = new Map();
  const failed = new Set();
  const active = new Set();
  const dateInput = $("reportDate");
  const kind = $("reportPeriod");
  let queue = [];
  let fetching = false;
  let rows = [];
  let rowLimit = ROWS_PER_PAGE;
  let editingKey = null;
  dateInput.value = today();

  async function drainPayouts() {
    if (fetching) return;
    fetching = true;
    while (queue.length) {
      const batch = queue.splice(0, REQUEST_BATCH);
      batch.forEach((contest) => active.add(contest));
      await Promise.all(batch.map(async (contest) => {
        try {
          payouts.set(contest, await fetchContestPayouts(contest));
        } catch {
          failed.add(contest);
        } finally {
          active.delete(contest);
        }
      }));
      render();
    }
    fetching = false;
  }

  function render() {
    if ($("relatorio").hidden) {
      queue = [];
      return;
    }
    let period;
    try {
      period = reportPeriod(kind.value, dateInput.value || today());
    } catch {
      dateInput.value = today();
      period = reportPeriod(kind.value, dateInput.value);
    }
    $("reportRange").textContent = `${formatDate(period.start)} a ${formatDate(period.end)}. Usamos a data do sorteio ou a data do registro enquanto o resultado está pendente.`;
    const report = buildDiaryReport(getPlayedGames(), getDraws(), period, payouts);
    rows = report.rows;
    const needingPayout = [...new Set(rows.filter((row) => row.prizeSource === "unavailable")
      .map(({ entry }) => entry.targetContest))];
    const awaiting = needingPayout.filter((contest) => !payouts.has(contest) && !failed.has(contest));
    queue = awaiting.filter((contest) => !active.has(contest));
    renderTotals(report, awaiting.length);
    renderCharts(report.buckets, report.totals.games > 0);
    renderRows(rows, rowLimit);
    if (queue.length) void drainPayouts();
  }

  function filterChanged() {
    rowLimit = ROWS_PER_PAGE;
    render();
  }

  function movePeriod(step) {
    dateInput.value = moveReportDate(kind.value, dateInput.value || today(), step);
    filterChanged();
  }

  function openEditor(event) {
    const button = event.target.closest("[data-report-edit]");
    if (!button) return;
    const row = rows.find(({ entry }) => diaryEntryKey(entry) === button.dataset.reportEdit);
    if (!row) return;
    editingKey = button.dataset.reportEdit;
    $("reportEditorGame").textContent = `Concurso ${row.entry.targetContest} · ${row.entry.numbers.map((number) => String(number).padStart(2, "0")).join(" ")}`;
    $("reportEditorCopy").innerHTML = copyNumbersButton(row.entry.numbers, "Copiar dezenas do jogo");
    $("reportSpent").value = row.entry.spentCents == null ? "" : (row.entry.spentCents / 100).toFixed(2);
    $("reportPrize").value = row.entry.prizeReceivedCents == null ? "" : (row.entry.prizeReceivedCents / 100).toFixed(2);
    $("reportEditorStatus").textContent = "";
    $("reportEditor").showModal();
  }

  function saveEditor(event) {
    event.preventDefault();
    const spentCents = readAmount($("reportSpent"));
    const prizeReceivedCents = readAmount($("reportPrize"));
    if (Number.isNaN(spentCents) || Number.isNaN(prizeReceivedCents)) {
      $("reportEditorStatus").textContent = "Informe valores válidos ou deixe o campo vazio.";
      return;
    }
    const entries = getPlayedGames();
    if (!editingKey || !entries.some((entry) => diaryEntryKey(entry) === editingKey)) {
      $("reportEditorStatus").textContent = "Este jogo saiu do Diário.";
      return;
    }
    try {
      setPlayedGames(entries.map((entry) => diaryEntryKey(entry) === editingKey
        ? { ...entry, spentCents, prizeReceivedCents } : entry));
    } catch {
      $("reportEditorStatus").textContent = "Não consegui salvar os valores neste navegador.";
      return;
    }
    $("reportEditor").close();
    editingKey = null;
    onDiaryChanged();
    notify("Valores do jogo atualizados.");
  }

  kind.addEventListener("change", filterChanged);
  dateInput.addEventListener("change", filterChanged);
  $("reportPrevious").addEventListener("click", () => movePeriod(-1));
  $("reportNext").addEventListener("click", () => movePeriod(1));
  $("reportCurrent").addEventListener("click", () => {
    dateInput.value = today();
    filterChanged();
  });
  $("reportMore").addEventListener("click", () => {
    rowLimit += ROWS_PER_PAGE;
    renderRows(rows, rowLimit);
  });
  $("reportRetry").addEventListener("click", () => {
    for (const row of rows) {
      if (row.prizeSource !== "unavailable") continue;
      failed.delete(row.entry.targetContest);
      payouts.delete(row.entry.targetContest);
    }
    render();
  });
  $("reportRows").addEventListener("click", openEditor);
  $("reportEditorCancel").addEventListener("click", () => $("reportEditor").close());
  $("reportEditorForm").addEventListener("submit", saveEditor);
  return render;
}
