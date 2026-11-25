const COLOR = {
  ink: "#251937",
  muted: "#625574",
  line: "#e6dfee",
  pale: "#f4f0fa",
  accent: "#562790",
  spend: "#8152a9",
  prize: "#087966",
};
const MARGIN = 44;
const FONT = "helvetica";
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const countFormat = new Intl.NumberFormat("pt-BR");
const statuses = { partial: "Parcial", estimated: "Estimado", complete: "Apurado" };
const prizes = {
  unavailable: "Sem rateio",
  pending: "Resultado pendente",
  confirmed: "Informado",
  official: "Rateio da Caixa",
  none: "Sem prêmio",
};

function money(cents, signed = false) {
  if (cents == null) return "Sem valor";
  const brl = moneyFormat.format((cents === 0 ? 0 : cents) / 100).replace(/\s/g, " ");
  return signed && cents > 0 ? `+${brl}` : brl;
}

function date(iso) {
  return iso.split("-").reverse().join("/");
}

function dateInterval({ start, end }) {
  return start === end ? date(start) : `${date(start)} a ${date(end)}`;
}

function sumShown(item, amount, known) {
  return item.games && item[known] === 0 ? null : item[amount];
}

function setFont(doc, size, color = COLOR.ink, bold = false) {
  doc.setFont(FONT, bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(color);
}

function clean(text) {
  return String(text).replace(/[–—−]/g, "-").replace(/\u00a0/g, " ");
}

export function createDiaryReportPdf(JsPDF, report, { period, notes = [], periodLabel = "", bankroll = null }) {
  const doc = new JsPDF({ unit: "pt", format: "a4", compress: true, putOnlyUsedFonts: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  const right = pageWidth - MARGIN;
  const bottom = pageHeight - 67;
  let y;

  function pageHeader(first) {
    doc.setFillColor(COLOR.accent);
    doc.rect(0, 0, pageWidth, 5, "F");
    setFont(doc, 9, COLOR.accent, true);
    doc.text("GERADOR LOTOFÁCIL", MARGIN, 41);
    setFont(doc, first ? 26 : 18, COLOR.ink, true);
    doc.text("Relatório Lotofácil", MARGIN, first ? 76 : 67);
    setFont(doc, 10, COLOR.muted);
    doc.text([periodLabel, dateInterval(period)].filter(Boolean).join(" | "), MARGIN, first ? 97 : 85);
    y = first ? 125 : 109;
  }

  function nextPage() {
    doc.addPage();
    pageHeader(false);
  }

  function ensure(height) {
    if (y + height > bottom) nextPage();
  }

  function heading(title) {
    setFont(doc, 13, COLOR.accent, true);
    doc.text(title, MARGIN, y);
    y += 15;
  }

  function paragraph(text) {
    setFont(doc, 9, COLOR.muted);
    const lines = doc.splitTextToSize(clean(text), width);
    ensure(12 * lines.length + 5);
    setFont(doc, 9, COLOR.muted);
    doc.text(lines, MARGIN, y, { lineHeightFactor: 1.3 });
    y += 12 * lines.length + 5;
  }

  function cards(items) {
    const gap = 9;
    const cardWidth = (width - gap * (items.length - 1)) / items.length;
    items.forEach(({ label, value, detail }, index) => {
      const x = MARGIN + index * (cardWidth + gap);
      doc.setFillColor(COLOR.pale);
      doc.roundedRect(x, y, cardWidth, 54, 6, 6, "F");
      setFont(doc, 9, COLOR.muted);
      doc.text(label, x + 11, y + 15);
      setFont(doc, 15, COLOR.ink, true);
      doc.text(value, x + 11, y + 35);
      if (detail) {
        setFont(doc, 8, COLOR.muted);
        doc.text(detail, x + 11, y + 47);
      }
    });
    y += 70;
  }

  function table(title, columns, rows) {
    const widths = columns.map(({ fraction }) => width * fraction);
    const rowFontSize = 9;
    const lineHeight = 11;
    function formatRow(values) {
      setFont(doc, rowFontSize);
      const lines = values.map((value, index) => clean(value).split("\n")
        .flatMap((part) => doc.splitTextToSize(part, widths[index] - 14)));
      return { lines, height: 10 + Math.max(...lines.map((cell) => cell.length)) * lineHeight };
    }

    function row(rect, header = false) {
      const { lines, height } = rect;
      if (header) {
        doc.setFillColor(COLOR.pale);
        doc.rect(MARGIN, y, width, height, "F");
      } else {
        doc.setDrawColor(COLOR.line);
        doc.line(MARGIN, y + height, right, y + height);
      }
      let left = MARGIN;
      lines.forEach((cell, index) => {
        const align = columns[index].align ?? "left";
        const x = align === "right" ? left + widths[index] - 7 : left + 7;
        setFont(doc, rowFontSize, header ? COLOR.accent : COLOR.ink, header);
        doc.text(cell, x, y + 13, { align, lineHeightFactor: lineHeight / rowFontSize });
        left += widths[index];
      });
      y += height;
    }

    const header = formatRow(columns.map(({ title: label }) => label));
    const data = rows.map(formatRow);
    ensure(header.height + (data[0]?.height ?? 0) + 24);
    heading(title);
    row(header, true);
    for (const item of data) {
      if (y + item.height > bottom) {
        nextPage();
        heading(`${title} (continuação)`);
        row(header, true);
      }
      row(item);
    }
    y += 21;
  }

  function chart(buckets) {
    const bound = Math.max(...buckets.flatMap(({ spentCents, prizeCents }) => [spentCents, prizeCents]));
    if (bound <= 0) return;
    ensure(145);
    heading("Gastos e prêmios apurados");
    const left = MARGIN + 116;
    const height = 57;
    const base = y + 75;
    const chartWidth = right - left;
    const step = chartWidth / buckets.length;
    const barWidth = Math.min(step * 0.3, 13);
    setFont(doc, 9, COLOR.muted);
    doc.setFillColor(COLOR.spend);
    doc.rect(MARGIN, y + 3, 8, 8, "F");
    doc.text("Gastos", MARGIN + 13, y + 10);
    doc.setFillColor(COLOR.prize);
    doc.rect(MARGIN + 66, y + 3, 8, 8, "F");
    doc.text("Prêmios", MARGIN + 79, y + 10);
    doc.text(money(bound), left - 6, base - height + 3, { align: "right" });
    doc.text("R$ 0,00", left - 6, base + 3, { align: "right" });
    doc.setDrawColor(COLOR.line);
    doc.line(left, base - height, right, base - height);
    doc.line(left, base, right, base);
    for (const [index, bucket] of buckets.entries()) {
      const center = left + (index + .5) * step;
      const barHeight = (cents) => height * cents / bound;
      if (bucket.spentCents > 0) {
        doc.setFillColor(COLOR.spend);
        doc.rect(center - barWidth - 1, base - barHeight(bucket.spentCents), barWidth, barHeight(bucket.spentCents), "F");
      }
      if (bucket.prizeCents > 0) {
        doc.setFillColor(COLOR.prize);
        doc.rect(center + 1, base - barHeight(bucket.prizeCents), barWidth, barHeight(bucket.prizeCents), "F");
      }
      setFont(doc, 8, COLOR.muted);
      doc.text(clean(bucket.label), center, base + 14, { align: "center" });
    }
    y = base + 33;
  }

  pageHeader(true);
  heading("Resumo financeiro");
  const { totals, rows, hitCounts, buckets } = report;
  cards([
    { label: "Gastos apurados", value: money(sumShown(totals, "spentCents", "knownSpent")) },
    { label: "Prêmios apurados", value: money(sumShown(totals, "prizeCents", "knownPrize")) },
    { label: "Resultado do período", value: money(totals.balanceCents, true), detail: statuses[totals.balanceStatus] },
  ]);
  paragraph(`Gastos informados: ${money(totals.confirmedSpentCents)}. Gastos estimados: ${money(totals.estimatedSpentCents)}.`);
  paragraph(`Prêmios informados: ${money(totals.confirmedPrizeCents)}. Prêmios calculados pelo rateio da Caixa: ${money(totals.officialPrizeCents)}.`);
  paragraph(`Jogos registrados: ${countFormat.format(totals.games)}. Com resultado: ${countFormat.format(totals.settledGames)}. Com 11 a 15 acertos: ${countFormat.format(totals.winningGames)}.`);
  for (const note of typeof notes === "string" ? [notes] : notes) if (note) paragraph(note);
  y += 7;

  ensure(85);
  heading("Jogos por maior acerto");
  cards(Object.entries(hitCounts).map(([points, count]) => ({
    label: `${points} acertos`,
    value: countFormat.format(count),
  })));

  if (rows.length) {
    chart(buckets);
    paragraph("O saldo acumulado parte de zero no início do período selecionado.");
    table("Valores por intervalo", [
      { title: "Intervalo", fraction: .26 },
      { title: "Gastos", fraction: .18, align: "right" },
      { title: "Prêmios", fraction: .18, align: "right" },
      { title: "Saldo acumulado", fraction: .22, align: "right" },
      { title: "Situação", fraction: .16 },
    ], buckets.map((bucket) => [
      [bucket.label, dateInterval(bucket)].join("\n"),
      money(sumShown(bucket, "spentCents", "knownSpent")),
      money(sumShown(bucket, "prizeCents", "knownPrize")),
      money(bucket.cumulativeBalanceCents, true),
      statuses[bucket.cumulativeBalanceStatus],
    ]));
  }

  if (bankroll) {
    const hasMovementAmounts = bankroll.entries.length === 0
      || bankroll.entries.some(({ amountCents }) => amountCents !== null);
    ensure(100);
    heading("Banca mensal");
    paragraph(dateInterval(bankroll));
    cards([
      { label: "Saldo inicial", value: money(bankroll.openingCents) },
      { label: "Movimento líquido", value: money(hasMovementAmounts ? bankroll.closingCents - bankroll.openingCents : null, true) },
      { label: "Saldo da banca", value: money(bankroll.closingCents, true), detail: statuses[bankroll.status] },
    ]);
    if (bankroll.entries.length) {
      table("Extrato da banca", [
        { title: "Data / concurso", fraction: .24 },
        { title: "Movimento / origem", fraction: .30 },
        { title: "Valor", fraction: .20, align: "right" },
        { title: "Saldo da banca", fraction: .26, align: "right" },
      ], bankroll.entries.map((entry) => [
        `${date(entry.date)}\nConcurso ${entry.contest}`,
        `${entry.label}\n${entry.source}`,
        money(entry.amountCents, true),
        `${money(entry.balanceCents, true)}\n${statuses[entry.status]}`,
      ]));
    } else {
      paragraph("Sem movimentos registrados no mês.");
    }
  }

  if (rows.length) {
    table("Jogos do período", [
      { title: "Concurso / data", fraction: .19 },
      { title: "Dezenas", fraction: .33 },
      { title: "Acertos", fraction: .10 },
      { title: "Gasto", fraction: .18, align: "right" },
      { title: "Prêmio", fraction: .20, align: "right" },
    ], rows.map((row) => [
      `${row.entry.targetContest}\n${date(row.date)}`,
      row.entry.numbers.map((number) => String(number).padStart(2, "0")).join(" "),
      row.points ?? "-",
      `${money(row.spentCents)}${row.spentCents == null ? "" : row.spentConfirmed ? "\nInformado" : "\nEstimado"}`,
      `${money(row.prizeCents)}\n${prizes[row.prizeSource]}`,
    ]));
  } else {
    paragraph("Nenhum jogo registrado no período selecionado.");
  }

  doc.setProperties({ title: `Relatório Lotofácil - ${dateInterval(period)}`, creator: "Gerador Lotofácil" });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(COLOR.line);
    doc.line(MARGIN, pageHeight - 48, right, pageHeight - 48);
    setFont(doc, 8, COLOR.muted);
    doc.text("Relatório do Diário | Valores em reais", MARGIN, pageHeight - 32);
    doc.text(`Página ${page} de ${pages}`, right, pageHeight - 32, { align: "right" });
  }
  return doc;
}

export async function downloadDiaryReportPdf(report, options) {
  await import("./assets/jspdf.umd.min.js?v=18");
  const doc = createDiaryReportPdf(globalThis.jspdf.jsPDF, report, options);
  const { filenamePrefix = "lotofacil-relatorio", period } = options;
  doc.save(`${filenamePrefix}-${period.start}-a-${period.end}.pdf`);
}
