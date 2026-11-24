function copyWithSelection(text) {
  const document = globalThis.document;
  if (!document?.body || typeof document.execCommand !== "function") return false;

  const previousFocus = document.activeElement;
  const container = previousFocus?.closest?.("dialog[open]") ?? document.querySelector?.("dialog[open]") ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";

  try {
    container.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previousFocus && previousFocus !== document.body && previousFocus.isConnected !== false) {
      try {
        previousFocus.focus?.({ preventScroll: true });
      } catch {
        // Focus may be unavailable by the time the temporary field is removed.
      }
    }
  }
}

export async function copyToClipboard(text) {
  if (typeof text !== "string" || !text.trim()) return false;

  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Use selection when clipboard permission or browser support prevents a direct write.
  }

  return copyWithSelection(text);
}
