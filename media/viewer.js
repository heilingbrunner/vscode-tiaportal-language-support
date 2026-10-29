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
    document.querySelectorAll('table.interface tbody tr').forEach(function (row) {
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

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    var fold = target.closest('.fold[data-from]');
    if (fold) {
      fold.classList.toggle('collapsed');
      applyFolds();
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
      return;
    }
    var toggle = target.closest('button[data-toggle-all]');
    if (toggle) {
      setAllCollapsed(toggle.dataset.action === 'collapse');
      return;
    }
    var heading = target.closest('h2[data-toggle-network]');
    if (heading) {
      heading.parentElement.classList.toggle('collapsed');
      heading.querySelector('.caret').classList.toggle('collapsed');
      syncToggleAll();
    }
  });

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
  // other viewer. `target` is '' for the page and the id of a network for its horizontally scrolling diagram.
  var vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  var applied = {};

  function scroller(target) {
    var section = target === '' ? null : document.getElementById(target);
    return section ? section.querySelector('.scroll') : null;
  }

  function positionOf(target) {
    var el = scroller(target);
    return el ? { left: el.scrollLeft, top: el.scrollTop } : { left: window.scrollX, top: window.scrollY };
  }

  if (vscodeApi) {
    window.addEventListener(
      'scroll',
      function (event) {
        var node = event.target;
        var section = node === document ? null : node.closest && node.closest('section.network');
        var target = node === document ? '' : section ? section.id : null;
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

  window.addEventListener('message', function (event) {
    var message = event.data;
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

  renumberRows();
})();
