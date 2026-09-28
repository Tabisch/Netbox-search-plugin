// Content script: when short text is selected, asks the background worker for
// NetBox matches and shows them in a small card below the selection.
// Only registered when "Preview matches for selected text" is enabled.

(() => {
  if (window.__netboxSearchPreview) {
    return;
  }
  window.__netboxSearchPreview = true;

  const MIN_LENGTH = 2;
  const MAX_LENGTH = 100;
  const DELAY_MS = 350;

  let host = null;
  let timer = null;
  let lastQuery = "";
  let requestId = 0;

  const STYLE = `
    :host { all: initial; }
    .card {
      position: fixed;
      z-index: 2147483647;
      width: 320px;
      max-width: calc(100vw - 16px);
      box-sizing: border-box;
      padding: 8px 0;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #1f2328;
      background: #fff;
      border: 1px solid #d1d9e0;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    }
    .head, .foot { padding: 0 12px; color: #59636e; font-size: 12px; }
    .head { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .foot { margin-top: 4px; }
    a { color: #007c89; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { list-style: none; margin: 0; padding: 0; }
    li a { display: block; padding: 4px 12px; color: inherit; }
    li a:hover { background: #f0f3f6; text-decoration: none; }
    .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .type { color: #007c89; font-weight: normal; font-size: 11px; margin-left: 6px; }
    .detail { color: #59636e; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { all: unset; cursor: pointer; color: #59636e; padding: 0 2px; }
    @media (prefers-color-scheme: dark) {
      .card { color: #e6edf3; background: #1b1f24; border-color: #3d444d; }
      .head, .foot, .detail, button { color: #9198a1; }
      a, .type { color: #1fa3b1; }
      li a:hover { background: #262c33; }
    }
  `;

  function hide() {
    host?.remove();
    host = null;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  function show(data, rect) {
    hide();
    host = el("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const close = el("button", { textContent: "✕", title: "Close" });
    close.addEventListener("click", hide);

    const items = data.results.map((r) =>
      el("li", {}, [
        el("a", { href: r.url, target: "_blank", rel: "noopener" }, [
          el("div", { className: "title" }, [r.display, el("span", { className: "type", textContent: r.typeLabel })]),
          el("div", { className: "detail", textContent: r.detail }),
        ]),
      ]),
    );
    const more = data.total > data.results.length ? `All ${data.total} results →` : "Open search →";
    const card = el("div", { className: "card" }, [
      el("div", { className: "head" }, [el("span", { textContent: `NetBox · ${data.instanceName}` }), close]),
      el("ul", {}, items),
      el("div", { className: "foot" }, [el("a", { href: data.searchUrl, target: "_blank", rel: "noopener", textContent: more })]),
    ]);
    shadow.append(el("style", { textContent: STYLE }), card);
    document.documentElement.append(host);

    // Below the selection, or above it if there's no room.
    const { height, width } = card.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  function currentSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return null;
    }
    const text = selection.toString().trim();
    if (text.length < MIN_LENGTH || text.length > MAX_LENGTH || /\n/.test(text)) {
      return null;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return null;
    }
    return { text, rect };
  }

  function check() {
    const current = currentSelection();
    if (!current) {
      lastQuery = "";
      return;
    }
    // Same selection as last time: already shown or dismissed.
    if (current.text === lastQuery) {
      return;
    }
    lastQuery = current.text;
    const id = ++requestId;
    let reply;
    try {
      reply = chrome.runtime.sendMessage({ action: "preview", query: current.text });
    } catch {
      // Throws synchronously once the extension was reloaded or disabled.
      stop();
      return;
    }
    reply.then((data) => {
      // Ignore stale answers and selections that changed meanwhile.
      if (id !== requestId || !data?.results?.length) {
        return;
      }
      if (currentSelection()?.text !== current.text) {
        return;
      }
      show(data, current.rect);
    }, stop);
  }

  function stop() {
    document.removeEventListener("mouseup", schedule, true);
    document.removeEventListener("keyup", schedule, true);
  }

  function schedule(event) {
    if (host && event.composedPath().includes(host)) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(check, DELAY_MS);
  }

  document.addEventListener("mouseup", schedule, true);
  document.addEventListener("keyup", schedule, true);
  document.addEventListener(
    "mousedown",
    (event) => {
      if (host && !event.composedPath().includes(host)) {
        requestId++;
        hide();
      }
    },
    true,
  );
  document.addEventListener("keydown", (event) => event.key === "Escape" && hide(), true);
  window.addEventListener("scroll", hide, { passive: true, capture: true });
  window.addEventListener("resize", hide, { passive: true });
})();
