// ==UserScript==
// @name         ChatGPT 快捷删除 / 归档 / 多选批量删除
// @namespace    https://github.com/jujuanel/chatgpt-delete-archive
// @version      2.1.2
// @description  快捷键删除或归档当前对话；侧边栏多选模式（可正常切换对话），批量删除/归档；快捷键可自定义。界面复用 ChatGPT 原生样式与强调色。
// @author       jujuanel
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         https://chatgpt.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 配置
  // ---------------------------------------------------------------------------

  const ACTIONS = {
    deleteCurrent: '删除当前对话',
    archiveCurrent: '归档当前对话',
    toggleMultiSelect: '开启 / 退出多选',
    toggleSelectCurrent: '选中 / 取消选中当前对话',
    deleteSelected: '删除已选对话',
    openSettings: '打开本设置',
  };

  // 快捷键使用 KeyboardEvent.code 表示，避免 macOS 上 Option 组合键改变 e.key
  const DEFAULT_SHORTCUTS = {
    deleteCurrent: 'Alt+Shift+KeyD',
    archiveCurrent: 'Alt+Shift+KeyA',
    toggleMultiSelect: 'Alt+Shift+KeyM',
    toggleSelectCurrent: 'Alt+Shift+KeyS',
    deleteSelected: '',
    openSettings: 'Alt+Shift+Comma',
  };

  const DEFAULT_OPTIONS = {
    confirmDelete: true, // 删除当前对话前使用 ChatGPT 原生确认框
    openNextAfterRemove: false, // 删除 / 归档当前对话后打开侧边栏中的下一个对话
    disabled: {}, // 被关闭的快捷键 { action: true }
    barPos: null, // 多选工具栏位置 { left, top }
  };

  const store = {
    get(key, fallback) {
      try {
        const v = GM_getValue(key);
        return v === undefined ? fallback : v;
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try { GM_setValue(key, value); } catch (_) { /* ignore */ }
    },
  };

  let shortcuts = { ...DEFAULT_SHORTCUTS, ...store.get('shortcuts', {}) };
  let options = { ...DEFAULT_OPTIONS, ...store.get('options', {}) };
  delete options.afterRemove; // v1 遗留字段

  const saveShortcuts = () => store.set('shortcuts', shortcuts);
  const saveOptions = () => store.set('options', options);

  // ---------------------------------------------------------------------------
  // ChatGPT 原生样式（直接复用页面里的 class，跟随浅色 / 深色主题）
  // ---------------------------------------------------------------------------

  const BTN_BASE = 'no-drag cursor-interaction items-center select-none disabled:cursor-default aria-disabled:cursor-default focus:outline-hidden disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 whitespace-nowrap flex border gap-1';
  const CLS = {
    overlay: 'codex-dialog-overlay inset-0 z-50 pointer-events-auto fixed bg-(--color-dialog-overlay)',
    // “Delete chat?” 确认框
    alertDialog: 'codex-dialog z-50 outline-none left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 fixed bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] ring-border shadow-lg backdrop-blur-xl rounded-3xl max-w-[92vw] overflow-hidden w-105',
    // “Keyboard shortcuts” 对话框
    panelDialog: 'codex-dialog z-50 outline-none left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 fixed dark:bg-surface-tertiary text-default bg-surface shadow-lg rounded-2xl max-w-[92vw] overflow-hidden w-150',
    btnCancel: `${BTN_BASE} rounded-button-action border-default bg-primary-soft-alpha not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border px-4 py-1.5 text-base leading-[18px]`,
    btnDanger: `${BTN_BASE} rounded-button-action bg-chart-red/10 not-disabled:not-aria-disabled:hover:bg-chart-red/20 text-chart-red border-transparent px-4 py-1.5 text-base leading-[18px]`,
    btnPrimary: `${BTN_BASE} rounded-button-action border-default bg-primary-solid not-disabled:not-aria-disabled:hover:bg-text/80 text-primary-solid px-4 py-1.5 text-base leading-[18px]`,
    btnRestore: `${BTN_BASE} rounded-full border-default bg-primary-solid not-disabled:not-aria-disabled:hover:bg-text/80 data-[state=open]:bg-text/80 text-primary-solid min-h-9 shrink-0 px-4 text-sm font-medium`,
    btnKey: `${BTN_BASE} rounded-full text-secondary not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent button-toolbar py-0 text-sm leading-[18px]`,
    btnCloseAlert: 'no-drag cursor-interaction leading-none hover:bg-primary-ghost-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 text-text/80 rounded p-1 absolute top-4 right-4',
    btnClosePanel: 'no-drag cursor-interaction leading-none hover:bg-primary-ghost-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 text-text/80 flex items-center justify-center rounded-lg size-8 absolute top-3 right-3',
    keyInput: 'min-w-0 border text-default outline-none placeholder:text-tertiary aria-invalid:border-text-danger aria-invalid:ring-2 aria-invalid:ring-text-danger/20 disabled:cursor-not-allowed disabled:text-secondary w-full h-token-button-composer rounded-md border-transparent bg-transparent px-2 text-sm focus:ring-1 focus:ring-ring focus:border-ring',
    // 下拉菜单浮层（用于多选工具栏 / 提示）
    popover: 'z-50 flex select-none bg-surface-elevated-secondary/90 text-default ring-(--color-border-overlay) ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) backdrop-blur-sm rounded-2xl',
  };

  // ChatGPT 自带图标（sprite），找不到时退回内联 SVG
  const FALLBACK_ICONS = {
    'circle-light-16': '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    'circle-checkmark-fill-light-16': '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="var(--color-surface,#fff)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    'list-checkmark-circle-light-16': '<path d="M2.5 4.5l1 1 2-2M2.5 11l1 1 2-2M8 4.5h6M8 11h6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    'trash-light-16': '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    'archive-light-16': '<path d="M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    'gear-light-16': '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6L5 5M11 11l1.4 1.4M3.6 12.4L5 11M11 5l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    'drag-light-16': '<g fill="currentColor"><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></g>',
    'xmark-md-light-20': '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  };

  function spriteUrl() {
    const use = document.querySelector('use[href*="/cdn/assets/icons-"]');
    return use ? use.getAttribute('href').split('#')[0] : null;
  }

  function icon(name, size = 16, extraClass = '') {
    const sprite = spriteUrl();
    const vb = /-20$/.test(name) ? 20 : 16;
    const inner = sprite
      ? `<use href="${sprite}#${name}" fill="currentColor"></use>`
      : (FALLBACK_ICONS[name] || '');
    return `<svg aria-hidden="true" focusable="false" class="shrink-0 ${extraClass}" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  // 只补充 ChatGPT 没有对应组件的少量样式；颜色全部取自 ChatGPT 的 CSS 变量
  const CSS = `
  /* 强调色跟随 ChatGPT 设置：原生开关等强调色控件使用 --color-chart-blue */
  :root {
    --cgx-accent: var(--color-chart-blue);
    --cgx-sel-bg: var(--app-color-background-accent, color-mix(in oklab, var(--color-chart-blue) 14%, transparent));
  }
  .cgx-removed { display: none !important; }

  .cgx-check {
    position: relative; z-index: 1; pointer-events: auto;
    display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
    width: 20px; height: 20px; margin-inline-start: -2px; border-radius: 9999px;
    color: var(--color-text-tertiary); cursor: pointer;
  }
  .cgx-check:hover { color: var(--color-text-secondary); }
  .cgx-check[aria-checked="true"] { color: var(--cgx-accent); }
  .cgx-selected > :first-child { background-color: var(--cgx-sel-bg) !important; }

  .cgx-toggle[aria-pressed="true"] { color: var(--cgx-accent) !important; }

  .cgx-switch-track { background-color: color-mix(in oklab, var(--color-text) 16%, transparent); }
  .cgx-switch-track[data-state="checked"] { background-color: var(--cgx-accent); }
  .cgx-switch-thumb { background-color: #fff; border-color: transparent; }

  .cgx-bar { position: fixed; z-index: 45; align-items: center; gap: 2px; padding: 4px; touch-action: none; }
  .cgx-bar .cgx-grip { display: flex; align-items: center; padding: 0 2px; color: var(--color-text-tertiary); cursor: grab; }
  .cgx-bar.cgx-dragging, .cgx-bar.cgx-dragging .cgx-grip { cursor: grabbing; }
  .cgx-bar .cgx-count { padding: 0 8px 0 2px; font-size: 14px; white-space: nowrap; cursor: grab; font-variant-numeric: tabular-nums; }
  .cgx-bar .cgx-sep { width: 1px; align-self: stretch; margin: 6px 4px; background: var(--color-border-light, rgba(0,0,0,.1)); }
  .cgx-bar button { height: 32px; padding: 0 10px; }
  .cgx-bar button.cgx-icon-btn { width: 32px; padding: 0; justify-content: center; }

  .cgx-toasts { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 60; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
  .cgx-toast { padding: 8px 14px; font-size: 14px; max-width: min(560px, 90vw); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cgx-toast.cgx-error { color: var(--color-chart-red); }

  .cgx-list { margin: 12px 0 0; padding: 4px 0; max-height: 200px; overflow-y: auto; list-style: none; font-size: 14px; line-height: 20px; color: var(--color-text-secondary); }
  .cgx-list li { padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'cgx-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // 快捷键工具（显示格式与 ChatGPT “Keyboard shortcuts” 一致）
  // ---------------------------------------------------------------------------

  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn'];

  function eventToCombo(e) {
    if (!e.code || MODIFIER_CODES.includes(e.code)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(e.code);
    return parts.join('+');
  }

  function comboHasModifier(combo) {
    return /(^|\+)(Ctrl|Alt|Meta)\+/.test(combo);
  }

  const KEY_NAMES = {
    Enter: '⏎', NumpadEnter: '⏎', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', Space: 'Space', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  };

  function keyName(code) {
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  }

  function prettyCombo(combo) {
    if (!combo) return '';
    const parts = combo.split('+');
    const key = keyName(parts.pop());
    if (IS_MAC) {
      const glyph = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
      return parts.map((p) => glyph[p]).join('') + key;
    }
    return [...parts.map((p) => (p === 'Meta' ? 'Win' : p)), key].join('+');
  }

  function activeCombo(action) {
    return options.disabled[action] ? '' : shortcuts[action];
  }

  function isEditableTarget(node) {
    if (!node) return false;
    if (node.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
  }

  // ---------------------------------------------------------------------------
  // ChatGPT 后端接口
  // ---------------------------------------------------------------------------

  let tokenCache = { token: null, expires: 0 };
  let tokenPromise = null;

  // accessToken 缓存到 JWT 过期前 1 分钟；页面加载后即预取，删除 / 归档时无需再等这一次请求
  function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expires) return Promise.resolve(tokenCache.token);
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (!res.ok) throw new Error(`获取登录信息失败（HTTP ${res.status}）`);
        const data = await res.json();
        const token = data.accessToken;
        if (!token) throw new Error('未登录或无法获取 accessToken');
        let expires = Date.now() + 10 * 60 * 1000;
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.exp) expires = payload.exp * 1000 - 60 * 1000;
        } catch (_) { /* 非 JWT 时使用默认有效期 */ }
        tokenCache = { token, expires };
        return token;
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  async function patchConversation(id, body) {
    const token = await getAccessToken();
    const res = await fetch(`/backend-api/conversation/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) tokenCache = { token: null, expires: 0 };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }

  const deleteConversation = (id) => patchConversation(id, { is_visible: false });
  const archiveConversation = (id) => patchConversation(id, { is_archived: true });

  // ---------------------------------------------------------------------------
  // 页面 / 侧边栏
  // ---------------------------------------------------------------------------

  const CONV_RE = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function idFromHref(href) {
    const m = (href || '').match(CONV_RE);
    return m ? m[1] : null;
  }

  function getCurrentId() {
    return idFromHref(location.pathname);
  }

  function getSidebarLinks() {
    return [...document.querySelectorAll('nav a[href*="/c/"]')].filter((a) => idFromHref(a.getAttribute('href')));
  }

  function linkOf(id) {
    return getSidebarLinks().find((a) => idFromHref(a.getAttribute('href')) === id) || null;
  }

  // 向上找到只包含这一个对话链接的最外层元素，即侧边栏列表中的一整行
  function getRowOf(link) {
    let node = link;
    while (node.parentElement && !node.parentElement.matches('nav') &&
      node.parentElement.querySelectorAll('a[href*="/c/"]').length === 1) {
      node = node.parentElement;
    }
    return node;
  }

  function getVisibleIdsInOrder() {
    const seen = new Set();
    const ids = [];
    for (const a of getSidebarLinks()) {
      const id = idFromHref(a.getAttribute('href'));
      const row = getRowOf(a);
      if (!id || seen.has(id) || removedIds.has(id) || row.offsetParent === null) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  function titleOf(id) {
    const a = linkOf(id);
    if (a) return (a.getAttribute('aria-label') || a.textContent || '').trim();
    if (id === getCurrentId()) return document.title.replace(/\s*[-|]\s*ChatGPT\s*$/, '');
    return id;
  }

  // 已删除 / 归档的对话在侧边栏中隐藏（ChatGPT 本地缓存不会立即刷新）
  const removedIds = new Set();

  function hideRemovedRows() {
    for (const a of getSidebarLinks()) {
      const id = idFromHref(a.getAttribute('href'));
      if (id && removedIds.has(id)) getRowOf(a).classList.add('cgx-removed');
    }
  }

  // 请求失败时把乐观隐藏的对话放回侧边栏
  function restoreRows(ids) {
    for (const id of ids) removedIds.delete(id);
    for (const a of getSidebarLinks()) {
      if (ids.includes(idFromHref(a.getAttribute('href')))) getRowOf(a).classList.remove('cgx-removed');
    }
  }

  // 对话列表（Recents）的分组标题行，不依赖界面语言。
  // Projects 分组里的对话链接是 /g/<project>/c/<id>，Recents 里普通对话是 /c/<id>
  function getRecentsHeader() {
    return [...document.querySelectorAll('nav [class~="group/nav-section-title"]')]
      .find((h) => h.parentElement && h.parentElement.querySelector('a[href^="/c/"]')) || null;
  }

  // ChatGPT 的 React Router 实例，用它跳转与点击侧边栏链接效果相同
  function pageRouter() {
    try {
      const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const router = w.__reactRouterDataRouter;
      return router && typeof router.navigate === 'function' ? router : null;
    } catch (_) {
      return null;
    }
  }

  async function navigateTo(path) {
    const router = pageRouter();
    if (router) {
      try {
        router.navigate(path);
        return;
      } catch (_) { /* 退回到点击 */ }
    }
    let target = null;
    if (path === '/') {
      // “New chat” 链接只响应真实点击；Recents 标题右侧最后一个按钮是 “New chat”
      const header = getRecentsHeader();
      const btns = header ? [...header.lastElementChild.querySelectorAll('button:not(.cgx-toggle)')] : [];
      target = btns[btns.length - 1] || null;
    } else {
      target = [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === path && a.offsetWidth > 0);
    }
    if (target) {
      target.click();
      if (await waitFor(() => location.pathname === path, 1000)) return;
    }
    location.assign(path);
  }

  // 侧边栏中 id 之后（没有则之前）的对话
  function neighborOf(id, exclude) {
    const all = getSidebarLinks().map((a) => idFromHref(a.getAttribute('href')));
    const order = getVisibleIdsInOrder().filter((x) => !exclude.includes(x));
    const idx = all.indexOf(id);
    if (idx < 0) return null;
    return all.slice(idx + 1).find((x) => order.includes(x)) ||
      all.slice(0, idx).reverse().find((x) => order.includes(x)) || null;
  }

  function leaveConversation(removedList, nextId) {
    const current = getCurrentId();
    if (!current || !removedList.includes(current)) return;
    const target = options.openNextAfterRemove ? (nextId || neighborOf(current, removedList)) : null;
    const link = target && linkOf(target);
    navigateTo(link ? link.getAttribute('href') : '/');
  }

  function pressLike(node) {
    const o = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true };
    node.dispatchEvent(new PointerEvent('pointerdown', o));
    node.dispatchEvent(new MouseEvent('mousedown', o));
    node.dispatchEvent(new PointerEvent('pointerup', o));
    node.dispatchEvent(new MouseEvent('mouseup', o));
    node.dispatchEvent(new MouseEvent('click', o));
  }

  async function waitFor(fn, timeout = 1500, step = 50) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  const isNativeDialogOpen = () => !!document.querySelector('.codex-dialog[data-state="open"]:not(.cgx-dialog)');

  // ---------------------------------------------------------------------------
  // 单个对话操作
  // ---------------------------------------------------------------------------

  let busy = false;
  const BATCH_CONCURRENCY = 6;

  // 通过侧边栏该对话的 “…” 菜单打开 ChatGPT 原生的 “Delete chat?” 确认框
  async function openNativeDeleteDialog(id) {
    const a = linkOf(id);
    if (!a) return false;
    const row = getRowOf(a);
    const trigger = row.querySelector('button[aria-haspopup="menu"]');
    if (!trigger) return false;
    pressLike(trigger);
    const item = await waitFor(() => document.querySelector('[role="menu"] [role="menuitem"].text-danger'), 1500, 16);
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    item.click();
    return !!(await waitFor(isNativeDialogOpen, 1500, 16));
  }

  async function deleteCurrent() {
    const id = getCurrentId();
    if (!id) {
      toast('当前不在任何对话中');
      return;
    }
    if (options.confirmDelete) {
      const nextId = neighborOf(id, [id]);
      if (await openNativeDeleteDialog(id)) {
        if (!options.openNextAfterRemove) return;
        // 用户在原生确认框中确认删除后，ChatGPT 会离开该对话；此时再跳到下一个对话
        await waitFor(() => !isNativeDialogOpen(), 10 * 60 * 1000, 150);
        const left = await waitFor(() => getCurrentId() !== id, 3000);
        const link = left && nextId && linkOf(nextId);
        if (link) navigateTo(link.getAttribute('href'));
        return;
      }
      // 侧边栏中找不到该对话（例如侧边栏已收起），使用同样外观的确认框
      const ok = await confirmDialog({
        title: '删除对话？',
        description: `这将永久删除“${titleOf(id)}”，且无法撤销。`,
        confirmText: '删除对话',
        danger: true,
      });
      if (!ok) return;
    }
    removeOne(id, 'delete');
  }

  // 乐观更新：立即离开并隐藏该对话，请求在后台完成；失败时恢复并提示
  async function removeOne(id, kind) {
    const isDelete = kind === 'delete';
    const title = titleOf(id);
    leaveConversation([id]); // 先跳转再隐藏，便于找到相邻对话
    removedIds.add(id);
    selected.delete(id);
    hideRemovedRows();
    renderBar();
    toast(`${isDelete ? '已删除' : '已归档'}“${title}”`);
    try {
      if (isDelete) await deleteConversation(id);
      else await archiveConversation(id);
    } catch (err) {
      restoreRows([id]);
      toast(`${isDelete ? '删除' : '归档'}“${title}”失败（${err.message}），已恢复到侧边栏`, true);
    }
  }

  function archiveCurrent() {
    const id = getCurrentId();
    if (!id) {
      toast('当前不在任何对话中');
      return;
    }
    removeOne(id, 'archive');
  }

  // ---------------------------------------------------------------------------
  // 多选
  // ---------------------------------------------------------------------------

  let multiMode = false;
  const selected = new Set();
  let lastClickedId = null;

  function setMultiMode(on) {
    multiMode = on;
    if (!on) {
      selected.clear();
      lastClickedId = null;
    }
    decorateSidebar();
    renderBar();
    updateToggleButton();
  }

  function toggleSelect(id, force) {
    const want = force === undefined ? !selected.has(id) : force;
    if (want) selected.add(id);
    else selected.delete(id);
    decorateSidebar();
    renderBar();
  }

  function toggleSelectCurrent() {
    const id = getCurrentId();
    if (!id) {
      toast('当前不在任何对话中');
      return;
    }
    if (!multiMode) setMultiMode(true);
    toggleSelect(id);
    lastClickedId = id;
  }

  function renderCheck(check, on) {
    check.setAttribute('aria-checked', String(on));
    check.innerHTML = icon(on ? 'circle-checkmark-fill-light-16' : 'circle-light-16', 18);
  }

  function makeCheck(id) {
    const check = el('span', 'cgx-check');
    check.setAttribute('role', 'checkbox');
    check.dataset.cgxId = id;
    check.title = '选中 / 取消选中';
    renderCheck(check, false);
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    check.addEventListener('pointerdown', stop, true);
    check.addEventListener('mousedown', stop, true);
    check.addEventListener('click', (e) => {
      stop(e);
      // 按住 Shift 点击圆圈：连续选择
      if (e.shiftKey && lastClickedId && lastClickedId !== id) {
        const order = getVisibleIdsInOrder();
        const a = order.indexOf(lastClickedId);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const target = !selected.has(id);
          for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (target) selected.add(x); else selected.delete(x);
          }
          lastClickedId = id;
          decorateSidebar();
          renderBar();
          return;
        }
      }
      toggleSelect(id);
      lastClickedId = id;
    }, true);
    return check;
  }

  function decorateSidebar() {
    hideRemovedRows();
    for (const a of getSidebarLinks()) {
      const id = idFromHref(a.getAttribute('href'));
      const host = a.parentElement;
      if (!host) continue;
      let check = host.querySelector(':scope > .cgx-check');
      if (check && check.dataset.cgxId !== id) {
        check.remove();
        check = null;
      }
      if (multiMode && !check) {
        check = makeCheck(id);
        host.insertBefore(check, host.firstChild);
      } else if (!multiMode && check) {
        check.remove();
        check = null;
      }
      const isSel = multiMode && selected.has(id);
      if (check && check.getAttribute('aria-checked') !== String(isSel)) renderCheck(check, isSel);
      getRowOf(a).classList.toggle('cgx-selected', isSel);
    }
  }

  async function runBatch(kind) {
    const ids = [...selected].filter((id) => !removedIds.has(id));
    if (!ids.length || busy) return;
    const isDelete = kind === 'delete';
    const ok = await confirmDialog({
      title: isDelete ? `删除 ${ids.length} 个对话？` : `归档 ${ids.length} 个对话？`,
      description: isDelete ? '这将永久删除以下对话，且无法撤销。' : '归档后可在 设置 → 数据控制 → 已归档的聊天 中找回。',
      list: ids.map((id) => titleOf(id)),
      confirmText: isDelete ? '删除' : '归档',
      danger: isDelete,
    });
    if (!ok) return;

    // 乐观更新：立即离开、隐藏并退出多选，请求在后台并发完成；失败的对话恢复并重新选中
    busy = true;
    const verb = isDelete ? '删除' : '归档';
    leaveConversation(ids);
    for (const id of ids) removedIds.add(id);
    setMultiMode(false);
    toast(`已${verb} ${ids.length} 个对话`);

    const failed = [];
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          if (isDelete) await deleteConversation(id);
          else await archiveConversation(id);
        } catch (err) {
          failed.push({ id, err });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, ids.length) }, worker));
    busy = false;

    if (failed.length) {
      const failedIds = failed.map((f) => f.id);
      restoreRows(failedIds);
      setMultiMode(true);
      for (const id of failedIds) selected.add(id);
      decorateSidebar();
      renderBar();
      toast(`${failed.length} 个对话${verb}失败（${failed[0].err.message}），已恢复并保持选中`, true);
    }
  }

  // ---------------------------------------------------------------------------
  // UI：侧边栏多选按钮
  // ---------------------------------------------------------------------------

  let toggleBtn = null;

  function ensureToggleButton() {
    if (toggleBtn && toggleBtn.isConnected && !toggleBtn.nextElementSibling) return;
    // 复用 “Recents” 标题右侧原生图标按钮的样式
    const header = getRecentsHeader();
    const slot = header && header.lastElementChild;
    const native = slot && slot.querySelector('button:not(.cgx-toggle)');
    if (!native) return;
    if (!toggleBtn) {
      toggleBtn = native.cloneNode(false);
      for (const attr of [...toggleBtn.attributes]) {
        if (/^(id|aria-|data-state)/.test(attr.name)) toggleBtn.removeAttribute(attr.name);
      }
      toggleBtn.classList.add('cgx-toggle');
      toggleBtn.type = 'button';
      const innerCls = native.firstElementChild ? native.firstElementChild.className : '';
      toggleBtn.innerHTML = `<span class="${innerCls}">${icon('list-checkmark-circle-light-16')}</span>`;
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMultiMode(!multiMode);
      });
    }
    // 固定在最右侧；原生按钮悬停展开时出现在它左边
    slot.appendChild(toggleBtn);
    updateToggleButton();
  }

  function updateToggleButton() {
    if (!toggleBtn) return;
    toggleBtn.setAttribute('aria-pressed', String(multiMode));
    const combo = prettyCombo(activeCombo('toggleMultiSelect'));
    const label = multiMode ? '退出多选' : '多选';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.title = combo ? `${label}（${combo}）` : label;
  }

  // ---------------------------------------------------------------------------
  // UI：多选工具栏（可拖动的浮层，样式同 ChatGPT 下拉菜单）
  // ---------------------------------------------------------------------------

  let bar = null;

  function renderBar(progressText) {
    if (!multiMode) {
      if (bar) bar.remove();
      bar = null;
      return;
    }
    const fresh = !bar || !bar.isConnected;
    if (fresh) {
      bar = el('div', `${CLS.popover} cgx-bar`);
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '多选');
      document.body.appendChild(bar);
      enableDrag(bar);
    }
    const n = [...selected].filter((id) => !removedIds.has(id)).length;
    bar.innerHTML = '';

    const grip = el('span', 'cgx-grip', icon('drag-light-16'));
    grip.title = '拖动';
    bar.appendChild(grip);
    const count = el('span', 'cgx-count');
    count.textContent = progressText || (n ? `已选 ${n} 项` : '未选择对话');
    count.title = `点击对话左侧圆圈，或按 ${prettyCombo(activeCombo('toggleSelectCurrent')) || '快捷键'} 选中正在查看的对话`;
    bar.appendChild(count);

    const mk = (html, onClick, { disabled, title, danger, iconOnly } = {}) => {
      const b = el('button', `${danger ? CLS.btnKey.replace('text-secondary', 'text-chart-red') : CLS.btnKey}${iconOnly ? ' cgx-icon-btn' : ''}`, html);
      b.type = 'button';
      b.disabled = !!disabled || busy;
      if (title) {
        b.title = title;
        b.setAttribute('aria-label', title);
      }
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };

    const ids = getVisibleIdsInOrder();
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    mk(allOn ? '取消全选' : '全选', () => {
      for (const id of getVisibleIdsInOrder()) { if (allOn) selected.delete(id); else selected.add(id); }
      decorateSidebar();
      renderBar();
    }, { title: '选中侧边栏中已加载的全部对话' });
    bar.appendChild(el('span', 'cgx-sep'));
    mk(`${icon('archive-light-16')}<span>归档</span>`, () => runBatch('archive'), { disabled: n === 0 });
    const delCombo = prettyCombo(activeCombo('deleteSelected'));
    mk(`${icon('trash-light-16')}<span>删除</span>`, () => runBatch('delete'), { disabled: n === 0, danger: true, title: delCombo ? `删除（${delCombo}）` : '' });
    bar.appendChild(el('span', 'cgx-sep'));
    mk(icon('gear-light-16'), openSettings, { iconOnly: true, title: '设置' });
    const exitCombo = prettyCombo(activeCombo('toggleMultiSelect'));
    mk(icon('xmark-md-light-20', 16), () => setMultiMode(false), { iconOnly: true, title: exitCombo ? `退出多选（${exitCombo}）` : '退出多选' });

    if (fresh) placeBar();
  }

  function placeBar() {
    if (!bar) return;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    let { left, top } = options.barPos || {};
    if (typeof left !== 'number') {
      // 默认：主内容区顶部居中（标题栏下方），不遮挡侧边栏和输入框
      const nav = document.querySelector('nav');
      const side = nav && nav.closest('aside, [role="complementary"]');
      const sr = side ? side.getBoundingClientRect() : null;
      const mainLeft = sr && sr.width > 100 ? sr.right : 0;
      left = mainLeft + (window.innerWidth - mainLeft - w) / 2;
      top = 64;
    }
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  function enableDrag(node) {
    let start = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      node.setPointerCapture(e.pointerId);
      node.classList.add('cgx-dragging');
    });
    node.addEventListener('pointermove', (e) => {
      if (!start) return;
      const left = Math.min(Math.max(8, start.left + e.clientX - start.x), window.innerWidth - node.offsetWidth - 8);
      const top = Math.min(Math.max(8, start.top + e.clientY - start.y), window.innerHeight - node.offsetHeight - 8);
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
    });
    const end = () => {
      if (!start) return;
      start = null;
      node.classList.remove('cgx-dragging');
      options.barPos = { left: parseFloat(node.style.left), top: parseFloat(node.style.top) };
      saveOptions();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      options.barPos = null; // 双击复位
      saveOptions();
      placeBar();
    });
  }

  // ---------------------------------------------------------------------------
  // UI：提示
  // ---------------------------------------------------------------------------

  let toastBox = null;
  function toast(msg, isError = false) {
    if (!toastBox || !toastBox.isConnected) {
      toastBox = el('div', 'cgx-toasts');
      document.body.appendChild(toastBox);
    }
    const t = el('div', `${CLS.popover} cgx-toast${isError ? ' cgx-error' : ''}`);
    t.setAttribute('role', 'status');
    t.textContent = msg;
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), isError ? 5000 : 2500);
  }

  // ---------------------------------------------------------------------------
  // UI：对话框（结构与 class 取自 ChatGPT 原生对话框）
  // ---------------------------------------------------------------------------

  function openModal(dialogCls, labelText) {
    const overlay = el('div', CLS.overlay);
    overlay.setAttribute('data-state', 'open');
    const dialog = el('div', `${dialogCls} cgx-dialog`);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', labelText);
    dialog.setAttribute('data-state', 'open');
    dialog.tabIndex = -1;
    document.body.append(overlay, dialog);
    const close = () => {
      overlay.remove();
      dialog.remove();
    };
    return { overlay, dialog, close };
  }

  function confirmDialog({ title, description, list, confirmText, danger }) {
    return new Promise((resolve) => {
      const { overlay, dialog, close } = openModal(CLS.alertDialog, title);
      const form = el('form', 'flex flex-col text-base leading-normal tracking-normal gap-0');
      form.style.padding = '20px';
      const head = el('div', 'flex min-w-0 flex-1 flex-col gap-1 self-stretch');
      const h = el('div', 'heading-dialog min-w-0 font-semibold');
      h.textContent = title;
      h.style.paddingRight = '28px';
      const p = el('div', 'text-codex-description text-base leading-normal tracking-normal');
      p.textContent = description;
      head.append(h, p);
      form.appendChild(head);
      if (list && list.length) {
        const ul = el('ul', 'cgx-list');
        for (const line of list) {
          const li = el('li');
          li.textContent = line;
          li.title = line;
          ul.appendChild(li);
        }
        form.appendChild(ul);
      }
      const footer = el('div', 'flex w-full flex-wrap items-center justify-end gap-3');
      footer.style.paddingTop = '12px';
      const cancel = el('button', CLS.btnCancel);
      cancel.type = 'button';
      cancel.textContent = '取消';
      const ok = el('button', danger ? CLS.btnDanger : CLS.btnPrimary);
      ok.type = 'submit';
      ok.textContent = confirmText;
      footer.append(cancel, ok);
      form.appendChild(footer);
      const x = el('button', CLS.btnCloseAlert, `${icon('xmark-md-light-20', 20)}<span class="sr-only">关闭</span>`);
      x.type = 'button';
      dialog.append(form, x);

      const done = (v) => {
        document.removeEventListener('keydown', onKey, true);
        close();
        resolve(v);
      };
      const onKey = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
      };
      document.addEventListener('keydown', onKey, true);
      form.addEventListener('submit', (e) => { e.preventDefault(); done(true); });
      cancel.addEventListener('click', () => done(false));
      x.addEventListener('click', () => done(false));
      overlay.addEventListener('pointerdown', () => done(false));
      cancel.focus();
    });
  }

  // ---- 设置（仿 ChatGPT “Keyboard shortcuts” 对话框，修改即时生效） ----

  let settingsOpen = false;

  function makeSwitch(checked, labelledBy, onChange) {
    const btn = el('button', 'inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-full cursor-interaction');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-labelledby', labelledBy);
    const track = el('span', 'cgx-switch-track relative inline-flex shrink-0 items-center rounded-full transition-colors duration-basic ease-out h-5 w-8');
    const thumb = el('span', 'cgx-switch-thumb rounded-full border shadow-sm transition-transform duration-basic ease-out data-[state=unchecked]:translate-x-0 h-4 w-4 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px]');
    track.appendChild(thumb);
    btn.appendChild(track);
    const set = (v) => {
      const s = v ? 'checked' : 'unchecked';
      btn.setAttribute('aria-checked', String(v));
      for (const n of [btn, track, thumb]) n.setAttribute('data-state', s);
    };
    set(checked);
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('aria-checked') !== 'true';
      set(v);
      onChange(v);
    });
    btn.setChecked = set;
    return btn;
  }

  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;
    const { overlay, dialog, close } = openModal(CLS.panelDialog, '设置');
    const uid = () => `cgx-${Math.random().toString(36).slice(2, 9)}`;

    const outer = el('div', 'flex flex-col text-base leading-normal tracking-normal gap-0 overflow-hidden');
    outer.style.maxHeight = 'min(85dvh, 704px)';
    const header = el('div', 'flex flex-col items-start gap-3 shrink-0 px-12 pt-6 pb-2',
      '<div class="flex min-w-0 flex-1 flex-col gap-1 self-stretch"><div class="heading-base min-w-0 font-semibold text-center text-base leading-6"><h2>删除 / 归档 / 多选</h2></div></div>');
    const middle = el('div', 'flex min-h-0 flex-1 flex-col');
    const scroller = el('div', 'min-h-0 flex-1 scrollbar-stable overflow-y-auto');
    const content = el('div', 'flex flex-col gap-8 py-4');
    const hint = el('p', 'px-6 text-sm leading-5 text-secondary select-none');
    hint.textContent = '要修改快捷键，请点击组合键，然后按下新的按键。修改即时生效。';
    content.appendChild(hint);

    const section = (titleText) => {
      const sec = el('section', 'flex flex-col');
      const h3 = el('h3', 'sticky top-0 z-10 bg-surface px-6 py-0.5 text-sm leading-6 font-medium text-secondary dark:bg-surface-tertiary');
      h3.textContent = titleText;
      const ul = el('ul', 'flex list-none flex-col px-3');
      sec.append(h3, ul);
      content.appendChild(sec);
      return ul;
    };
    const row = (ul, labelText, sw) => {
      const li = el('li', 'scroll-mt-12 scroll-mb-24 border-b border-subtle last:border-b-0');
      const line = el('div', 'flex min-h-12 items-center gap-2 py-2 ps-4 pe-3');
      const id = uid();
      const label = el('label', 'min-w-0 flex-1 cursor-interaction truncate text-sm leading-5 font-normal text-default select-none');
      label.id = id;
      label.textContent = labelText;
      const switchEl = sw(id);
      label.addEventListener('click', () => switchEl.click());
      line.append(switchEl, label);
      li.appendChild(line);
      ul.appendChild(li);
      return line;
    };

    // 快捷键
    const keysUl = section('快捷键');
    const keySlots = {};
    let recording = null;

    const renderKey = (action) => {
      const slot = keySlots[action];
      slot.innerHTML = '';
      if (recording === action) {
        const wrap = el('span', 'w-40 max-w-full');
        const input = el('input', CLS.keyInput);
        input.readOnly = true;
        input.placeholder = '按下组合键';
        input.setAttribute('aria-label', '按下新的组合键');
        input.addEventListener('blur', () => {
          if (recording === action) { recording = null; renderKey(action); }
        });
        wrap.appendChild(input);
        slot.appendChild(wrap);
        input.focus();
        return;
      }
      const b = el('button', CLS.btnKey);
      b.type = 'button';
      const combo = shortcuts[action];
      b.textContent = combo ? prettyCombo(combo) : '未设置';
      if (!combo) b.classList.add('text-tertiary');
      b.setAttribute('aria-label', `修改“${ACTIONS[action]}”的快捷键`);
      b.disabled = !!options.disabled[action];
      b.addEventListener('click', () => {
        const prev = recording;
        recording = action;
        if (prev && prev !== action) renderKey(prev);
        renderKey(action);
      });
      slot.appendChild(b);
    };

    const switches = {};
    for (const action of Object.keys(ACTIONS)) {
      const line = row(keysUl, ACTIONS[action], (id) => {
        switches[action] = makeSwitch(!options.disabled[action], id, (v) => {
          if (v) delete options.disabled[action];
          else options.disabled[action] = true;
          saveOptions();
          renderKey(action);
          afterChange();
        });
        return switches[action];
      });
      const slot = el('span', 'inline-flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1');
      keySlots[action] = slot;
      line.appendChild(slot);
      renderKey(action);
    }

    // 行为
    const behaviorUl = section('行为');
    const confirmSw = { el: null };
    row(behaviorUl, '删除当前对话前确认（使用 ChatGPT 原生确认框）', (id) => {
      confirmSw.el = makeSwitch(options.confirmDelete, id, (v) => { options.confirmDelete = v; saveOptions(); afterChange(); });
      return confirmSw.el;
    });
    const nextSw = { el: null };
    row(behaviorUl, '删除或归档当前对话后，打开侧边栏中的下一个对话', (id) => {
      nextSw.el = makeSwitch(options.openNextAfterRemove, id, (v) => { options.openNextAfterRemove = v; saveOptions(); afterChange(); });
      return nextSw.el;
    });

    scroller.appendChild(content);
    middle.appendChild(scroller);
    const footer = el('div', 'flex items-center justify-end gap-3 border-t border-primary-outline bg-surface px-3 py-3 dark:bg-surface-tertiary');
    const restore = el('button', CLS.btnRestore);
    restore.type = 'button';
    restore.textContent = '恢复默认';
    footer.appendChild(restore);
    middle.appendChild(footer);
    outer.append(header, middle);
    const x = el('button', CLS.btnClosePanel, `${icon('xmark-md-light-20', 20)}<span class="sr-only">关闭</span>`);
    x.type = 'button';
    dialog.append(outer, x);

    const isDefault = () =>
      JSON.stringify(shortcuts) === JSON.stringify(DEFAULT_SHORTCUTS) &&
      options.confirmDelete === DEFAULT_OPTIONS.confirmDelete &&
      options.openNextAfterRemove === DEFAULT_OPTIONS.openNextAfterRemove &&
      Object.keys(options.disabled).length === 0;
    function afterChange() {
      restore.disabled = isDefault();
      updateToggleButton();
      if (bar) renderBar();
    }
    afterChange();

    restore.addEventListener('click', () => {
      shortcuts = { ...DEFAULT_SHORTCUTS };
      options.confirmDelete = DEFAULT_OPTIONS.confirmDelete;
      options.openNextAfterRemove = DEFAULT_OPTIONS.openNextAfterRemove;
      options.disabled = {};
      saveShortcuts();
      saveOptions();
      recording = null;
      for (const action of Object.keys(ACTIONS)) {
        switches[action].setChecked(true);
        renderKey(action);
      }
      confirmSw.el.setChecked(options.confirmDelete);
      nextSw.el.setChecked(options.openNextAfterRemove);
      afterChange();
    });

    const finish = () => {
      settingsOpen = false;
      document.removeEventListener('keydown', onKey, true);
      close();
    };
    const onKey = (e) => {
      e.stopPropagation(); // 设置打开时不触发任何页面快捷键
      if (recording) {
        e.preventDefault();
        if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          const a = recording;
          recording = null;
          renderKey(a);
          return;
        }
        const combo = eventToCombo(e);
        if (!combo) return;
        const input = keySlots[recording].querySelector('input');
        const clash = Object.keys(ACTIONS).find((k) => k !== recording && shortcuts[k] === combo);
        if (clash) {
          input.setAttribute('aria-invalid', 'true');
          input.value = '';
          input.placeholder = `已被“${ACTIONS[clash]}”使用`;
          return;
        }
        const a = recording;
        shortcuts[a] = combo;
        saveShortcuts();
        recording = null;
        renderKey(a);
        afterChange();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('pointerdown', finish);
    x.addEventListener('click', finish);
    dialog.focus();
  }

  // ---------------------------------------------------------------------------
  // 全局快捷键
  // ---------------------------------------------------------------------------

  const HANDLERS = {
    deleteCurrent,
    archiveCurrent,
    toggleMultiSelect: () => setMultiMode(!multiMode),
    toggleSelectCurrent,
    deleteSelected: () => { if (multiMode) runBatch('delete'); },
    openSettings,
  };

  function onKeyDown(e) {
    if (e.isComposing || e.repeat || settingsOpen) return;
    if (document.querySelector('.cgx-dialog') || isNativeDialogOpen()) return;
    const combo = eventToCombo(e);
    if (!combo) return;
    for (const action of Object.keys(HANDLERS)) {
      const sc = activeCombo(action);
      if (!sc || sc !== combo) continue;
      if (!comboHasModifier(sc) && isEditableTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      HANDLERS[action]();
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------

  function init() {
    injectStyle();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', () => { if (bar) placeBar(); });

    try {
      GM_registerMenuCommand('设置', openSettings);
      GM_registerMenuCommand('开启 / 退出多选', () => setMultiMode(!multiMode));
    } catch (_) { /* ignore */ }

    let scheduled = false;
    let lastPath = location.pathname;
    const tick = () => {
      scheduled = false;
        ensureToggleButton();
      if (multiMode || removedIds.size) decorateSidebar();
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        if (multiMode) renderBar();
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(tick);
    };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'href'] });
    tick();
    getAccessToken().catch(() => { /* 未登录时忽略，操作时会再提示 */ });
  }

  init();
})();
