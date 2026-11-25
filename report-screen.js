import { fetchContestPayouts } from "./contest-payout.js?v=16";
import { buildBankrollStatement, buildDiaryReport, moveReportDate, reportPeriod } from "./diary-report.js?v=18";
import { diaryEntryKey, getPlayedGames, setPlayedGames } from "./diary.js?v=20";
import { copyNumbersButton } from "./field-actions.js?v=17";
import { renderReportCharts } from "./report-charts.js?v=18";

const ROWS_PER_PAGE = 6;
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

function paginate(items, page, prefix, nextId = `${prefix}More`) {
  const pageCount = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
  const index = Math.max(0, Math.min(page, pageCount - 1));
  $(`${prefix}Pages`).hidden = pageCount === 1;
  $(`${prefix}Less`).disabled = index === 0;
  $(nextId).disabled = index === pageCount - 1;
  $(`${prefix}PageStatus`).textContent = `${index + 1} de ${pageCount}`;
  const start = index * ROWS_PER_PAGE;
  return { index, visible: items.slice(start, start + ROWS_PER_PAGE) };
}

function renderTotals({ totals, hitCounts }, fetchingCount) {
  const { games, spentCents, prizeCents, confirmedSpentCents, estimatedSpentCents, confirmedPrizeCents,
    officialPrizeCents, knownSpent, knownPrize, unavailableSpend, unknownPrize, pendingGames,
    winningGames, settledGames, balanceCents, balanceStatus } = totals;
  $("reportTotals").innerHTML = [
    metric(signedMoney(balanceCents), "Resultado do período", BALANCE_LABELS[balanceStatus]),
    metric(money(games && !knownSpent ? null : spentCents), "Gastos apurados"),
    metric(money(games && !knownPrize ? null : prizeCents), "Prêmios apurados"),
  ].join("");
  $("reportActivity").textContent = games
    ? `${integer.format(games)} ${games === 1 ? "jogo" : "jogos"} · ${integer.format(settledGames)} com resultado · ${integer.format(winningGames)} com 11 a 15 acertos`
    : "";
  $("reportTotalsDetails").hidden = games === 0;
  $("reportSpentBreakdown").textContent = `Gastos pagos de ${money(confirmedSpentCents)} e estimados em ${money(estimatedSpentCents)}.`;
  $("reportPrizeBreakdown").textContent = `Prêmios recebidos de ${money(confirmedPrizeCents)} e previstos pelo rateio da Caixa de ${money(officialPrizeCents)}.`;

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

function renderRows(rows, page) {
  const { index, visible } = paginate(rows, page, "reportGames", "reportMore");
  $("reportGamesEmpty").hidden = rows.length > 0;
  const prizeLabels = { confirmed: "Recebido informado", official: "Rateio da Caixa", unavailable: "Rateio indisponível", pending: "Resultado pendente" };
  $("reportRows").innerHTML = visible.map((row) => `
    <li class="report-game">
      <div class="report-game-info">
        <div><a href="#concursos/${row.entry.targetContest}">Concurso ${row.entry.targetContest}</a>
          <time datetime="${row.date}">${formatDate(row.date)}</time></div>
        <strong>${row.points === null ? "Pendente" : `${row.points} acertos`}</strong>
      </div>
      <dl class="report-game-amounts">
        <div><dt>Gasto</dt><dd>${money(row.spentCents)}${row.spentCents === null ? "<small>Sem valor informado</small>" : row.spentConfirmed ? "" : "<small>Estimado</small>"}</dd></div>
        <div><dt>Prêmio</dt><dd>${money(row.prizeCents)}${prizeLabels[row.prizeSource] ? `<small>${prizeLabels[row.prizeSource]}</small>` : ""}</dd></div>
      </dl>
      <div class="report-game-actions">
        ${copyNumbersButton(row.entry.numbers, `Copiar jogo do concurso ${row.entry.targetContest}`)}
        <button class="ghost" type="button" data-report-edit="${diaryEntryKey(row.entry)}"
          aria-label="Editar valores do jogo no concurso ${row.entry.targetContest}">Editar</button>
      </div>
    </li>
  `).join("");
  return index;
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

function renderBankroll(statement, report, page) {
  $("reportBankDetails").hidden = !statement;
  if (!statement) return 0;
  const { openingCents, closingCents, entries, status } = statement;
  const { index, visible } = paginate(entries, page, "reportBank");
  const { games, spentCents, prizeCents, knownSpent, knownPrize, balanceCents } = report.totals;
  $("reportBankTotals").innerHTML = [
    metric(signedMoney(closingCents), "Saldo da banca", BALANCE_LABELS[status]),
    metric(money(openingCents), "Saldo inicial"),
    metric(signedMoney(balanceCents), "Resultado do mês"),
    metric(money(games && !knownSpent ? null : spentCents), "Débitos"),
    metric(money(games && !knownPrize ? null : prizeCents), "Créditos"),
  ].join("");
  $("reportBankNote").textContent = status === "partial"
    ? "O saldo inclui os lançamentos com valor disponível."
    : "";
  $("reportBankEmpty").hidden = entries.length > 0;
  $("reportBankTable").hidden = entries.length === 0;
  $("reportBankRows").innerHTML = visible.map((row) => `
    <tr>
      <th scope="row">${row.label}<br><small>${formatDate(row.date)} · <a href="#concursos/${row.contest}">Concurso ${row.contest}</a></small></th>
      <td>${signedMoney(row.amountCents)}<br><small>${row.source}</small></td>
      <td>${signedMoney(row.balanceCents)}${row.status === "complete" ? "" : `<br><small>${BALANCE_LABELS[row.status]}</small>`}</td>
    </tr>
  `).join("");
  return index;
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
  let gamePage = 0;
  let editingKey = null;
  let monthKey = null;
  let bankPage = 0;
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
    const start = formatDate(period.start);
    const end = formatDate(period.end);
    const range = period.start.slice(0, 4) === period.end.slice(0, 4) ? `${start.slice(0, 5)} a ${end}` : `${start} a ${end}`;
    $("reportRange").textContent = `${PERIOD_LABELS[kind.value]} · ${range}`;
    const diary = getPlayedGames();
    const draws = getDraws();
    const report = buildDiaryReport(diary, draws, period, payouts);
    rows = report.rows;
    const bankPeriod = reportPeriod("month", dateInput.value || today());
    const month = bankPeriod.start.slice(0, 7);
    const opening = openingForMonth(month);
    $("reportBankEditLabel").textContent = opening === null ? "Definir saldo inicial" : "Editar saldo inicial";
    if (month !== monthKey) {
      monthKey = month;
      bankInput.value = opening === null ? "" : (opening / 100).toFixed(2);
      $("reportBankEdit").open = opening === null;
      bankPage = 0;
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
    $("reportChartsEmpty").hidden = rows.length > 0;
    gamePage = renderRows(rows, gamePage);
    bankPage = renderBankroll(bankroll, bankReport, bankPage);
    if (hitDialog.open) renderHitDialog(rows, activeHit);
    currentExport = { report, options: { period, notes: [dateNote, ...notes], periodLabel: PERIOD_LABELS[kind.value], bankroll } };
    currentBankExport = bankroll ? { report: bankReport, options: {
      period: bankPeriod, notes: [dateNote], periodLabel: "Mês", bankroll, filenamePrefix: "lotofacil-extrato",
    } } : null;
    if (!exporting) $("reportExport").disabled = false;
    if (queue.length) void drainPayouts();
  }

  function filterChanged() {
    gamePage = 0;
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
    $("reportBankEdit").open = false;
    $("reportBankEditLabel").focus();
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
  $("reportMore").addEventListener("click", () => { gamePage = renderRows(rows, gamePage + 1); });
  $("reportGamesLess").addEventListener("click", () => { gamePage = renderRows(rows, gamePage - 1); });
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
    bankPage += 1;
    render();
  });
  $("reportBankLess").addEventListener("click", () => {
    bankPage -= 1;
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
