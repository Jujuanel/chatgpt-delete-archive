// ==UserScript==
// @name         ChatGPT 快捷删除 / 归档 / 多选批量删除
// @namespace    https://github.com/jujuanel/chatgpt-delete-archive
// @version      1.0.0
// @description  快捷键直接删除或归档当前对话；侧边栏多选模式（可正常切换对话），批量删除/归档；快捷键可自定义。
// @author       jujuanel
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         https://chatgpt.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 配置
  // ---------------------------------------------------------------------------

  const ACTIONS = {
    deleteCurrent: '删除当前对话（无确认）',
    archiveCurrent: '归档当前对话',
    toggleMultiSelect: '开启 / 退出多选模式',
    toggleSelectCurrent: '多选：选中 / 取消选中当前对话',
    deleteSelected: '多选：删除已选对话（需确认）',
    openSettings: '打开设置',
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
    // 删除/归档当前对话后跳转：'new' 新对话，'next' 侧边栏中相邻的下一个对话
    afterRemove: 'new',
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

  // ---------------------------------------------------------------------------
  // 快捷键工具
  // ---------------------------------------------------------------------------

  const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

  function eventToCombo(e) {
    if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
      return null;
    }
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

  function prettyCombo(combo) {
    if (!combo) return '未设置';
    return combo.split('+').map((p) => {
      if (MOD_ORDER.includes(p)) {
        if (!IS_MAC) return p === 'Meta' ? 'Win' : p;
        return { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }[p];
      }
      return p
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .replace(/^Numpad/, 'Num')
        .replace(/^Arrow/, '')
        .replace('Backspace', '⌫')
        .replace('Comma', ',')
        .replace('Period', '.')
        .replace('Slash', '/')
        .replace('Semicolon', ';')
        .replace('Quote', "'")
        .replace('BracketLeft', '[')
        .replace('BracketRight', ']')
        .replace('Backslash', '\\')
        .replace('Minus', '-')
        .replace('Equal', '=')
        .replace('Backquote', '`');
    }).join(IS_MAC ? '' : '+');
  }

  function isEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  // ---------------------------------------------------------------------------
  // ChatGPT 后端接口
  // ---------------------------------------------------------------------------

  let tokenCache = { token: null, expires: 0 };

  async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error(`获取登录信息失败（HTTP ${res.status}）`);
    const data = await res.json();
    if (!data.accessToken) throw new Error('未登录或无法获取 accessToken');
    tokenCache = { token: data.accessToken, expires: Date.now() + 5 * 60 * 1000 };
    return data.accessToken;
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

  // 向上找到只包含这一个对话链接的最外层元素，即侧边栏列表中的一整行
  function getRowOf(link) {
    let el = link;
    while (el.parentElement && !el.parentElement.matches('nav') &&
      el.parentElement.querySelectorAll('a[href*="/c/"]').length === 1) {
      el = el.parentElement;
    }
    return el;
  }

  function getVisibleIdsInOrder() {
    const seen = new Set();
    const ids = [];
    for (const a of getSidebarLinks()) {
      const id = idFromHref(a.getAttribute('href'));
      const row = getRowOf(a);
      if (!id || seen.has(id) || removedIds.has(id) || (row && row.offsetParent === null)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  function titleOf(id) {
    const a = getSidebarLinks().find((l) => idFromHref(l.getAttribute('href')) === id);
    if (a) return (a.getAttribute('aria-label') || a.textContent || '').trim();
    if (id === getCurrentId()) return document.title.replace(/\s*[-|]\s*ChatGPT\s*$/, '');
    return id;
  }

  // 已删除 / 归档的对话在侧边栏中隐藏（ChatGPT 本地缓存不会立即刷新）
  const removedIds = new Set();

  function hideRemovedRows() {
    for (const a of getSidebarLinks()) {
      const id = idFromHref(a.getAttribute('href'));
      if (id && removedIds.has(id)) {
        const row = getRowOf(a);
        if (row) row.classList.add('cgx-removed');
      }
    }
  }

  function navigateTo(path) {
    const link = [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === path);
    if (link) {
      link.click();
      return;
    }
    // React Router 监听 popstate，可实现无刷新跳转
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  function leaveConversation(removedList) {
    const current = getCurrentId();
    if (!current || !removedList.includes(current)) return;
    if (options.afterRemove === 'next') {
      const order = getVisibleIdsInOrder();
      // getVisibleIdsInOrder 已排除 removedIds，这里需要在移除前的顺序里找相邻项
      const all = getSidebarLinks().map((a) => idFromHref(a.getAttribute('href')));
      const idx = all.indexOf(current);
      const after = all.slice(idx + 1).find((id) => order.includes(id));
      const before = all.slice(0, Math.max(idx, 0)).reverse().find((id) => order.includes(id));
      const target = after || before;
      if (target) {
        const a = getSidebarLinks().find((l) => idFromHref(l.getAttribute('href')) === target);
        navigateTo(a.getAttribute('href'));
        return;
      }
    }
    navigateTo('/');
  }

  // ---------------------------------------------------------------------------
  // 单个对话操作
  // ---------------------------------------------------------------------------

  let busy = false;

  async function removeCurrent(kind) {
    const id = getCurrentId();
    if (!id) {
      toast('当前不在任何对话中', 'warn');
      return;
    }
    if (busy) return;
    busy = true;
    const title = titleOf(id);
    try {
      if (kind === 'delete') await deleteConversation(id);
      else await archiveConversation(id);
      // 先跳转再隐藏，便于 "next" 模式找到相邻对话
      leaveConversation([id]);
      removedIds.add(id);
      selected.delete(id);
      hideRemovedRows();
      renderBar();
      toast(`${kind === 'delete' ? '已删除' : '已归档'}：${title}`, 'ok');
    } catch (err) {
      toast(`${kind === 'delete' ? '删除' : '归档'}失败：${err.message}`, 'error');
    } finally {
      busy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // 多选
  // ---------------------------------------------------------------------------

  let multiMode = false;
  const selected = new Set();
  let lastClickedId = null;

  function setMultiMode(on) {
    multiMode = on;
    document.documentElement.classList.toggle('cgx-multi', on);
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
      toast('当前不在任何对话中', 'warn');
      return;
    }
    if (!multiMode) setMultiMode(true);
    toggleSelect(id);
    lastClickedId = id;
    toast(selected.has(id) ? `已选中：${titleOf(id)}` : `已取消选中：${titleOf(id)}`, 'info', 1200);
  }

  function makeCheck(id) {
    const btn = document.createElement('span');
    btn.className = 'cgx-check';
    btn.setAttribute('role', 'checkbox');
    btn.setAttribute('tabindex', '-1');
    btn.dataset.cgxId = id;
    btn.title = '选中 / 取消选中（Shift+点击可连续选择）';
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    btn.addEventListener('pointerdown', stop, true);
    btn.addEventListener('mousedown', stop, true);
    btn.addEventListener('click', (e) => {
      stop(e);
      if (e.shiftKey && lastClickedId && lastClickedId !== id) {
        const order = getVisibleIdsInOrder();
        const a = order.indexOf(lastClickedId);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const target = !selected.has(id);
          for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (target) selected.add(x); else selected.delete(x);
          }
          decorateSidebar();
          renderBar();
          lastClickedId = id;
          return;
        }
      }
      toggleSelect(id);
      lastClickedId = id;
    }, true);
    return btn;
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
      const row = getRowOf(a);
      const isSel = multiMode && selected.has(id);
      if (check) check.setAttribute('aria-checked', String(isSel));
      if (row) row.classList.toggle('cgx-selected', isSel);
    }
  }

  async function runBatch(kind) {
    const ids = [...selected].filter((id) => !removedIds.has(id));
    if (!ids.length) {
      toast('还没有选中任何对话', 'warn');
      return;
    }
    const verb = kind === 'delete' ? '删除' : '归档';
    const ok = await confirmDialog({
      title: `${verb} ${ids.length} 个对话？`,
      body: ids.map((id) => titleOf(id)),
      danger: kind === 'delete',
      confirmText: verb,
      note: kind === 'delete' ? '删除后无法在侧边栏恢复。' : '归档后可在 设置 → 数据控制 → 已归档的聊天 中找回。',
    });
    if (!ok) return;

    busy = true;
    renderBar(`${verb}中… 0/${ids.length}`);
    const failed = [];
    const done = [];
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          if (kind === 'delete') await deleteConversation(id);
          else await archiveConversation(id);
          done.push(id);
        } catch (err) {
          failed.push({ id, err });
        }
        renderBar(`${verb}中… ${done.length + failed.length}/${ids.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    leaveConversation(done);
    for (const id of done) {
      removedIds.add(id);
      selected.delete(id);
    }
    busy = false;
    decorateSidebar();
    if (failed.length) {
      toast(`已${verb} ${done.length} 个，${failed.length} 个失败（${failed[0].err.message}），失败项仍保持选中`, 'error', 5000);
      renderBar();
    } else {
      toast(`已${verb} ${done.length} 个对话`, 'ok');
      setMultiMode(false);
    }
  }

  // ---------------------------------------------------------------------------
  // UI：多选工具栏 / 侧边栏按钮 / Toast / 确认框 / 设置
  // ---------------------------------------------------------------------------

  const CSS = `
  :root {
    --cgx-accent: #10a37f;
    --cgx-danger: #e5484d;
    --cgx-bg: #ffffff;
    --cgx-fg: #0d0d0d;
    --cgx-muted: #6b6b6b;
    --cgx-border: rgba(0,0,0,.1);
    --cgx-hover: rgba(0,0,0,.05);
    --cgx-sel: rgba(16,163,127,.12);
    --cgx-shadow: 0 8px 28px rgba(0,0,0,.16);
  }
  html.dark, html[data-theme="dark"], .dark {
    --cgx-bg: #2a2a2a;
    --cgx-fg: #ececec;
    --cgx-muted: #a0a0a0;
    --cgx-border: rgba(255,255,255,.12);
    --cgx-hover: rgba(255,255,255,.07);
    --cgx-sel: rgba(16,163,127,.22);
    --cgx-shadow: 0 8px 28px rgba(0,0,0,.5);
  }
  .cgx-removed { display: none !important; }

  .cgx-check {
    position: relative; z-index: 1; pointer-events: auto;
    flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%;
    border: 1.5px solid var(--cgx-muted); color: transparent;
    cursor: pointer; transition: background .12s, border-color .12s, transform .12s;
  }
  .cgx-check:hover { border-color: var(--cgx-accent); transform: scale(1.08); }
  .cgx-check svg { width: 12px; height: 12px; }
  .cgx-check[aria-checked="true"] { background: var(--cgx-accent); border-color: var(--cgx-accent); color: #fff; }
  .cgx-selected > :first-child { background-color: var(--cgx-sel); border-radius: 10px; }

  .cgx-toggle {
    display: inline-flex; align-items: center; gap: 4px;
    height: 24px; padding: 0 8px; border-radius: 999px;
    font-size: 12px; line-height: 1; color: var(--cgx-muted);
    border: 1px solid var(--cgx-border); background: transparent; cursor: pointer;
  }
  .cgx-toggle:hover { background: var(--cgx-hover); color: var(--cgx-fg); }
  .cgx-toggle.cgx-on { background: var(--cgx-accent); border-color: var(--cgx-accent); color: #fff; }
  .cgx-toggle svg { width: 13px; height: 13px; }

  .cgx-bar {
    position: fixed; left: 16px; bottom: 16px; width: 300px;
    z-index: 2147483000; display: flex; flex-direction: column; gap: 8px;
    padding: 10px; border-radius: 14px; box-sizing: border-box;
    background: var(--cgx-bg); color: var(--cgx-fg);
    border: 1px solid var(--cgx-border); box-shadow: var(--cgx-shadow);
    font-size: 13px; font-family: inherit;
  }
  .cgx-bar-row { display: flex; align-items: center; gap: 4px; }
  .cgx-bar-row > .cgx-btn.cgx-grow { flex: 1; }
  .cgx-bar .cgx-count { font-weight: 600; margin-right: auto; padding-left: 4px; white-space: nowrap; }
  .cgx-bar .cgx-hint { color: var(--cgx-muted); font-size: 12px; padding: 0 4px; line-height: 1.4; }
  .cgx-btn.cgx-ghost { border-color: transparent; height: 26px; padding: 0 8px; font-size: 12px; color: var(--cgx-muted); }
  .cgx-btn.cgx-ghost:hover:not(:disabled) { color: var(--cgx-fg); }
  .cgx-btn {
    height: 30px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--cgx-border);
    background: transparent; color: var(--cgx-fg); font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  .cgx-btn:hover:not(:disabled) { background: var(--cgx-hover); }
  .cgx-btn:disabled { opacity: .45; cursor: default; }
  .cgx-btn.cgx-danger { background: var(--cgx-danger); border-color: var(--cgx-danger); color: #fff; }
  .cgx-btn.cgx-danger:hover:not(:disabled) { filter: brightness(1.08); background: var(--cgx-danger); }
  .cgx-btn.cgx-primary { background: var(--cgx-accent); border-color: var(--cgx-accent); color: #fff; }
  .cgx-btn.cgx-icon { width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
  .cgx-btn.cgx-icon svg { width: 16px; height: 16px; }

  .cgx-toasts { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
  .cgx-toast {
    padding: 9px 14px; border-radius: 10px; font-size: 13px; max-width: 80vw;
    background: var(--cgx-bg); color: var(--cgx-fg); border: 1px solid var(--cgx-border); box-shadow: var(--cgx-shadow);
    border-left: 4px solid var(--cgx-accent); animation: cgx-in .15s ease-out;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cgx-toast.cgx-error { border-left-color: var(--cgx-danger); }
  .cgx-toast.cgx-warn { border-left-color: #f5a524; }
  .cgx-toast.cgx-info { border-left-color: var(--cgx-muted); }
  @keyframes cgx-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  .cgx-overlay {
    position: fixed; inset: 0; z-index: 2147483646; background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  .cgx-modal {
    width: 440px; max-width: 100%; max-height: calc(100vh - 32px); overflow: auto;
    background: var(--cgx-bg); color: var(--cgx-fg); border-radius: 16px; box-shadow: var(--cgx-shadow);
    padding: 20px; font-size: 14px; font-family: inherit;
  }
  .cgx-modal h3 { margin: 0 0 12px; font-size: 17px; font-weight: 600; }
  .cgx-modal .cgx-list { margin: 0 0 12px; padding: 8px 10px; max-height: 240px; overflow: auto; border: 1px solid var(--cgx-border); border-radius: 10px; list-style: none; }
  .cgx-modal .cgx-list li { padding: 3px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cgx-modal .cgx-note { color: var(--cgx-muted); font-size: 12px; margin: 0 0 16px; }
  .cgx-modal .cgx-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .cgx-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--cgx-border); }
  .cgx-row:last-child { border-bottom: 0; }
  .cgx-row .cgx-label { flex: 1; min-width: 0; }
  .cgx-key {
    min-width: 120px; height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--cgx-border);
    background: var(--cgx-hover); color: var(--cgx-fg); font-size: 13px; cursor: pointer; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .cgx-key.cgx-recording { border-color: var(--cgx-accent); box-shadow: 0 0 0 2px var(--cgx-sel); }
  .cgx-key.cgx-conflict { border-color: var(--cgx-danger); }
  .cgx-clear { background: none; border: 0; color: var(--cgx-muted); cursor: pointer; font-size: 16px; padding: 0 4px; }
  .cgx-select { height: 30px; border-radius: 8px; border: 1px solid var(--cgx-border); background: var(--cgx-bg); color: var(--cgx-fg); padding: 0 8px; }
  .cgx-section { margin: 14px 0 4px; font-size: 12px; color: var(--cgx-muted); text-transform: uppercase; letter-spacing: .04em; }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'cgx-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  const ICON_MULTI = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="4" cy="4.5" r="2"/><path d="M8 4.5h6"/><circle cx="4" cy="11.5" r="2"/><path d="M8 11.5h6"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const ICON_GEAR = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>';

  // ---- Toast ----
  let toastBox = null;
  function toast(msg, type = 'ok', ms = 2600) {
    if (!toastBox || !toastBox.isConnected) {
      toastBox = document.createElement('div');
      toastBox.className = 'cgx-toasts';
      document.body.appendChild(toastBox);
    }
    const el = document.createElement('div');
    el.className = `cgx-toast cgx-${type}`;
    el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---- 侧边栏的多选开关 ----
  let toggleBtn = null;
  function ensureToggleButton() {
    if (toggleBtn && toggleBtn.isConnected) return;
    const anchor = document.querySelector('nav button[aria-label="Chat sidebar options"], nav button[aria-label="Filter chats and work"]');
    const holder = anchor && anchor.closest('[class~="group/nav-section-title"]');
    const slot = holder && holder.lastElementChild;
    if (!slot) {
      // 侧边栏收起或结构变化时不显示按钮，可用快捷键或脚本菜单开启
      if (toggleBtn && toggleBtn.isConnected) toggleBtn.remove();
      return;
    }
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'cgx-toggle';
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMultiMode(!multiMode);
      });
    }
    slot.insertBefore(toggleBtn, slot.firstChild);
    updateToggleButton();
  }

  function updateToggleButton() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('cgx-on', multiMode);
    toggleBtn.innerHTML = `${ICON_MULTI}<span>${multiMode ? '完成' : '多选'}</span>`;
    toggleBtn.title = `${multiMode ? '退出' : '开启'}多选模式（${prettyCombo(shortcuts.toggleMultiSelect)}）`;
  }

  // ---- 底部多选工具栏 ----
  let bar = null;
  function renderBar(progressText) {
    if (!multiMode) {
      if (bar) bar.remove();
      bar = null;
      return;
    }
    if (!bar || !bar.isConnected) {
      bar = document.createElement('div');
      bar.className = 'cgx-bar';
      document.body.appendChild(bar);
    }
    const n = [...selected].filter((id) => !removedIds.has(id)).length;
    const cur = getCurrentId();
    const curSelected = cur && selected.has(cur);
    bar.innerHTML = '';
    const row = () => {
      const r = document.createElement('div');
      r.className = 'cgx-bar-row';
      bar.appendChild(r);
      return r;
    };
    const mk = (parent, html, cls, onClick, disabled, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cgx-btn ${cls || ''}`;
      b.innerHTML = html;
      b.disabled = !!disabled || busy;
      if (title) b.title = title;
      b.addEventListener('click', onClick);
      parent.appendChild(b);
      return b;
    };

    const top = row();
    const count = document.createElement('span');
    count.className = 'cgx-count';
    count.textContent = progressText || `已选 ${n} 项`;
    top.appendChild(count);
    mk(top, '全选', 'cgx-ghost', () => {
      const ids = getVisibleIdsInOrder();
      const allOn = ids.length && ids.every((id) => selected.has(id));
      for (const id of ids) { if (allOn) selected.delete(id); else selected.add(id); }
      decorateSidebar();
      renderBar();
    }, false, '选中 / 取消选中侧边栏中所有已加载的对话');
    mk(top, '清空', 'cgx-ghost', () => { selected.clear(); decorateSidebar(); renderBar(); }, n === 0);
    mk(top, ICON_GEAR, 'cgx-ghost cgx-icon', openSettings, false, '快捷键设置');
    mk(top, ICON_CLOSE, 'cgx-ghost cgx-icon', () => setMultiMode(false), false, `退出多选（${prettyCombo(shortcuts.toggleMultiSelect)}）`);

    if (!progressText && n === 0) {
      const hint = document.createElement('div');
      hint.className = 'cgx-hint';
      hint.textContent = `点击对话左侧圆圈，或按 ${prettyCombo(shortcuts.toggleSelectCurrent)} 选中正在查看的对话；Shift+点击可连续选择。`;
      bar.appendChild(hint);
    }

    const actions = row();
    if (cur) {
      mk(actions, curSelected ? '取消当前' : '选中当前', 'cgx-grow', () => { toggleSelect(cur); lastClickedId = cur; }, false,
        `${curSelected ? '取消选中' : '选中'}正在查看的对话（${prettyCombo(shortcuts.toggleSelectCurrent)}）`);
    }
    mk(actions, '归档', 'cgx-grow', () => runBatch('archive'), n === 0);
    mk(actions, `删除${n ? ` (${n})` : ''}`, 'cgx-grow cgx-danger', () => runBatch('delete'), n === 0,
      shortcuts.deleteSelected ? `快捷键 ${prettyCombo(shortcuts.deleteSelected)}` : '');
    positionBar();
  }

  // 工具栏停靠在侧边栏底部（用户头像上方）；侧边栏收起时停靠在左下角
  function positionBar() {
    if (!bar) return;
    const nav = document.querySelector('nav');
    const side = nav && (nav.closest('aside, [role="complementary"]') || nav);
    const r = side && side.getBoundingClientRect();
    if (r && r.width > 200 && r.right > 0) {
      bar.style.left = `${Math.max(r.left, 0) + 8}px`;
      bar.style.width = `${r.width - 16}px`;
      bar.style.bottom = '72px';
    } else {
      bar.style.left = '16px';
      bar.style.width = '300px';
      bar.style.bottom = '16px';
    }
  }

  // ---- 确认框 ----
  function confirmDialog({ title, body, note, confirmText, danger }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'cgx-overlay';
      const modal = document.createElement('div');
      modal.className = 'cgx-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const h = document.createElement('h3');
      h.textContent = title;
      modal.appendChild(h);
      if (body && body.length) {
        const ul = document.createElement('ul');
        ul.className = 'cgx-list';
        for (const line of body) {
          const li = document.createElement('li');
          li.textContent = line;
          li.title = line;
          ul.appendChild(li);
        }
        modal.appendChild(ul);
      }
      if (note) {
        const p = document.createElement('p');
        p.className = 'cgx-note';
        p.textContent = note;
        modal.appendChild(p);
      }
      const actions = document.createElement('div');
      actions.className = 'cgx-actions';
      const cancel = document.createElement('button');
      cancel.className = 'cgx-btn';
      cancel.textContent = '取消';
      const ok = document.createElement('button');
      ok.className = `cgx-btn ${danger ? 'cgx-danger' : 'cgx-primary'}`;
      ok.textContent = confirmText || '确定';
      actions.append(cancel, ok);
      modal.appendChild(actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const close = (v) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      };
      document.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', () => close(false));
      ok.addEventListener('click', () => close(true));
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
      ok.focus();
    });
  }

  // ---- 设置 ----
  let settingsOpen = false;
  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;
    const draft = { ...shortcuts };
    const draftOpts = { ...options };

    const overlay = document.createElement('div');
    overlay.className = 'cgx-overlay';
    const modal = document.createElement('div');
    modal.className = 'cgx-modal';
    modal.style.width = '520px';
    modal.innerHTML = '<h3>删除 / 归档 / 多选 · 设置</h3>';

    const sec1 = document.createElement('div');
    sec1.className = 'cgx-section';
    sec1.textContent = '快捷键（点击按钮后按下新的组合键，Esc 取消）';
    modal.appendChild(sec1);

    const keyButtons = {};
    let recording = null;

    const refreshConflicts = () => {
      const counts = {};
      for (const k of Object.keys(ACTIONS)) if (draft[k]) counts[draft[k]] = (counts[draft[k]] || 0) + 1;
      for (const [k, b] of Object.entries(keyButtons)) {
        b.textContent = recording === k ? '请按下组合键…' : prettyCombo(draft[k]);
        b.classList.toggle('cgx-recording', recording === k);
        b.classList.toggle('cgx-conflict', !!draft[k] && counts[draft[k]] > 1);
        b.title = draft[k] && counts[draft[k]] > 1 ? '与其他快捷键冲突' : draft[k] || '';
      }
    };

    for (const [key, label] of Object.entries(ACTIONS)) {
      const row = document.createElement('div');
      row.className = 'cgx-row';
      const l = document.createElement('span');
      l.className = 'cgx-label';
      l.textContent = label;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgx-key';
      b.addEventListener('click', () => { recording = recording === key ? null : key; refreshConflicts(); });
      const clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'cgx-clear';
      clr.textContent = '×';
      clr.title = '清除';
      clr.addEventListener('click', () => { draft[key] = ''; recording = null; refreshConflicts(); });
      keyButtons[key] = b;
      row.append(l, b, clr);
      modal.appendChild(row);
    }

    const sec2 = document.createElement('div');
    sec2.className = 'cgx-section';
    sec2.textContent = '行为';
    modal.appendChild(sec2);
    const row = document.createElement('div');
    row.className = 'cgx-row';
    row.innerHTML = '<span class="cgx-label">删除 / 归档当前对话后</span>';
    const sel = document.createElement('select');
    sel.className = 'cgx-select';
    sel.innerHTML = '<option value="new">打开新对话</option><option value="next">打开侧边栏中的下一个对话</option>';
    sel.value = draftOpts.afterRemove;
    sel.addEventListener('change', () => { draftOpts.afterRemove = sel.value; });
    row.appendChild(sel);
    modal.appendChild(row);

    const note = document.createElement('p');
    note.className = 'cgx-note';
    note.style.marginTop = '12px';
    note.textContent = '提示：没有 Ctrl / Alt / ⌘ 修饰键的快捷键在输入框中不会触发。';
    modal.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'cgx-actions';
    const reset = document.createElement('button');
    reset.className = 'cgx-btn';
    reset.textContent = '恢复默认';
    reset.style.marginRight = 'auto';
    const cancel = document.createElement('button');
    cancel.className = 'cgx-btn';
    cancel.textContent = '取消';
    const save = document.createElement('button');
    save.className = 'cgx-btn cgx-primary';
    save.textContent = '保存';
    actions.append(reset, cancel, save);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    refreshConflicts();

    const close = () => {
      settingsOpen = false;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };
    const onKey = (e) => {
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          recording = null;
        } else {
          const combo = eventToCombo(e);
          if (!combo) return;
          draft[recording] = combo;
          recording = null;
        }
        refreshConflicts();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else e.stopPropagation(); // 设置面板打开时不触发全局快捷键
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    cancel.addEventListener('click', close);
    reset.addEventListener('click', () => {
      Object.assign(draft, DEFAULT_SHORTCUTS);
      Object.assign(draftOpts, DEFAULT_OPTIONS);
      sel.value = draftOpts.afterRemove;
      recording = null;
      refreshConflicts();
    });
    save.addEventListener('click', () => {
      shortcuts = { ...draft };
      options = { ...draftOpts };
      store.set('shortcuts', shortcuts);
      store.set('options', options);
      updateToggleButton();
      renderBar();
      close();
      toast('设置已保存', 'ok');
    });
  }

  // ---------------------------------------------------------------------------
  // 全局快捷键
  // ---------------------------------------------------------------------------

  const HANDLERS = {
    deleteCurrent: () => removeCurrent('delete'),
    archiveCurrent: () => removeCurrent('archive'),
    toggleMultiSelect: () => setMultiMode(!multiMode),
    toggleSelectCurrent: toggleSelectCurrent,
    deleteSelected: () => { if (multiMode) runBatch('delete'); else toast('请先开启多选模式', 'warn'); },
    openSettings: openSettings,
  };

  function onKeyDown(e) {
    if (e.isComposing || e.repeat || settingsOpen || document.querySelector('.cgx-overlay')) return;
    const combo = eventToCombo(e);
    if (!combo) return;
    for (const [action, sc] of Object.entries(shortcuts)) {
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
    window.addEventListener('resize', positionBar);

    try {
      GM_registerMenuCommand('⚙️ 快捷键设置', openSettings);
      GM_registerMenuCommand('☑️ 开启 / 退出多选模式', () => setMultiMode(!multiMode));
    } catch (_) { /* ignore */ }

    let scheduled = false;
    let lastPath = location.pathname;
    const tick = () => {
      scheduled = false;
      ensureToggleButton();
      if (multiMode || removedIds.size) decorateSidebar();
      if (multiMode) positionBar();
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        if (multiMode) renderBar();
      }
    };
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(tick);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'href'] });
    tick();
  }

  init();
})();
