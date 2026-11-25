import { createDecipheriv, createECDH, createHmac } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PAIRING_PUBLIC_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "../notification-config.js";

const CAIXA_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
const localTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23",
});

function decode(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (length && bytes.length !== length)) throw new Error("Invalid length");
  return bytes;
}

export function readSubscription(code, pairingPrivateKey) {
  if (code.length > 4096) throw new Error("Invalid pairing code");
  const [version, publicKey, iv, encrypted, extra] = code.trim().split(".");
  if (version !== "LTF1" || extra !== undefined) throw new Error("Invalid pairing code");
  const exchange = createECDH("prime256v1");
  exchange.setPrivateKey(decode(pairingPrivateKey, 32));
  if (exchange.getPublicKey("base64url") !== PAIRING_PUBLIC_KEY) throw new Error("Wrong pairing key");
  const shared = exchange.computeSecret(decode(publicKey, 65));
  const bytes = decode(encrypted);
  const decipher = createDecipheriv("aes-256-gcm", shared, decode(iv, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  const { endpoint, keys } = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]));
  const url = new URL(endpoint);
  const allowed = url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com"
    || url.hostname === "web.push.apple.com" || url.hostname.endsWith(".push.apple.com")
    || url.hostname.endsWith(".notify.windows.com");
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.pathname === "/") {
    throw new Error("Unsupported push endpoint");
  }
  if (decode(keys?.p256dh, 65)[0] !== 4) throw new Error("Invalid subscription key");
  decode(keys?.auth, 16);
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function loadDevice() {
  const { vapidPrivateKey, pairingPrivateKey } = JSON.parse(process.env.LOTTERY_PUSH_PRIVATE);
  const vapid = createECDH("prime256v1");
  vapid.setPrivateKey(decode(vapidPrivateKey, 32));
  if (vapid.getPublicKey("base64url") !== VAPID_PUBLIC_KEY) throw new Error("Wrong VAPID key");
  const subscription = readSubscription(process.env.LOTTERY_PUSH_DEVICE, pairingPrivateKey);
  return { vapidPrivateKey, pairingPrivateKey, subscription };
}

export function currentDraw(payload, now = new Date()) {
  const { numero: contest, dataApuracao: date, listaDezenas, tipoJogo } = payload ?? {};
  const match = typeof date === "string" && /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (tipoJogo !== "LOTOFACIL" || !Number.isSafeInteger(contest) || contest < 1 || !match
      || !Array.isArray(listaDezenas) || listaDezenas.length !== 15
      || listaDezenas.some((item) => (typeof item !== "number" && typeof item !== "string") || !/^\d{1,2}$/.test(item))) {
    throw new Error("Incomplete official draw");
  }
  const numbers = listaDezenas.map(Number).sort((a, b) => a - b);
  if (numbers[0] < 1 || numbers.at(-1) > 25 || new Set(numbers).size !== 15) throw new Error("Invalid official draw numbers");

  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const published = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(published.getTime()) || published.toISOString().slice(0, 10) !== iso) throw new Error("Invalid official draw date");
  const parts = Object.fromEntries(localTime.formatToParts(now).map(({ type, value }) => [type, value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const prior = new Date(`${today}T00:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  const sameDay = iso === today;
  const overnight = Number(parts.hour) < 5 && iso === prior.toISOString().slice(0, 10);
  return sameDay || overnight ? { contest, date, numbers } : null;
}

function payloadPath() {
  return join(process.env.RUNNER_TEMP, "lotofacil-draw-push.json");
}

async function prepare() {
  const device = loadDevice();
  const test = process.env.LOTTERY_PUSH_TEST === "1";
  let payload = { type: "test" };
  if (!test) {
    const response = await fetch(CAIXA_URL, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("Official draw unavailable");
    payload = currentDraw(await response.json());
    if (!payload) {
      console.log("A Caixa ainda não publicou um resultado recente.");
      return;
    }
  }
  const fingerprint = createHmac("sha256", decode(device.pairingPrivateKey, 32))
    .update(device.subscription.endpoint).update(device.subscription.keys.p256dh).digest("hex");
  await writeFile(payloadPath(), JSON.stringify(payload));
  await appendFile(process.env.GITHUB_OUTPUT, `ready=true\n${test ? "" : `cache-key=draw-push-v1-${payload.contest}-${fingerprint}\n`}`);
}

async function send() {
  const { vapidPrivateKey, subscription } = loadDevice();
  const payload = JSON.parse(await readFile(payloadPath(), "utf8"));
  const test = payload.type === "test";
  const { default: webPush } = await import("web-push");
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: vapidPrivateKey },
      TTL: test ? 600 : 21_600,
      timeout: 12_000,
      urgency: "high",
      topic: test ? "lotofacil-teste" : `lotofacil-${payload.contest}`,
    });
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) throw new Error("O pareamento expirou. Gere um novo código no celular.");
    throw new Error("O serviço de notificações recusou o envio.");
  }
  if (!test) await writeFile(join(process.env.RUNNER_TEMP, "lotofacil-draw-sent"), "sent\n");
  console.log(test ? "O serviço de notificações aceitou o teste." : `Aviso do concurso ${payload.contest} aceito pelo serviço de notificações.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  try {
    if (command === "prepare") await prepare();
    else if (command === "send") await send();
    else throw new Error("Unknown command");
  } catch (error) {
    const friendly = ["O pareamento expirou. Gere um novo código no celular.", "O serviço de notificações recusou o envio."];
    console.error(friendly.includes(error.message) ? error.message : "Não foi possível executar os avisos. Verifique o pareamento e a API da Caixa.");
    process.exitCode = 1;
  }
}
