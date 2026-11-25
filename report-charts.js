const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const signedCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", signDisplay: "exceptZero" });
const $ = (id) => document.getElementById(id);

function formatAmount(cents, signed = false) {
  if (cents === null) return "Indisponível";
  return (signed ? signedCurrency : currency).format(cents / 100);
}

function interval({ start, end }) {
  const shortDate = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return start === end ? shortDate(start) : `${shortDate(start)} a ${shortDate(end)}`;
}

function scaleFor(peak) {
  if (!peak) return 0;
  const magnitude = Math.max(1, 10 ** Math.floor(Math.log10(peak / 2)));
  const step = [1, 2, 5, 10].find((factor) => magnitude * factor * 2 >= peak);
  return magnitude * step * 2;
}

function scaleLabels(values, signed = false) {
  if (!values.some(Boolean)) return "";
  return `<div class="report-scale" aria-hidden="true">${values.map((value) => `<span>${formatAmount(value, signed)}</span>`).join("")}</div>`;
}

function quantity(count, singular, plural) {
  return count ? `${count} ${count === 1 ? singular : plural}` : "";
}

function moneySegment(cents, label) {
  return cents > 0 ? `${label} ${formatAmount(cents)}` : "";
}

function cashBar(label, known, value, maximum, parts, notes) {
  const details = notes.filter(Boolean);
  return `
    <div class="report-cash-value">
      <div class="report-value"><span>${label}</span><strong>${formatAmount(known ? value : null)}</strong></div>
      ${known && maximum ? `<div class="report-track" aria-hidden="true">${parts.map(([cents, color]) => cents
        ? `<span class="report-bar ${color}" style="--bar-size:${100 * cents / maximum}%"></span>`
        : "").join("")}</div>` : ""}
      ${details.length ? `<small class="report-chart-note">${details.join(" · ")}</small>` : ""}
    </div>`;
}

function cashPeriod(bucket, maximum) {
  const { games, spentCents, prizeCents, knownSpent, knownPrize, unavailableSpend, pendingPrize, unknownPrize,
    confirmedSpentCents, estimatedSpentCents, unconfirmedSpend, confirmedPrizeCents, officialPrizeCents } = bucket;
  return `
    <li class="report-chart-period">
      <strong class="report-bucket-label">${interval(bucket)}</strong>
      ${cashBar("Gastos", !games || knownSpent, spentCents, maximum, [
        [confirmedSpentCents, "report-spent"], [estimatedSpentCents, "report-estimated"],
      ], [
        moneySegment(confirmedSpentCents, "Informado"),
        unconfirmedSpend ? `Estimado ${formatAmount(estimatedSpentCents)}` : "",
        quantity(unavailableSpend, "gasto sem valor", "gastos sem valor"),
      ])}
      ${cashBar("Prêmios", !games || knownPrize, prizeCents, maximum, [
        [confirmedPrizeCents, "report-prize"], [officialPrizeCents, "report-official"],
      ], [
        moneySegment(confirmedPrizeCents, "Recebido"),
        moneySegment(officialPrizeCents, "Rateio da Caixa"),
        quantity(pendingPrize, "resultado pendente", "resultados pendentes"),
        quantity(unknownPrize, "rateio indisponível", "rateios indisponíveis"),
      ])}
    </li>`;
}

function balancePeriod(bucket, maximum) {
  const balance = bucket.cumulativeBalanceCents;
  const status = { partial: "Parcial", estimated: "Estimado" }[bucket.cumulativeBalanceStatus];
  return `
    <li class="balance-row">
      <div class="report-value"><span>${interval(bucket)}</span><strong>${formatAmount(balance, true)}</strong></div>
      ${balance !== null && maximum ? `<div class="balance-track" aria-hidden="true">
        ${balance ? `<span class="balance-bar ${balance < 0 ? "is-negative" : "is-positive"}"
          style="--bar-size:${50 * Math.abs(balance) / maximum}%"></span>` : ""}
      </div>` : ""}
      ${status ? `<small class="report-chart-note">${status}</small>` : ""}
    </li>`;
}

export function renderReportCharts({ buckets, totals }) {
  $("reportCharts").hidden = totals.games === 0;
  if (!totals.games) return;

  const cashScale = scaleFor(Math.max(...buckets.flatMap(({ spentCents, prizeCents }) => [spentCents, prizeCents])));
  $("reportCashChart").innerHTML = `${scaleLabels([0, cashScale / 2, cashScale])}
    <ul class="report-chart-list" role="list">${buckets.map((bucket) => cashPeriod(bucket, cashScale)).join("")}</ul>`;

  const balanceScale = scaleFor(Math.max(...buckets.map(({ cumulativeBalanceCents }) => Math.abs(cumulativeBalanceCents ?? 0))));
  $("reportBalanceChart").innerHTML = `${scaleLabels([-balanceScale, 0, balanceScale], true)}
    <ul class="report-chart-list" role="list">${buckets.map((bucket) => balancePeriod(bucket, balanceScale)).join("")}</ul>`;
}
