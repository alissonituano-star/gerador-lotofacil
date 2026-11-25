(() => {
  const scope = new URL(self.registration.scope);
  const icon = new URL("assets/icon-192.png?v=10", scope).href;
  const notificationKind = "lotofacil-draw";

  function validContest(contest) {
    return Number.isSafeInteger(contest) && contest > 0;
  }

  function parseDraw(payload) {
    if (!payload || !validContest(payload.contest) || !Array.isArray(payload.numbers)
        || payload.numbers.length !== 15 || new Set(payload.numbers).size !== 15
        || payload.numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 25)) return null;
    return { contest: payload.contest, numbers: [...payload.numbers].sort((a, b) => a - b) };
  }

  function describeHits(games, numbers) {
    if (!games.length) return "";
    const drawn = new Set(numbers);
    const best = games.reduce((current, game) => Math.max(current, game.filter((number) => drawn.has(number)).length), 0);
    const result = `${best} ${best === 1 ? "acerto" : "acertos"}`;
    return games.length === 1 ? `Seu jogo fez ${result}.` : `Você fez até ${result} em ${games.length} jogos.`;
  }

  function belongsToApp(client) {
    const url = new URL(client.url);
    return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`);
  }

  async function confirmDelivery() {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;
    await globalThis.lotofacilNotificationDiary.setVerified(true);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows.filter(belongsToApp)) client.postMessage({ type: "lotofacil-push-verified" });
  }

  async function showDrawNotification(data) {
    let payload;
    try {
      payload = data?.json();
    } catch {
      // A push without valid draw data can still open the official results screen.
    }

    const draw = parseDraw(payload);
    const isTest = payload?.type === "test";
    let title = "Gerador Lotofácil";
    let body = isTest
      ? "Os avisos de sorteio estão funcionando neste aparelho."
      : "Abra o aplicativo para consultar os resultados da Caixa.";
    if (draw) {
      const games = await globalThis.lotofacilNotificationDiary.read(draw.contest).catch(() => []);
      const hits = describeHits(games, draw.numbers);
      const numbers = draw.numbers.map((number) => String(number).padStart(2, "0")).join(" ");
      title = `Lotofácil · Concurso ${draw.contest}`;
      body = `${hits ? `${hits}\n` : ""}${numbers}`;
    }

    await self.registration.showNotification(title, {
      body, icon, badge: icon, lang: "pt-BR", tag: draw ? `${notificationKind}-${draw.contest}` : notificationKind,
      data: { kind: notificationKind, contest: draw?.contest },
    });
    if (draw || isTest) await confirmDelivery().catch(() => {});
  }

  async function openResult(contest) {
    const target = new URL(scope);
    target.hash = validContest(contest) ? `concursos/${contest}` : "concursos";
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows.filter(belongsToApp)) {
      try {
        const navigated = await client.navigate(target.href);
        if (navigated) {
          await navigated.focus();
          return;
        }
      } catch {
        // Open a new window if the browser cannot navigate an existing client.
      }
    }
    await self.clients.openWindow(target.href);
  }

  self.addEventListener("push", (event) => {
    event.waitUntil(showDrawNotification(event.data));
  });

  self.addEventListener("notificationclick", (event) => {
    const data = event.notification.data;
    if (data?.kind !== notificationKind) return;
    event.notification.close();
    event.waitUntil(openResult(data.contest));
  });
})();
