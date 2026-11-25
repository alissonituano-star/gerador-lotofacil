(() => {
  const databaseName = "lotofacil-notificacoes";
  const storeName = "diario";
  const gamesKey = "jogos-por-concurso";
  const verifiedKey = "entrega-confirmada";
  let connection;

  function openDatabase() {
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            connection = undefined;
          };
          resolve(database);
        };
      }).catch((error) => {
        connection = undefined;
        throw error;
      });
    }
    return connection;
  }

  async function requestStore(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  }

  function sync(entries) {
    const games = new Map();
    for (const entry of entries) {
      const contest = entry?.targetContest;
      const numbers = entry?.numbers;
      if (!Number.isSafeInteger(contest) || contest < 1 || !Array.isArray(numbers)
          || numbers.length < 15 || numbers.length > 20 || new Set(numbers).size !== numbers.length
          || numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 25)) continue;
      if (!games.has(contest)) games.set(contest, []);
      games.get(contest).push([...numbers]);
    }
    return requestStore("readwrite", (store) => store.put(games, gamesKey));
  }

  async function read(contest) {
    const games = await requestStore("readonly", (store) => store.get(gamesKey));
    return games instanceof Map ? games.get(contest) ?? [] : [];
  }

  function setVerified(verified) {
    return requestStore("readwrite", (store) => store.put(verified === true, verifiedKey));
  }

  async function isVerified() {
    return await requestStore("readonly", (store) => store.get(verifiedKey)) === true;
  }

  globalThis.lotofacilNotificationDiary = { sync, read, setVerified, isVerified };
})();
