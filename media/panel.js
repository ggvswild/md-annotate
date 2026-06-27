/*
 * MD Annotate · webview client
 * 交互：划选文字 → 选区旁浮出「💬 评论」气泡 → 点击就地弹评论框。
 * 按住 Alt → 段落高亮，Alt+点击 → 就地评论整段（无需模式开关）。
 * 右下角面板 = 批注清单 + 样式切换 + 导出；可最小化为角落圆球。
 */
(function () {
  'use strict';

  var vscodeApi = acquireVsCodeApi();
  var BOOT = window.__WA_BOOTSTRAP__ || { fileName: 'document', filePath: '', source: '', theme: 'github', prefs: {}, annotations: [] };
  var SOURCE_LINES = String(BOOT.source || '').split(/\r?\n/);
  var TYPES = { comment: '评论', replacement: '替换', deletion: '删除' };
  var THEMES = [
    ['vscode', '跟随编辑器'],
    ['github', 'GitHub 浅色'],
    ['sepia', 'Sepia 护眼'],
    ['dark', '极简暗色'],
    ['notion', 'Notion 宽松']
  ];

  var doc = document.getElementById('wa-doc');
  var items = Array.isArray(BOOT.annotations) ? BOOT.annotations.slice() : [];
  var altDown = false;
  var hover = null;
  var panel, listEl, cntEl, launcher, badgeEl;
  var bubble = null, popover = null, lastRect = null;
  var toc = null, tocBody = null, tocLauncher = null;

  build();
  render();
  tip('划选文字即可评论（选区旁出现 💬）；按住 Alt 点击评论整段');

  /* ---------------- 面板 ---------------- */
  function build() {
    panel = document.createElement('div');
    panel.className = 'wa-panel wa-open';
    panel.innerHTML =
      '<div class="wa-hd"><b>🔖 批注</b><span class="wa-cnt"></span><span class="wa-min" title="最小化">—</span></div>' +
      '<div class="wa-bd">' +
        '<div class="wa-ctrl-row">' +
          '<label class="wa-ctrl"><span>🎨 样式</span><select class="wa-theme">' +
            THEMES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="wa-ctrl"><span>🖍 标注</span><select class="wa-hl">' +
            '<option value="default">选框</option>' +
            '<option value="subtle">低调</option>' +
            '<option value="underline">下划线</option>' +
          '</select></label>' +
        '</div>' +
        '<div class="wa-ctrl-row">' +
          '<label class="wa-ctrl"><span>🎛 界面</span><select class="wa-ui">' +
            '<option value="auto">跟随编辑器</option>' +
            '<option value="dark">暗色</option>' +
            '<option value="light">亮色</option>' +
          '</select></label>' +
        '</div>' +
        '<div class="wa-hint">划选文字弹 💬 评论 · 按住 <b>Alt</b> 点击评论整段</div>' +
        '<div class="wa-row">' +
          '<div class="wa-btn wa-text">✍️ 评论当前选区</div>' +
        '</div>' +
        '<ul class="wa-list"></ul>' +
      '</div>' +
      '<div class="wa-ft">' +
        '<div class="wa-btn wa-export">⬇ 导出 JSON</div>' +
        '<div class="wa-btn wa-copy">📋 复制</div>' +
        '<div class="wa-btn wa-clear">🗑 清空</div>' +
      '</div>';
    document.body.appendChild(panel);

    listEl = panel.querySelector('.wa-list');
    cntEl = panel.querySelector('.wa-cnt');

    panel.querySelector('.wa-text').onclick = function () {
      var p = captureSelection();
      if (!p) return tip('请先在文档里用鼠标选中一段文字');
      openForm(p, selectionRect());
    };
    panel.querySelector('.wa-export').onclick = exportJson;
    panel.querySelector('.wa-copy').onclick = copyJson;
    panel.querySelector('.wa-clear').onclick = function () {
      if (!items.length) return tip('没有批注可清空');
      confirmBox('清空本文件全部批注？此操作不可撤销。', function () {
        items = []; persist(); render(); tip('已清空全部批注');
      });
    };
    panel.querySelector('.wa-min').onclick = minimize;

    var themeSel = panel.querySelector('.wa-theme');
    themeSel.value = BOOT.theme || 'github';
    themeSel.onchange = function () {
      var t = themeSel.value;
      setThemeClass(t);
      vscodeApi.postMessage({ type: 'theme', theme: t });
    };

    var hlSel = panel.querySelector('.wa-hl');
    var savedHl = prefs().hlStyle || 'default';
    hlSel.value = savedHl;
    setHlClass(savedHl);
    hlSel.onchange = function () { setHlClass(hlSel.value); postPref('hlStyle', hlSel.value); };

    var uiSel = panel.querySelector('.wa-ui');
    var savedUi = prefs().uiMode || 'auto';
    uiSel.value = savedUi;
    setUiClass(savedUi);
    uiSel.onchange = function () { setUiClass(uiSel.value); postPref('uiMode', uiSel.value); };
    enableDrag();
    enableResize();
    applySavedHeight();

    launcher = document.createElement('div');
    launcher.className = 'wa-launcher';
    launcher.title = '展开批注面板';
    launcher.innerHTML = '💬<span class="wa-badge"></span>';
    launcher.onclick = maximize;
    document.body.appendChild(launcher);
    badgeEl = launcher.querySelector('.wa-badge');

    buildTocUI();
  }

  /* ---------------- 右上角大纲目录 (TOC) ---------------- */
  function collectHeadings() {
    var heads = doc.querySelectorAll('h1, h2, h3, h4');
    var list = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if (!h.id) h.id = 'wa-h-' + i;
      var txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      list.push({ el: h, level: parseInt(h.tagName.charAt(1), 10), text: txt });
    }
    return list;
  }
  function nestHeadings(flat) {
    var root = { level: 0, children: [] }, stack = [root];
    flat.forEach(function (it) {
      it.children = [];
      while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
      stack[stack.length - 1].children.push(it);
      stack.push(it);
    });
    return root.children;
  }
  function renderTocNodes(nodes) {
    var ul = document.createElement('ul');
    ul.className = 'wa-toc-ul';
    nodes.forEach(function (node) {
      var li = document.createElement('li');
      li.className = 'wa-toc-li';
      var row = document.createElement('div');
      row.className = 'wa-toc-row lvl' + node.level;
      var hasKids = node.children && node.children.length;
      var tw = document.createElement('span');
      tw.className = 'wa-toc-tw';
      tw.textContent = hasKids ? '▾' : '';
      var label = document.createElement('span');
      label.className = 'wa-toc-label';
      label.textContent = node.text;
      label.title = node.text;
      label.onclick = function () { jumpToHeading(node.el); };
      row.appendChild(tw); row.appendChild(label); li.appendChild(row);
      if (hasKids) {
        li.appendChild(renderTocNodes(node.children));
        tw.onclick = function (e) {
          e.stopPropagation();
          var collapsed = li.classList.toggle('wa-collapsed');
          tw.textContent = collapsed ? '▸' : '▾';
        };
      }
      ul.appendChild(li);
    });
    return ul;
  }
  function renderToc() {
    var flat = collectHeadings();
    tocBody.innerHTML = '';
    if (!flat.length) { tocBody.innerHTML = '<div class="wa-empty">无标题</div>'; return; }
    tocBody.appendChild(renderTocNodes(nestHeadings(flat)));
  }
  function jumpToHeading(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('wa-flash');
    setTimeout(function () { el.classList.remove('wa-flash'); }, 1200);
  }
  function buildTocUI() {
    if (!collectHeadings().length) return; // 没标题就不显示大纲

    toc = document.createElement('div');
    toc.className = 'wa-toc';
    toc.innerHTML =
      '<div class="wa-toc-hd"><b>📑 大纲</b><span class="wa-toc-min" title="最小化">—</span></div>' +
      '<div class="wa-toc-bd"></div>';
    document.body.appendChild(toc);
    tocBody = toc.querySelector('.wa-toc-bd');
    toc.querySelector('.wa-toc-min').onclick = tocMinimize;

    tocLauncher = document.createElement('div');
    tocLauncher.className = 'wa-toc-launcher';
    tocLauncher.textContent = '≡ 大纲';
    tocLauncher.title = '展开大纲';
    tocLauncher.onclick = tocMaximize;
    document.body.appendChild(tocLauncher);

    renderToc();
    if (prefs().tocOpen === true) tocMaximize(); else tocMinimize();
  }
  function tocMinimize() {
    toc.classList.add('wa-hidden');
    tocLauncher.classList.add('wa-show');
    postPref('tocOpen', false);
  }
  function tocMaximize() {
    toc.classList.remove('wa-hidden');
    tocLauncher.classList.remove('wa-show');
    postPref('tocOpen', true);
  }

  function minimize() {
    panel.classList.remove('wa-open');
    launcher.classList.add('wa-show');
    clearHover();
  }
  function maximize() {
    panel.classList.add('wa-open');
    launcher.classList.remove('wa-show');
  }

  /* ---------------- 选区气泡 ---------------- */
  function makeBubble() {
    bubble = document.createElement('div');
    bubble.className = 'wa-bubble';
    bubble.textContent = '💬 评论';
    bubble.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 保住选区
    bubble.onclick = function () {
      var p = captureSelection();
      var rect = lastRect;
      hideBubble();
      if (p) openForm(p, rect);
    };
    document.body.appendChild(bubble);
  }
  function showBubble() {
    if (altDown || popover) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return hideBubble();
    var range = sel.getRangeAt(0);
    if (!doc.contains(range.commonAncestorContainer)) return hideBubble();
    var rects = range.getClientRects();
    var r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    lastRect = r;
    if (!bubble) makeBubble();
    bubble.style.display = 'block';
    var left = r.right + 4, top = r.bottom + 4;
    if (left + 84 > window.innerWidth) left = window.innerWidth - 88;
    if (top + 34 > window.innerHeight) top = r.top - 34;
    bubble.style.left = Math.max(4, left) + 'px';
    bubble.style.top = Math.max(4, top) + 'px';
  }
  function hideBubble() { if (bubble) bubble.style.display = 'none'; }
  function selectionRect() {
    try {
      var range = window.getSelection().getRangeAt(0);
      var rects = range.getClientRects();
      return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    } catch (e) { return null; }
  }

  /* ---------------- 就地评论框 ---------------- */
  function openForm(payload, rect) {
    closePopover();
    hideBubble();
    popover = document.createElement('div');
    popover.className = 'wa-popover wa-show';
    popover.innerHTML =
      '<div class="wa-form">' +
        '<div class="wa-sel"></div>' +
        '<textarea placeholder="写下修改意见，例如：这句太啰嗦压缩成一句 / 数据换成 Q2 / 这段删掉…"></textarea>' +
        '<div class="wa-types">' +
          '<label><input type="radio" name="wa-t" value="comment" checked>评论</label>' +
          '<label><input type="radio" name="wa-t" value="replacement">替换</label>' +
          '<label><input type="radio" name="wa-t" value="deletion">删除</label>' +
        '</div>' +
        '<div class="wa-row" style="margin:0">' +
          '<div class="wa-btn wa-add wa-primary">添加批注</div>' +
          '<div class="wa-btn wa-cancel">取消</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(popover);
    popover.querySelector('.wa-sel').textContent =
      '选中(' + (payload.mode === 'block' ? '段落' : '文字') + ' · 第' +
      (payload.sourceLineStart || '?') + '行)：' + (payload.selectedText || '');
    positionPopover(rect);

    var ta = popover.querySelector('textarea');
    ta.focus();
    popover.querySelector('.wa-add').onclick = function () {
      var t = popover.querySelector('input[name=wa-t]:checked').value;
      payload.type = t;
      payload.comment = ta.value.trim();
      if (t === 'replacement') { payload.replacementText = payload.selectedText; }
      if (t !== 'deletion' && !payload.comment) { ta.focus(); ta.classList.add('wa-err'); return; }
      items.push(payload);
      persist();
      render();
      closePopover();
    };
    popover.querySelector('.wa-cancel').onclick = closePopover;
  }
  function positionPopover(rect) {
    var pad = 8, w = popover.offsetWidth, h = popover.offsetHeight;
    var left = rect ? rect.left : (window.innerWidth - w) / 2;
    var top = rect ? rect.bottom + 8 : (window.innerHeight - h) / 2;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (left < pad) left = pad;
    if (top + h > window.innerHeight - pad) top = rect ? Math.max(pad, rect.top - h - 8) : pad;
    if (top < pad) top = pad;
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }
  function closePopover() { if (popover) { popover.remove(); popover = null; } }

  /* ---------------- 捕获 ---------------- */
  function nearestBlock(node) {
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (el && el !== document.body) {
      if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute('data-source-line')) return el;
      if (el === doc) break;
      el = el.parentElement;
    }
    return null;
  }
  // 选区起点最可靠：跨段时公共祖先会上浮到 #wa-doc（无行号），起点/终点仍落在具体块内
  function blockForRange(range) {
    return nearestBlock(range.startContainer) ||
           nearestBlock(range.endContainer) ||
           nearestBlock(range.commonAncestorContainer);
  }
  function blockRange(block) {
    if (!block || !block.getAttribute) return { start: null, end: null, text: '' };
    var start = parseInt(block.getAttribute('data-source-line'), 10);
    var end = parseInt(block.getAttribute('data-source-end'), 10);
    if (!isFinite(start)) return { start: null, end: null, text: '' };
    if (!isFinite(end) || end < start) end = start;
    return { start: start, end: end, text: SOURCE_LINES.slice(start - 1, end).join('\n') };
  }
  function captureSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
    var range = sel.getRangeAt(0);
    if (!doc.contains(range.commonAncestorContainer)) return null;
    var block = blockForRange(range);
    var rng = blockRange(block);
    var ctx = block ? (block.textContent || '') : '';
    var s = sel.toString();
    var at = ctx.indexOf(s);
    return {
      id: uid(), mode: 'text', createdAt: Date.now(), selectedText: clean(s).slice(0, 400), comment: '',
      sourceLineStart: rng.start, sourceLineEnd: rng.end, sourceText: rng.text,
      contextPrefix: at > -1 ? clean(ctx.slice(Math.max(0, at - 40), at)) : '',
      contextSuffix: at > -1 ? clean(ctx.slice(at + s.length, at + s.length + 40)) : ''
    };
  }
  function captureBlock(el) {
    var block = nearestBlock(el) || el;
    var rng = blockRange(block);
    return {
      id: uid(), mode: 'block', createdAt: Date.now(), selectedText: clean(block.textContent || '').slice(0, 400), comment: '',
      sourceLineStart: rng.start, sourceLineEnd: rng.end, sourceText: rng.text,
      contextPrefix: '', contextSuffix: ''
    };
  }

  /* ---------------- Alt 选段（常驻，无模式开关） ---------------- */
  function clearHover() { if (hover) { hover.classList.remove('wa-hl'); hover = null; } }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Alt') { altDown = true; hideBubble(); }
    if (e.key === 'Escape') { hideBubble(); closePopover(); clearHover(); }
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'Alt') { altDown = false; clearHover(); }
  });
  window.addEventListener('blur', function () { altDown = false; clearHover(); });

  document.addEventListener('mousemove', function (e) {
    if (!altDown) return;
    var el = e.target;
    if (panel.contains(el) || (popover && popover.contains(el)) || !doc.contains(el)) { clearHover(); return; }
    var block = nearestBlock(el) || el;
    if (block === hover) return;
    clearHover(); hover = block; if (block && block.classList) block.classList.add('wa-hl');
  }, true);

  document.addEventListener('click', function (e) {
    if (!e.altKey) return;
    if (panel.contains(e.target) || (popover && popover.contains(e.target)) || !doc.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    var block = nearestBlock(e.target) || e.target;
    clearHover();
    openForm(captureBlock(block), { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  }, true);

  /* 划选完成 → 弹气泡；点别处 → 收起 */
  document.addEventListener('mouseup', function (e) {
    if (panel.contains(e.target)) return;
    if (toc && toc.contains(e.target)) return;
    if (tocLauncher && tocLauncher.contains(e.target)) return;
    if (bubble && bubble.contains(e.target)) return;
    if (popover && popover.contains(e.target)) return;
    setTimeout(showBubble, 0);
  });
  document.addEventListener('mousedown', function (e) {
    if (bubble && bubble.contains(e.target)) return;
    hideBubble();
    if (popover && !popover.contains(e.target)) closePopover();
  });
  document.addEventListener('scroll', function () { hideBubble(); }, true);

  /* ---------------- 列表 ---------------- */
  function render() {
    var n = items.length;
    cntEl.textContent = n ? '(' + n + ')' : '';
    if (badgeEl) { badgeEl.textContent = n ? String(n) : ''; badgeEl.style.display = n ? 'block' : 'none'; }
    applyHighlights();
    if (!n) { listEl.innerHTML = '<div class="wa-empty">还没有批注</div>'; return; }
    listEl.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');
      li.className = 'wa-li';
      li.innerHTML =
        '<span class="wa-del" data-i="' + i + '" title="删除">✕</span>' +
        '<span class="wa-tag ' + it.type + '">' + (TYPES[it.type] || it.type) + '</span>' +
        '<b>#' + (i + 1) + '</b>' +
        '<span class="wa-line">L' + (it.sourceLineStart || '?') + '</span>' +
        '<div class="wa-snip">' + esc(it.selectedText) + '</div>' +
        (it.comment ? '<div class="wa-cmt">' + esc(it.comment) + '</div>' : '') +
        '<span class="wa-goto" data-i="' + i + '">↪ 定位源码</span>' +
        '<span class="wa-time">' + fmtTime(it.createdAt) + '</span>';
      li.onclick = function (e) {
        if (e.target.classList.contains('wa-del')) { items.splice(i, 1); persist(); render(); return; }
        if (e.target.classList.contains('wa-goto')) { vscodeApi.postMessage({ type: 'reveal', line: it.sourceLineStart }); return; }
        focusAnnotation(it);
      };
      listEl.insertBefore(li, listEl.firstChild); // 新评论置顶（数据数组仍按时间顺序）
    });
  }
  function flash(it) {
    if (!it.sourceLineStart) return;
    var el = doc.querySelector('[data-source-line="' + it.sourceLineStart + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('wa-flash');
    setTimeout(function () { el.classList.remove('wa-flash'); }, 1200);
  }

  /* ---------------- 主题 / 标注样式类 ---------------- */
  function setThemeClass(t) {
    document.body.classList.remove('theme-vscode', 'theme-github', 'theme-sepia', 'theme-dark', 'theme-notion');
    document.body.classList.add('theme-' + t);
  }
  function setHlClass(s) {
    document.body.classList.remove('wa-hl-default', 'wa-hl-subtle', 'wa-hl-underline');
    document.body.classList.add('wa-hl-' + s);
  }
  function setUiClass(m) {
    document.body.classList.remove('wa-ui-auto', 'wa-ui-dark', 'wa-ui-light');
    document.body.classList.add('wa-ui-' + m);
  }

  /* ---------------- 批注高亮（琥珀色选框） ---------------- */
  function clearHighlights() {
    var spans = doc.querySelectorAll('span.wa-annot');
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i], parent = s.parentNode;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      parent.removeChild(s);
      parent.normalize();
    }
    var blocks = doc.querySelectorAll('.wa-annot-block');
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      b.classList.remove('wa-annot-block', 'wa-annot-active');
      b.removeAttribute('data-aid'); b.removeAttribute('data-badge');
    }
  }
  function applyHighlights() {
    clearHighlights();
    items.forEach(function (ann, i) {
      var block = ann.sourceLineStart ? doc.querySelector('[data-source-line="' + ann.sourceLineStart + '"]') : null;
      if (!block) return;
      if (ann.mode === 'block') {
        block.classList.add('wa-annot-block');
        block.setAttribute('data-aid', ann.id);
        block.setAttribute('data-badge', String(i + 1));
        block.onclick = function (e) { if (e.altKey) return; setActiveHighlight(ann.id); };
      } else {
        var range = findRange(block, ann.selectedText);
        if (range) wrapRange(range, ann, i + 1);
      }
    });
  }
  // 在块内按规范化空白匹配 needle，返回 Range
  function findRange(container, needle) {
    needle = String(needle || '').replace(/\s+/g, ' ').trim();
    if (!needle) return null;
    var norm = '', map = [], prevSpace = false;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      for (var i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) {
          if (prevSpace) continue;
          norm += ' '; map.push({ node: node, offset: i }); prevSpace = true;
        } else {
          norm += text[i]; map.push({ node: node, offset: i }); prevSpace = false;
        }
      }
    }
    var at = norm.indexOf(needle);
    if (at === -1) return null;
    var startPos = map[at], endPos = map[at + needle.length - 1];
    if (!startPos || !endPos) return null;
    try {
      var range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset + 1);
      return range;
    } catch (e) { return null; }
  }
  function wrapRange(range, ann, number) {
    var span = document.createElement('span');
    span.className = 'wa-annot';
    span.setAttribute('data-aid', ann.id);
    span.setAttribute('data-badge', String(number));
    span.title = ann.comment || ann.selectedText || '';
    try {
      range.surroundContents(span);
    } catch (e) {
      try {
        var frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      } catch (e2) { return; }
    }
    span.onclick = function (e) { e.stopPropagation(); setActiveHighlight(ann.id); };
  }
  function setActiveHighlight(aid) {
    var prev = doc.querySelectorAll('.wa-annot-active');
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove('wa-annot-active');
    var el = doc.querySelector('[data-aid="' + aid + '"]');
    if (el) { el.classList.add('wa-annot-active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function focusAnnotation(it) {
    if (it.id && doc.querySelector('[data-aid="' + it.id + '"]')) setActiveHighlight(it.id);
    else flash(it);
  }

  /* ---------------- 导出 / 复制 / 持久化 ---------------- */
  function payloadText() { return JSON.stringify({ file: BOOT.filePath, count: items.length, annotations: items }, null, 2); }
  function exportJson() { if (!items.length) return tip('没有批注可导出'); vscodeApi.postMessage({ type: 'save', annotations: items }); }
  function copyJson() { if (!items.length) return tip('没有批注可复制'); vscodeApi.postMessage({ type: 'copy', text: payloadText() }); }
  function persist() { vscodeApi.postMessage({ type: 'persist', annotations: items }); }

  /* ---------------- 工具 ---------------- */
  function clean(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function uid() { return 'a' + (items.length + 1) + '_' + Math.floor(performance.now()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var tipEl = null, tipTimer = null;
  function tip(msg) {
    hideTip();
    tipEl = document.createElement('div'); tipEl.className = 'wa-tip'; tipEl.textContent = msg;
    document.body.appendChild(tipEl);
    tipTimer = setTimeout(hideTip, 2600);
  }
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } if (tipTimer) clearTimeout(tipTimer); }

  /* VS Code webview 禁用 window.confirm，这里自绘确认框 */
  function confirmBox(message, onYes) {
    var mask = document.createElement('div');
    mask.className = 'wa-mask';
    mask.innerHTML =
      '<div class="wa-dialog">' +
        '<div class="wa-dialog-msg"></div>' +
        '<div class="wa-row" style="margin:0">' +
          '<div class="wa-btn wa-yes wa-primary">确定清空</div>' +
          '<div class="wa-btn wa-no">取消</div>' +
        '</div>' +
      '</div>';
    mask.querySelector('.wa-dialog-msg').textContent = message;
    document.body.appendChild(mask);
    function close() { mask.remove(); }
    mask.querySelector('.wa-yes').onclick = function () { close(); onYes(); };
    mask.querySelector('.wa-no').onclick = close;
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
  }

  /* ---------------- 上边缘调高 ---------------- */
  var MIN_H = 180;
  function enableResize() {
    var handle = document.createElement('div');
    handle.className = 'wa-resize';
    handle.title = '拖拽调整高度';
    panel.insertBefore(handle, panel.firstChild);
    var resizing = false, bottomY = 0;
    handle.addEventListener('mousedown', function (e) {
      resizing = true;
      var r = panel.getBoundingClientRect();
      bottomY = r.bottom;
      panel.style.bottom = 'auto';
      panel.style.maxHeight = 'none';
      document.body.style.userSelect = 'none';
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', function (e) {
      if (!resizing) return;
      var top = Math.min(Math.max(8, e.clientY), bottomY - MIN_H);
      panel.style.top = top + 'px';
      panel.style.height = (bottomY - top) + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!resizing) return;
      resizing = false;
      document.body.style.userSelect = '';
      saveHeight(parseInt(panel.style.height, 10) || null);
    });
  }
  function applySavedHeight() {
    var ph = prefs().panelHeight;
    if (ph) {
      var h = Math.min(ph, window.innerHeight - 24);
      if (h >= MIN_H) { panel.style.height = h + 'px'; panel.style.maxHeight = 'none'; }
    }
  }
  // 偏好持久化走宿主 globalState（webview 的 getState 不跨"关闭再打开"），读 bootstrap、写消息
  function prefs() { return BOOT.prefs || {}; }
  function postPref(key, value) { BOOT.prefs = BOOT.prefs || {}; BOOT.prefs[key] = value; vscodeApi.postMessage({ type: 'pref', key: key, value: value }); }
  function saveHeight(h) { if (!h) return; postPref('panelHeight', h); }

  /* ---------------- 拖动 ---------------- */
  function enableDrag() {
    var hd = panel.querySelector('.wa-hd'), sx, sy, ox, oy, on = false;
    hd.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('wa-min')) return;
      on = true; sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.left = ox + 'px'; panel.style.top = oy + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!on) return;
      panel.style.left = (ox + e.clientX - sx) + 'px';
      panel.style.top = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', function () { on = false; });
  }

  /* ---------------- host 消息 ---------------- */
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (msg && msg.type === 'info') tip(msg.message);
  });
})();
