import { copyToClipboard } from "./clipboard.js?v=17";

export async function copyText(text, notify) {
  const value = text.trim();
  if (!value) {
    notify("Preencha o campo para copiar.");
    return;
  }
  const copied = await copyToClipboard(value);
  notify(copied ? "Copiado para a área de transferência." : "O navegador não permitiu copiar.");
}

export function copyNumbersButton(numbers, label, caption = "Copiar") {
  if (!numbers.length) return "";
  const value = numbers.map((number) => String(number).padStart(2, "0")).join(" ");
  return `<button type="button" class="copy-action" data-copy-numbers="${value}" aria-label="${label}">${caption}</button>`;
}

export function installFieldActions({ onClear, notify }) {
  function notifyFrom(button, message) {
    const status = button.closest("dialog")?.querySelector('[role="status"]');
    if (status) status.textContent = message;
    else notify(message);
  }

  document.querySelectorAll("[data-field-tools]").forEach((wrapper) => {
    const field = wrapper.querySelector("input, textarea, select");
    const actions = document.createElement("span");
    actions.className = "field-actions";
    for (const tool of wrapper.dataset.fieldTools.split(" ")) {
      const copy = tool === "copy";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "field-action";
      button.textContent = copy ? "Copiar" : "×";
      button.setAttribute("aria-label", `${copy ? "Copiar" : "Limpar"} ${wrapper.dataset.fieldLabel}`);
      button.addEventListener("click", () => {
        if (field.disabled) return;
        if (copy) {
          void copyText(field.value, (message) => notifyFrom(button, message));
          return;
        }
        const previous = field.value;
        field.value = wrapper.dataset.clearValue ?? "";
        onClear(field, previous);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.focus({ preventScroll: true });
      });
      actions.append(button);
    }
    wrapper.append(actions);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-copy-numbers]");
    if (button) void copyText(button.dataset.copyNumbers, (message) => notifyFrom(button, message));
  });
}
