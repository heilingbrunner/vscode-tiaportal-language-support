(function () {
  'use strict';

  // rows grouped by their data-parent id, built once: avoids one table-wide selector scan per toggled row
  var rowsByParent;
  function childRows(table, parentId) {
    if (!rowsByParent) {
      rowsByParent = {};
      table.querySelectorAll('tbody tr').forEach(function (row) {
        (rowsByParent[row.dataset.parent] = rowsByParent[row.dataset.parent] || []).push(row);
      });
    }
    return rowsByParent[parentId] || [];
  }

  function setRowsHidden(table, parentId, hidden) {
    childRows(table, parentId).forEach(function (row) {
      row.classList.toggle('hidden', hidden);
      var caret = row.querySelector('.caret[data-toggle]');
      var childHidden = hidden || (caret && caret.classList.contains('collapsed'));
      setRowsHidden(table, row.dataset.id, childHidden);
    });
  }

  // number the visible rows of the interface table, as TIA does
  function renumberRows() {
    var n = 0;
    // tables marked data-static (tag tables) carry their own, fixed numbers
    document.querySelectorAll('table.interface:not([data-static]) tbody tr').forEach(function (row) {
      var cell = row.querySelector('td.rownum');
      if (cell) {
        cell.textContent = row.classList.contains('hidden') ? '' : String(++n);
      }
    });
  }

  function applyFolds() {
    var lines = document.querySelectorAll('.cl');
    var hidden = {};
    document.querySelectorAll('.fold.collapsed[data-from]').forEach(function (fold) {
      for (var n = Number(fold.dataset.from) + 1; n <= Number(fold.dataset.to); n++) {
        hidden[n] = true;
      }
    });
    lines.forEach(function (line) {
      line.classList.toggle('hidden', hidden[line.dataset.line] === true);
    });
  }

  function revealLine(line) {
    document.querySelectorAll('.fold.collapsed[data-from]').forEach(function (fold) {
      if (Number(fold.dataset.from) < line && line <= Number(fold.dataset.to)) {
        fold.classList.remove('collapsed');
      }
    });
    applyFolds();
    var target = document.getElementById('L' + line);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      document.querySelectorAll('.cl.flash').forEach(function (el) {
        el.classList.remove('flash');
      });
      target.classList.add('flash');
    }
  }

  // the Tags / User constants tabs of a tag table: one panel is shown at a time
  // `notify`: the other viewer of a comparison shows the same tab
  function selectTab(id, notify) {
    document.querySelectorAll('button[data-tab]').forEach(function (button) {
      button.setAttribute('aria-selected', String(button.dataset.tab === id));
    });
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== id;
    });
    if (notify && vscodeApi) {
      vscodeApi.postMessage({ type: 'tab', id: id });
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    var tab = target.closest('button[data-tab]');
    if (tab) {
      selectTab(tab.dataset.tab, true);
      return;
    }
    var fold = target.closest('.fold[data-from]');
    if (fold) {
      var foldCollapsed = fold.classList.toggle('collapsed');
      applyFolds();
      notifyFold('line', fold.dataset.from, foldCollapsed);
      return;
    }
    var outlineItem = target.closest('.outline-item');
    if (outlineItem) {
      revealLine(Number(outlineItem.dataset.line));
      return;
    }
    var caret = target.closest('.caret[data-toggle]');
    if (caret) {
      var collapsed = caret.classList.toggle('collapsed');
      setRowsHidden(caret.closest('table'), caret.dataset.toggle, collapsed);
      renumberRows();
      syncToggleAll();
      notifyFold('member', caret.dataset.toggle, collapsed);
      return;
    }
    var toggle = target.closest('button[data-toggle-all]');
    if (toggle) {
      var allCollapsed = toggle.dataset.action === 'collapse';
      setAllCollapsed(allCollapsed);
      notifyFold('all', '', allCollapsed);
      return;
    }
    var heading = target.closest('h2[data-toggle-network]');
    if (heading) {
      var networkCollapsed = heading.parentElement.classList.toggle('collapsed');
      heading.querySelector('.caret').classList.toggle('collapsed', networkCollapsed);
      syncToggleAll();
      notifyFold('network', heading.parentElement.id, networkCollapsed);
    }
  });

  // The folding of a version comparison is mirrored: a fold or unfold in one viewer is sent to the other one
  // (through the extension), which applies the same state to the same member, network or code region.
  // `kind` is 'member' (interface row id), 'network' (section id), 'line' (first line of a code region) or 'all'.
  function notifyFold(kind, id, collapsed) {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'fold', kind: kind, id: id, collapsed: collapsed });
    }
  }

  function applyFold(kind, id, collapsed) {
    var escaped = window.CSS && CSS.escape ? CSS.escape(id) : id;
    if (kind === 'all') {
      setAllCollapsed(collapsed);
    } else if (kind === 'member') {
      var caret = document.querySelector('.caret[data-toggle="' + escaped + '"]');
      if (caret) {
        caret.classList.toggle('collapsed', collapsed);
        setRowsHidden(caret.closest('table'), caret.dataset.toggle, collapsed);
        renumberRows();
        syncToggleAll();
      }
    } else if (kind === 'network') {
      var section = document.getElementById(id);
      if (section && section.classList.contains('network')) {
        section.classList.toggle('collapsed', collapsed);
        var networkCaret = section.querySelector('h2 .caret');
        if (networkCaret) {
          networkCaret.classList.toggle('collapsed', collapsed);
        }
        syncToggleAll();
      }
    } else if (kind === 'line') {
      var fold = document.querySelector('.fold[data-from="' + escaped + '"]');
      if (fold) {
        fold.classList.toggle('collapsed', collapsed);
        applyFolds();
      }
    }
  }

  // the carets of the interface sections (Input, Output, ...); sections without members have nothing to fold
  function sectionCarets() {
    return Array.prototype.slice.call(
      document.querySelectorAll('table.interface tr.section:not(.empty) .caret[data-toggle]'),
    );
  }

  function networkSections() {
    return Array.prototype.slice.call(document.querySelectorAll('section.network'));
  }

  // Folds or unfolds the interface sections and all networks at once; nested members keep their own state.
  function setAllCollapsed(collapsed) {
    sectionCarets().forEach(function (caret) {
      caret.classList.toggle('collapsed', collapsed);
      setRowsHidden(caret.closest('table'), caret.dataset.toggle, collapsed);
    });
    renumberRows();
    networkSections().forEach(function (section) {
      section.classList.toggle('collapsed', collapsed);
      var networkCaret = section.querySelector('h2 .caret');
      if (networkCaret) {
        networkCaret.classList.toggle('collapsed', collapsed);
      }
    });
    syncToggleAll();
  }

  // The header button offers the action that applies next: expand once every section and network is folded.
  function syncToggleAll() {
    var button = document.querySelector('button[data-toggle-all]');
    if (!button) {
      return;
    }
    var folded = sectionCarets()
      .map(function (caret) {
        return caret.classList.contains('collapsed');
      })
      .concat(
        networkSections().map(function (section) {
          return section.classList.contains('collapsed');
        }),
      );
    var allCollapsed =
      folded.length > 0 &&
      folded.every(function (isFolded) {
        return isFolded;
      });
    var label = allCollapsed ? 'Expand all' : 'Collapse all';
    button.dataset.action = allCollapsed ? 'expand' : 'collapse';
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  // an interface that starts fully folded (function blocks) already offers "expand all"
  syncToggleAll();

  var slider = document.getElementById('zoom');
  var output = document.getElementById('zoom-out');
  if (slider && output) {
    slider.addEventListener('input', function () {
      var factor = Number(slider.value) / 100;
      output.textContent = slider.value + '%';
      document.querySelectorAll('svg.lad').forEach(function (svg) {
        svg.setAttribute('width', String(Math.round(Number(svg.dataset.w) * factor)));
        svg.setAttribute('height', String(Math.round(Number(svg.dataset.h) * factor)));
      });
    });
  }

  // Keeps the two viewers of a version comparison scrolled alike: the extension relays these messages to the
  // other viewer. `target` is '' for the content pane (the window on pages without panes), 'top' for the header
  // pane and the id of a network for its horizontally scrolling diagram.
  var vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  var applied = {};

  /** The element that scrolls the content of the page (null: the window itself). */
  function contentScroller() {
    return document.querySelector('.main-pane');
  }

  function scroller(target) {
    if (target === '') {
      return contentScroller();
    }
    if (target === 'top') {
      return document.querySelector('.top-pane');
    }
    if (target === 'outline') {
      return document.querySelector('.outline-side');
    }
    var section = document.getElementById(target);
    return section ? section.querySelector('.scroll') : null;
  }

  /** The scroll target an element (or the document) of a scroll event stands for; null for other scrollers. */
  function targetOf(node) {
    if (node === document) {
      return '';
    }
    if (node.classList && node.classList.contains('main-pane')) {
      return '';
    }
    if (node.classList && node.classList.contains('top-pane')) {
      return 'top';
    }
    if (node.classList && node.classList.contains('outline-side')) {
      return 'outline';
    }
    var section = node.closest && node.closest('section.network');
    return section ? section.id : null;
  }

  function positionOf(target) {
    var el = scroller(target);
    return el ? { left: el.scrollLeft, top: el.scrollTop } : { left: window.scrollX, top: window.scrollY };
  }

  if (vscodeApi) {
    window.addEventListener(
      'scroll',
      function (event) {
        var target = targetOf(event.target);
        if (target === null) {
          return;
        }
        var pos = positionOf(target);
        var last = applied[target];
        if (last && last.left === pos.left && last.top === pos.top) {
          // the echo of a position the other viewer just set: do not send it back
          delete applied[target];
          return;
        }
        vscodeApi.postMessage({ type: 'scroll', target: target, left: pos.left, top: pos.top });
      },
      true,
    );
  }

  // The vertical positions (scroll targets) of the differing places; neighbouring marks form one place.
  var MARKED = '.diff-del, .diff-add, .net-diff-del, .net-diff-add, .has-diff-del, .has-diff-add';
  var DIFF_MARGIN = 80;
  var DIFF_JOIN_GAP = 4;

  /** The vertical scroll position of the content, and the offset that turns viewport coordinates into content ones. */
  function contentTop() {
    var pane = contentScroller();
    return pane ? pane.scrollTop : window.scrollY;
  }

  function contentOffset() {
    var pane = contentScroller();
    return pane ? pane.scrollTop - pane.getBoundingClientRect().top : window.scrollY;
  }

  function differenceTargets() {
    var rects = [];
    var offset = contentOffset();
    Array.prototype.forEach.call(document.querySelectorAll(MARKED), function (el) {
      if (el.getClientRects().length === 0) {
        return; // hidden, for example inside a collapsed row
      }
      var rect = el.getBoundingClientRect();
      rects.push({ top: rect.top + offset, bottom: rect.bottom + offset });
    });
    rects.sort(function (a, b) {
      return a.top - b.top;
    });
    var targets = [];
    var groupBottom = -Infinity;
    rects.forEach(function (rect) {
      if (rect.top - groupBottom > DIFF_JOIN_GAP) {
        targets.push(Math.max(0, rect.top - DIFF_MARGIN));
      }
      groupBottom = Math.max(groupBottom, rect.bottom);
    });
    return targets;
  }

  /** The tabs of a tabbed view (tag table, hardware export) whose table holds a difference, in page order. */
  function differenceTabs() {
    return Array.prototype.slice.call(document.querySelectorAll('button[data-tab].tab-diff-add, button[data-tab].tab-diff-del'));
  }

  /**
   * Scrolls to the next (or previous) difference, wrapping around at the ends like the text diff editor. In a tabbed
   * view the difference after the last one of a tab is the first one of the next tab that holds one.
   */
  function jumpToDifference(direction) {
    var targets = differenceTargets();
    var y = contentTop();
    var found;
    if (direction === 'next') {
      found = targets.filter(function (t) { return t > y + 2; })[0];
    } else {
      var before = targets.filter(function (t) { return t < y - 2; });
      found = before.length > 0 ? before[before.length - 1] : undefined;
    }
    if (found === undefined) {
      var tabs = differenceTabs();
      var current = tabs.findIndex(function (button) { return button.getAttribute('aria-selected') === 'true'; });
      if (tabs.length > 1 || (tabs.length === 1 && current === -1)) {
        var step = direction === 'next' ? 1 : -1;
        var index = current === -1 ? (direction === 'next' ? 0 : tabs.length - 1) : (current + step + tabs.length) % tabs.length;
        selectTab(tabs[index].dataset.tab, true);
        targets = differenceTargets();
      }
      if (targets.length === 0) {
        return;
      }
      found = direction === 'next' ? targets[0] : targets[targets.length - 1];
    }
    var pane = contentScroller();
    if (pane) {
      pane.scrollTo(pane.scrollLeft, found);
    } else {
      window.scrollTo(window.scrollX, found);
    }
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'difference') {
      jumpToDifference(message.direction === 'previous' ? 'previous' : 'next');
      return;
    }
    if (message && message.type === 'fold') {
      if (typeof message.kind === 'string' && typeof message.id === 'string' && typeof message.collapsed === 'boolean') {
        applyFold(message.kind, message.id, message.collapsed);
      }
      return;
    }
    if (message && message.type === 'tab') {
      // the other viewer of the comparison switched tab: follow without sending it back
      if (typeof message.id === 'string') {
        selectTab(message.id, false);
      }
      return;
    }
    if (message && message.type === 'split') {
      // the other viewer of the comparison moved the divider: follow without sending it back
      setSplit(typeof message.ratio === 'number' ? message.ratio : null, false);
      return;
    }
    if (!message || message.type !== 'scroll' || typeof message.target !== 'string') {
      return;
    }
    var el = scroller(message.target);
    if (el) {
      el.scrollLeft = message.left;
      el.scrollTop = message.top;
    } else {
      window.scrollTo(message.left, message.top);
    }
    // read back: the position may have been clamped because this version is shorter or narrower
    applied[message.target] = positionOf(message.target);
  });

  // The divider between the header pane and the content pane. The header height is kept as a share of the window
  // height (null: its natural height), remembered with the webview state and mirrored to the other viewer of a
  // comparison.
  var splitter = document.querySelector('.splitter');
  var topPane = document.querySelector('.top-pane');
  var splitRatio = null;
  var MIN_TOP = 48;
  var MIN_MAIN = 96;
  var KEY_STEP = 16;

  function splitBounds() {
    var splitterHeight = splitter ? splitter.offsetHeight : 0;
    return { min: MIN_TOP, max: Math.max(MIN_TOP, window.innerHeight - MIN_MAIN - splitterHeight) };
  }

  function showSplit() {
    if (!splitter || !topPane) {
      return;
    }
    if (splitRatio === null) {
      document.body.classList.remove('sized');
      document.body.style.removeProperty('--top-height');
      return;
    }
    var bounds = splitBounds();
    var height = Math.min(bounds.max, Math.max(bounds.min, Math.round(splitRatio * window.innerHeight)));
    document.body.style.setProperty('--top-height', height + 'px');
    document.body.classList.add('sized');
  }

  function setSplit(ratio, notify) {
    splitRatio = ratio === null ? null : Math.min(1, Math.max(0, ratio));
    showSplit();
    if (vscodeApi) {
      var state = vscodeApi.getState() || {};
      vscodeApi.setState(Object.assign({}, state, { split: splitRatio }));
      if (notify) {
        vscodeApi.postMessage({ type: 'split', ratio: splitRatio });
      }
    }
  }

  function setSplitHeight(height, notify) {
    setSplit(height / window.innerHeight, notify);
  }

  if (splitter && topPane) {
    var saved = vscodeApi && vscodeApi.getState();
    if (saved && typeof saved.split === 'number') {
      splitRatio = saved.split;
      showSplit();
    }
    window.addEventListener('resize', showSplit);

    splitter.addEventListener('pointerdown', function (event) {
      splitter.setPointerCapture(event.pointerId);
      splitter.classList.add('dragging');
      event.preventDefault();
    });
    splitter.addEventListener('pointermove', function (event) {
      if (splitter.classList.contains('dragging')) {
        var bounds = splitBounds();
        setSplitHeight(Math.min(bounds.max, Math.max(bounds.min, event.clientY)), true);
      }
    });
    function endDrag(event) {
      splitter.classList.remove('dragging');
      if (splitter.hasPointerCapture(event.pointerId)) {
        splitter.releasePointerCapture(event.pointerId);
      }
    }
    splitter.addEventListener('pointerup', endDrag);
    splitter.addEventListener('pointercancel', endDrag);
    splitter.addEventListener('dblclick', function () {
      setSplit(null, true);
    });
    splitter.addEventListener('keydown', function (event) {
      var height = topPane.offsetHeight;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        var bounds = splitBounds();
        var next = height + (event.key === 'ArrowUp' ? -KEY_STEP : KEY_STEP);
        setSplitHeight(Math.min(bounds.max, Math.max(bounds.min, next)), true);
      } else if (event.key === 'Home') {
        setSplit(null, true);
      } else {
        return;
      }
      event.preventDefault();
    });
  }

  renumberRows();
})();
