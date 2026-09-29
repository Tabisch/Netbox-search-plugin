// Page-world script for the selection preview in xterm.js terminals (e.g.
// WebSSH). xterm keeps its selection to itself instead of using the DOM
// selection, so this hooks the global Terminal class and reports selection
// changes to preview.js as a JSON string in a document event.
// Only registered together with the selection preview.

(() => {
  if (window.__netboxSearchXterm) {
    return;
  }
  window.__netboxSearchXterm = true;

  const EVENT = "netbox-search-xterm-selection";
  const PATCHED = Symbol("netboxSearchPatched");

  let pointer = null;
  document.addEventListener(
    "mouseup",
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
    },
    true,
  );

  function isXterm(value) {
    const proto = typeof value === "function" && value.prototype;
    return Boolean(proto && typeof proto.open === "function" && typeof proto.getSelection === "function");
  }

  // Screen rectangle of the selection, or a small box at the mouse pointer.
  function selectionRect(term) {
    const position = term.getSelectionPosition?.();
    const screen = term.element?.querySelector(".xterm-screen");
    if (position && screen && term.cols && term.rows) {
      const box = screen.getBoundingClientRect();
      const cellWidth = box.width / term.cols;
      const cellHeight = box.height / term.rows;
      const buffer = term.buffer?.active ?? term.buffer;
      const top = box.top + (position.startRow - (buffer?.viewportY ?? 0)) * cellHeight;
      const rows = position.endRow - position.startRow + 1;
      return {
        top,
        bottom: top + rows * cellHeight,
        left: box.left + (rows > 1 ? 0 : position.startColumn) * cellWidth,
        right: box.left + (rows > 1 ? term.cols : position.endColumn) * cellWidth,
      };
    }
    if (pointer) {
      return { top: pointer.y - 8, bottom: pointer.y + 8, left: pointer.x, right: pointer.x };
    }
    return null;
  }

  function report(term) {
    const text = term.hasSelection() ? term.getSelection() : "";
    const rect = text ? selectionRect(term) : null;
    document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify({ text, rect }) }));
  }

  function patch(Terminal) {
    const proto = Terminal.prototype;
    if (proto[PATCHED]) {
      return;
    }
    proto[PATCHED] = true;
    const open = proto.open;
    proto.open = function (...args) {
      const result = open.apply(this, args);
      try {
        this.onSelectionChange(() => report(this));
      } catch {
        // Unknown xterm version: no preview, but the terminal still works.
      }
      return result;
    };
  }

  if (isXterm(window.Terminal)) {
    patch(window.Terminal);
    return;
  }

  // Not loaded yet: catch the UMD build assigning window.Terminal.
  let value = window.Terminal;
  try {
    Object.defineProperty(window, "Terminal", {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next) => {
        value = next;
        if (isXterm(next)) {
          patch(next);
        }
      },
    });
  } catch {
    // Property can't be redefined on this page.
  }
})();
