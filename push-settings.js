import { PAIRING_PUBLIC_KEY, VAPID_PUBLIC_KEY } from "./notification-config.js?v=20";
import { copyText } from "./field-actions.js?v=17";

function decodeKey(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function encodeKey(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function makePairingCode(subscription) {
  const curve = { name: "ECDH", namedCurve: "P-256" };
  const peer = await crypto.subtle.importKey("raw", decodeKey(PAIRING_PUBLIC_KEY), curve, false, []);
  const keys = await crypto.subtle.generateKey(curve, true, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, keys.privateKey,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(subscription.toJSON()));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const publicKey = await crypto.subtle.exportKey("raw", keys.publicKey);
  return `LTF1.${encodeKey(publicKey)}.${encodeKey(iv)}.${encodeKey(encrypted)}`;
}

export function installPushSettings({ worker, prepareDiary, notify, isIos }) {
  const status = document.getElementById("pushStatus");
  const activate = document.getElementById("pushActivate");
  const deactivate = document.getElementById("pushDeactivate");
  const pairing = document.getElementById("pushPairing");
  const copy = document.getElementById("pushCopyPairing");
  const localDiary = globalThis.lotofacilNotificationDiary;

  if (!worker || !globalThis.isSecureContext || !globalThis.PushManager || !globalThis.Notification || !crypto.subtle) {
    status.textContent = isIos
      ? "No iPhone, abra o app instalado na Tela de Início para ativar avisos."
      : "Os avisos exigem um navegador compatível e uma conexão segura.";
    return;
  }

  let registration;
  let subscription;
  let code;
  let codePromise;
  let busy = false;

  function updateActions(verified = false) {
    activate.hidden = Boolean(subscription);
    activate.disabled = busy || Notification.permission === "denied";
    deactivate.hidden = !subscription;
    deactivate.disabled = busy;
    pairing.hidden = !subscription || verified;
    copy.disabled = busy || Boolean(codePromise);
    status.textContent = Notification.permission === "denied"
      ? "Os avisos estão bloqueados neste aparelho. Você pode liberar a permissão nas configurações do navegador."
      : !subscription ? "Avisos desativados neste aparelho."
      : verified ? "Avisos ativos neste aparelho."
      : "Permissão liberada. Falta vincular este aparelho ao envio de avisos.";
  }

  async function prepareCode() {
    if (!subscription || code || codePromise) return;
    const device = subscription;
    copy.disabled = true;
    codePromise = makePairingCode(device);
    try {
      const encrypted = await codePromise;
      if (subscription?.endpoint === device.endpoint) code = encrypted;
    } catch {
      status.textContent = "Não consegui gerar o código. Toque em Copiar código de ativação para tentar de novo.";
    } finally {
      codePromise = undefined;
      copy.disabled = busy;
    }
  }

  async function updateState() {
    if (!registration || busy) return;
    const previousEndpoint = subscription?.endpoint;
    subscription = await registration.pushManager.getSubscription();
    if (previousEndpoint !== subscription?.endpoint) code = undefined;
    const verified = Boolean(subscription && await localDiary.isVerified().catch(() => false));
    updateActions(verified);
    if (subscription && !verified) void prepareCode();
  }

  worker.then(async (ready) => {
    registration = ready;
    if (registration) {
      await updateState();
      if (subscription) void prepareDiary().catch(() => {});
    }
    else status.textContent = "Os avisos estão indisponíveis agora. Reabra o aplicativo com internet.";
  }).catch(() => {
    status.textContent = "Não consegui verificar os avisos neste navegador.";
  });

  activate.addEventListener("click", async () => {
    if (!registration || busy) return;
    busy = true;
    activate.disabled = true;
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(VAPID_PUBLIC_KEY),
      });
      await Promise.allSettled([localDiary.setVerified(false), prepareDiary()]);
    } catch {
      notify("Não consegui ativar os avisos. Verifique a permissão de notificações.");
    } finally {
      busy = false;
      await updateState().catch(() => updateActions());
    }
  });

  deactivate.addEventListener("click", async () => {
    if (!subscription || busy) return;
    busy = true;
    deactivate.disabled = true;
    try {
      await subscription.unsubscribe();
      await localDiary.setVerified(false).catch(() => {});
    } catch {
      notify("Não consegui desativar os avisos neste aparelho.");
    } finally {
      busy = false;
      await updateState().catch(() => updateActions());
    }
  });

  copy.addEventListener("click", () => {
    if (!subscription || busy) return;
    if (code) {
      void copyText(code, notify);
    } else {
      void prepareCode().then(() => {
        if (code) notify("Código pronto. Toque novamente para copiar.");
      });
    }
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "lotofacil-push-verified") void updateState().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void updateState().catch(() => {});
  });
}
