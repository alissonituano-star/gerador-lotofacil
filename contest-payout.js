const CAIXA_LOTOFACIL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
const REQUEST_TIMEOUT_MS = 10000;

export async function fetchContestPayouts(contest) {
  if (!Number.isSafeInteger(contest) || contest < 1) throw new TypeError("Número de concurso inválido.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${CAIXA_LOTOFACIL}/${contest}`, {
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`A Caixa retornou HTTP ${response.status}.`);

    const payload = await response.json();
    const rows = payload?.listaRateioPremio;
    if (payload?.numero !== contest || !Array.isArray(rows) || !rows.length) {
      throw new Error("A Caixa retornou um rateio inválido para este concurso.");
    }

    const payouts = {};
    const seen = new Set();
    for (const row of rows) {
      const { faixa, valorPremio, numeroDeGanhadores } = row ?? {};
      if (!Number.isInteger(faixa) || faixa < 1 || faixa > 5 || seen.has(faixa)
          || !Number.isFinite(valorPremio)
          || (numeroDeGanhadores != null && (!Number.isSafeInteger(numeroDeGanhadores) || numeroDeGanhadores < 0))) {
        throw new Error("A Caixa retornou dados inválidos para uma faixa de premiação.");
      }
      seen.add(faixa);
      if (valorPremio <= 0 || numeroDeGanhadores === 0) continue;

      const scaled = valorPremio * 100;
      const cents = Math.round(scaled);
      if (!Number.isSafeInteger(cents) || cents <= 0
          || Math.abs(scaled - cents) > Math.max(1e-8, scaled * Number.EPSILON)) {
        throw new Error("A Caixa retornou um valor de prêmio inválido.");
      }
      payouts[16 - faixa] = cents;
    }
    return payouts;
  } finally {
    clearTimeout(timeout);
  }
}
