import { fetchContestPayouts } from "./contest-payout.js?v=16";
import { buildBankrollStatement, buildDiaryReport, moveReportDate, reportPeriod } from "./diary-report.js?v=18";
import { diaryEntryKey, getPlayedGames, setPlayedGames } from "./diary.js?v=16";
import { copyNumbersButton } from "./field-actions.js?v=17";
import { renderReportCharts } from "./report-charts.js?v=18";

const ROWS_PER_PAGE = 30;
const REQUEST_BATCH = 4;
const BANKROLL_PREFIX = "lotofacil-bankroll-";
const PERIOD_LABELS = { week: "Semana", month: "Mês", year: "Ano" };
const BALANCE_LABELS = { partial: "Parcial", estimated: "Estimado", complete: "Apurado" };
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");
const saoPauloDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
const monthName = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
const $ = (id) => document.getElementById(id);

function today() {
  const parts = Object.fromEntries(saoPauloDate.formatToParts().map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDate(iso) {
  return iso.split("-").reverse().join("/");
}

function money(cents) {
  return cents === null ? "–" : currency.format((cents || 0) / 100);
}

function signedMoney(cents) {
  return cents > 0 ? `+${money(cents)}` : money(cents);
}

function metric(value, label, detail = "") {
  return `<div><small>${label}</small><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`;
}

function renderTotals({ totals, hitCounts }, fetchingCount) {
  const { games, spentCents, prizeCents, confirmedSpentCents, estimatedSpentCents, confirmedPrizeCents,
    officialPrizeCents, knownSpent, knownPrize, unavailableSpend, unknownPrize, pendingGames,
    winningGames, settledGames, balanceCents, balanceStatus } = totals;
  $("reportTotals").innerHTML = [
    metric(money(games && !knownSpent ? null : spentCents), "Gastos apurados",
      `${money(confirmedSpentCents)} confirmados · ${money(estimatedSpentCents)} estimados`),
    metric(money(games && !knownPrize ? null : prizeCents), "Prêmios apurados",
      `${money(confirmedPrizeCents)} recebidos · ${money(officialPrizeCents)} em rateio`),
    metric(signedMoney(balanceCents), "Resultado do período", BALANCE_LABELS[balanceStatus]),
    metric(integer.format(games), "Jogos no período", `${integer.format(settledGames)} com resultado`),
    metric(integer.format(winningGames), "Jogos com 11 a 15 acertos"),
  ].join("");

  const notes = [];
  if (!games) notes.push("Nenhum jogo do Diário neste período.");
  if (unavailableSpend) notes.push(`${integer.format(unavailableSpend)} sem valor pago informado.`);
  if (pendingGames) notes.push(`${integer.format(pendingGames)} com resultado pendente.`);
  if (fetchingCount) notes.push(`${integer.format(fetchingCount)} em consulta de rateio.`);
  if (unknownPrize) notes.push(`${integer.format(unknownPrize)} com prêmio sem valor apurado.`);
  $("reportNote").textContent = notes.join(" ");
  $("reportHits").innerHTML = Object.entries(hitCounts)
    .map(([points, count]) => `<button class="report-hit" type="button" data-report-hit="${points}" aria-haspopup="dialog"
      aria-label="Ver ${integer.format(count)} jogo(s) com ${points} acertos"><strong>${integer.format(count)}</strong><span>${points} acertos</span></button>`).join("");
  return notes;
}

function renderHitDialog(rows, points) {
  const matches = new Map();
  for (const row of rows) {
    if (row.points !== points) continue;
    const { targetContest: contest } = row.entry;
    if (!matches.has(contest)) matches.set(contest, { date: row.date, count: 0 });
    matches.get(contest).count += 1;
  }
  $("reportHitHeading").textContent = `${points} acertos`;
  $("reportHitEmpty").hidden = matches.size > 0;
  $("reportHitContests").innerHTML = [...matches].map(([contest, { date, count }]) => `
    <li><a href="#concursos/${contest}">Concurso ${contest}</a><span>${formatDate(date)} ·
      ${integer.format(count)} ${count === 1 ? "jogo" : "jogos"}</span></li>
  `).join("");
}

function renderRows(rows, limit) {
  $("reportEntriesPanel").hidden = rows.length === 0;
  $("reportMore").hidden = rows.length <= limit;
  const prizeLabels = { confirmed: "Recebido informado", official: "Rateio da Caixa", unavailable: "Rateio indisponível", pending: "Resultado pendente" };
  $("reportRows").innerHTML = rows.slice(0, limit).map((row) => `
    <tr>
      <th scope="row"><a href="#concursos/${row.entry.targetContest}">${row.entry.targetContest}</a><br><small>${formatDate(row.date)}</small></th>
      <td>${row.points ?? "Pendente"}</td>
      <td>${money(row.spentCents)}${row.spentCents === null ? "<br><small>Sem valor informado</small>" : row.spentConfirmed ? "" : "<br><small>Estimado</small>"}</td>
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
  const scaled = value * 100;
  const cents = Math.round(scaled);
  return Number.isSafeInteger(cents) && Math.abs(scaled - cents) <= Math.max(1e-8, scaled * Number.EPSILON) ? cents : NaN;
}

function openingForMonth(month) {
  try {
    const value = localStorage.getItem(BANKROLL_PREFIX + month);
    const cents = value === null ? null : Number(value);
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  } catch {
    return null;
  }
}

function renderBankroll(statement, report, limit) {
  $("reportBankDetails").hidden = !statement;
  if (!statement) return;
  const { openingCents, closingCents, entries, status } = statement;
  const { games, spentCents, prizeCents, knownSpent, knownPrize, balanceCents } = report.totals;
  $("reportBankTotals").innerHTML = [
    metric(money(openingCents), "Saldo inicial"),
    metric(money(games && !knownSpent ? null : spentCents), "Débitos apurados"),
    metric(money(games && !knownPrize ? null : prizeCents), "Créditos apurados"),
    metric(signedMoney(balanceCents), "Resultado do mês", BALANCE_LABELS[status]),
    metric(signedMoney(closingCents), "Saldo da banca", BALANCE_LABELS[status]),
  ].join("");
  $("reportBankNote").textContent = status === "partial"
    ? "Saldo parcial. Lançamentos pendentes ou sem valor aparecem no extrato e só alteram o saldo quando tiverem um valor."
    : "O extrato usa o valor informado no Diário ou o gasto estimado e o rateio da Caixa, quando disponíveis.";
  $("reportBankEmpty").hidden = entries.length > 0;
  $("reportBankTable").hidden = entries.length === 0;
  $("reportBankMore").hidden = entries.length <= limit;
  $("reportBankRows").innerHTML = entries.slice(0, limit).map((row) => `
    <tr>
      <th scope="row">${row.label}<br><small>${formatDate(row.date)} · <a href="#concursos/${row.contest}">Concurso ${row.contest}</a></small></th>
      <td>${signedMoney(row.amountCents)}<br><small>${row.source}</small></td>
      <td>${signedMoney(row.balanceCents)}${row.status === "complete" ? "" : `<br><small>${BALANCE_LABELS[row.status]}</small>`}</td>
    </tr>
  `).join("");
}

export function createDiaryReport({ getDraws, onDiaryChanged, notify }) {
  const payouts = new Map();
  const failed = new Set();
  const active = new Set();
  const dateInput = $("reportDate");
  const kind = $("reportPeriod");
  const bankInput = $("reportBankOpening");
  const hitDialog = $("reportHitDialog");
  let queue = [];
  let fetching = false;
  let rows = [];
  let rowLimit = ROWS_PER_PAGE;
  let editingKey = null;
  let monthKey = null;
  let bankLimit = ROWS_PER_PAGE;
  let activeHit = null;
  let currentExport;
  let currentBankExport;
  let neededPayouts = new Set();
  let exporting = false;
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
    const dateNote = "Os jogos entram na data do sorteio. Enquanto o resultado estiver pendente, usamos a data do registro.";
    $("reportRange").textContent = `${formatDate(period.start)} a ${formatDate(period.end)}. ${dateNote}`;
    const diary = getPlayedGames();
    const draws = getDraws();
    const report = buildDiaryReport(diary, draws, period, payouts);
    rows = report.rows;
    const bankPeriod = reportPeriod("month", dateInput.value || today());
    const month = bankPeriod.start.slice(0, 7);
    const opening = openingForMonth(month);
    if (month !== monthKey) {
      monthKey = month;
      bankInput.value = opening === null ? "" : (opening / 100).toFixed(2);
      bankLimit = ROWS_PER_PAGE;
      $("reportBankStatus").textContent = "";
    }
    $("reportBankMonth").textContent = monthName.format(new Date(`${bankPeriod.start}T00:00:00Z`));
    const bankReport = opening === null ? null : kind.value === "month" ? report
      : buildDiaryReport(diary, draws, bankPeriod, payouts);
    const bankroll = bankReport ? buildBankrollStatement(bankReport, bankPeriod, opening) : null;
    const awaitingFor = (list) => list.filter((row) => row.prizeSource === "unavailable")
      .map(({ entry }) => entry.targetContest);
    const periodPayouts = new Set(awaitingFor(rows));
    neededPayouts = new Set([...periodPayouts, ...awaitingFor(bankReport?.rows ?? [])]);
    const awaiting = [...neededPayouts].filter((contest) => !payouts.has(contest) && !failed.has(contest));
    queue = awaiting.filter((contest) => !active.has(contest));
    const notes = renderTotals(report, awaiting.filter((contest) => periodPayouts.has(contest)).length);
    $("reportRetry").hidden = ![...neededPayouts].some((contest) => failed.has(contest) || payouts.has(contest));
    $("reportRetry").disabled = !$("reportRetry").hidden && awaiting.length > 0;
    renderReportCharts(report);
    renderRows(rows, rowLimit);
    renderBankroll(bankroll, bankReport, bankLimit);
    if (hitDialog.open) renderHitDialog(rows, activeHit);
    currentExport = { report, options: { period, notes: [dateNote, ...notes], periodLabel: PERIOD_LABELS[kind.value], bankroll } };
    currentBankExport = bankroll ? { report: bankReport, options: {
      period: bankPeriod, notes: [dateNote], periodLabel: "Mês", bankroll, filenamePrefix: "lotofacil-extrato",
    } } : null;
    if (!exporting) $("reportExport").disabled = false;
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

  function saveBankroll(event) {
    event.preventDefault();
    const opening = readAmount(bankInput);
    const status = $("reportBankStatus");
    if (opening === undefined || Number.isNaN(opening) || !monthKey) {
      status.textContent = "Informe um saldo inicial válido com até duas casas decimais.";
      return;
    }
    try {
      localStorage.setItem(BANKROLL_PREFIX + monthKey, String(opening));
    } catch {
      status.textContent = "Não consegui salvar o saldo inicial neste navegador.";
      return;
    }
    bankInput.value = (opening / 100).toFixed(2);
    render();
    status.textContent = "Saldo inicial salvo para este mês.";
  }

  async function exportPdf(snapshot) {
    if (!snapshot || exporting) return;
    exporting = true;
    $("reportExport").disabled = true;
    $("reportBankExport").disabled = true;
    try {
      const { downloadDiaryReportPdf } = await import("./report-pdf.js?v=18");
      await downloadDiaryReportPdf(snapshot.report, snapshot.options);
    } catch (error) {
      console.error(error);
      notify("Não consegui gerar o PDF. Tente novamente.");
    } finally {
      exporting = false;
      $("reportExport").disabled = false;
      $("reportBankExport").disabled = false;
    }
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
    for (const contest of neededPayouts) {
      failed.delete(contest);
      payouts.delete(contest);
    }
    render();
  });
  $("reportExport").addEventListener("click", () => void exportPdf(currentExport));
  $("reportBankExport").addEventListener("click", () => void exportPdf(currentBankExport));
  $("reportBankForm").addEventListener("submit", saveBankroll);
  $("reportBankMore").addEventListener("click", () => {
    bankLimit += ROWS_PER_PAGE;
    render();
  });
  $("reportHits").addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-hit]");
    if (!button) return;
    activeHit = Number(button.dataset.reportHit);
    renderHitDialog(rows, activeHit);
    hitDialog.showModal();
  });
  $("reportHitContests").addEventListener("click", (event) => {
    if (event.target.closest("a")) hitDialog.close();
  });
  $("reportRows").addEventListener("click", openEditor);
  $("reportEditorCancel").addEventListener("click", () => $("reportEditor").close());
  $("reportEditorForm").addEventListener("submit", saveEditor);
  return render;
}
