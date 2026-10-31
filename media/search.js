(function () {
  'use strict';

  var vscodeApi = acquireVsCodeApi();

  // "Limit search to": a leaf either selects objects by kind or hits by the property they were found in.
  var LIMITS = [
    {
      label: 'Properties',
      children: [
        { label: 'Name', key: 'field:name' },
        { label: 'Author', key: 'field:author' },
        { label: 'Comment', key: 'field:comment' },
      ],
    },
    {
      label: 'Program blocks',
      children: [
        { label: 'Organization blocks (OB)', key: 'kind:OB' },
        { label: 'Function blocks (FB)', key: 'kind:FB' },
        { label: 'Functions (FC)', key: 'kind:FC' },
        { label: 'Data blocks (DB)', key: 'kind:DB' },
        { label: 'Interface', key: 'field:interface' },
        { label: 'Program code', key: 'field:code' },
      ],
    },
    {
      label: 'PLC tags',
      children: [
        { label: 'Tags', key: 'field:tag' },
        { label: 'Constants', key: 'field:constant' },
      ],
    },
    { label: 'PLC data types', children: [{ label: 'PLC data types', key: 'kind:UDT' }] },
  ];

  // The kinds that have an entry of their own in the tree. A tag table has none: its areas are Tags and Constants.
  var kindLeaves = {};
  LIMITS.forEach(function (group) {
    group.children.forEach(function (child) {
      if (child.key.indexOf('kind:') === 0) {
        kindLeaves[child.key] = true;
      }
    });
  });

  /** Results with fewer matches than this are shown expanded. */
  var AUTO_EXPAND_MATCHES = 60;
  var MAX_HISTORY = 15;
  var INDENT = 18;

  var $ = function (id) {
    return document.getElementById(id);
  };
  var termInput = $('term');
  var folderInput = $('folder');
  var exactInput = $('exact');
  var results = $('results');
  var summaryEl = $('summary');

  var saved = vscodeApi.getState() || {};
  var enabled = saved.enabled || {};
  var objects = [];
  var running = false;
  var searched = false;
  var progress = null;
  var outcome = null;
  var message = '';
  var lastTerm = '';
  var selected = null;

  termInput.value = saved.term || '';
  folderInput.value = saved.folder || '';
  exactInput.checked = saved.exact === true;

  function saveState() {
    vscodeApi.setState({
      term: termInput.value,
      folder: folderInput.value,
      exact: exactInput.checked,
      enabled: enabled,
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function isEnabled(key) {
    return enabled[key] !== false;
  }

  /**
   * The hits of an object that pass the "Limit search to" selection. As in TIA every entry is a search area: a kind
   * of object takes in everything in it (its name, interface, code ...), a property takes in that part of every object.
   */
  function visibleHits(obj) {
    var kindKey = 'kind:' + obj.kind;
    if (kindLeaves[kindKey] && isEnabled(kindKey)) {
      return obj.hits;
    }
    return obj.hits.filter(function (hit) {
      return isEnabled('field:' + hit.field);
    });
  }

  // ---- "Limit search to" tree ----

  function leafKeys(group) {
    return group.children.map(function (child) {
      return child.key;
    });
  }

  function syncGroup(box, group) {
    var on = leafKeys(group).filter(isEnabled).length;
    box.checked = on === group.children.length;
    box.indeterminate = on > 0 && on < group.children.length;
  }

  function renderLimits() {
    var tree = $('limit-tree');
    tree.textContent = '';
    LIMITS.forEach(function (group) {
      var section = el('div', 'group');
      var groupLabel = el('label');
      var groupBox = el('input');
      groupBox.type = 'checkbox';
      groupLabel.appendChild(groupBox);
      groupLabel.appendChild(document.createTextNode(group.label));
      var children = el('div', 'children');
      var boxes = group.children.map(function (child) {
        var label = el('label');
        var box = el('input');
        box.type = 'checkbox';
        box.checked = isEnabled(child.key);
        box.addEventListener('change', function () {
          enabled[child.key] = box.checked;
          syncGroup(groupBox, group);
          limitChanged();
        });
        label.appendChild(box);
        label.appendChild(document.createTextNode(child.label));
        children.appendChild(label);
        return box;
      });
      groupBox.addEventListener('change', function () {
        group.children.forEach(function (child, i) {
          enabled[child.key] = groupBox.checked;
          boxes[i].checked = groupBox.checked;
        });
        syncGroup(groupBox, group);
        limitChanged();
      });
      syncGroup(groupBox, group);
      section.appendChild(groupLabel);
      section.appendChild(children);
      tree.appendChild(section);
    });
  }

  function limitChanged() {
    saveState();
    renderResults();
  }

  // ---- result tree ----

  function appendMarked(parent, text, marks) {
    var at = 0;
    marks.forEach(function (range) {
      if (range[0] > at) {
        parent.appendChild(document.createTextNode(text.slice(at, range[0])));
      }
      parent.appendChild(el('mark', '', text.slice(range[0], range[1])));
      at = range[1];
    });
    if (at < text.length) {
      parent.appendChild(document.createTextNode(text.slice(at)));
    }
  }

  // the fold arrow is decoration: the row's aria-expanded says the same
  function caretSpan(className) {
    var caret = el('span', className, '▾');
    caret.setAttribute('aria-hidden', 'true');
    return caret;
  }

  function makeRow(level, className) {
    var row = el('div', 'row ' + className);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.tabIndex = -1;
    return row;
  }

  function mainCell(level) {
    var cell = el('div', 'cell main');
    cell.style.paddingLeft = 8 + (level - 1) * INDENT + 'px';
    return cell;
  }

  function hitRow(obj, hit) {
    var row = makeRow(2, 'hit');
    row.dataset.uri = obj.uri;
    var main = mainCell(2);
    main.appendChild(caretSpan('caret none'));
    appendMarked(main, hit.text, hit.marks);
    var path = el('div', 'cell path', '\\' + hit.path);
    path.title = hit.path;
    row.appendChild(main);
    row.appendChild(path);
    return row;
  }

  function fillChildren(container, obj, hits) {
    var fragment = document.createDocumentFragment();
    hits.forEach(function (hit) {
      fragment.appendChild(hitRow(obj, hit));
    });
    container.appendChild(fragment);
    container.dataset.filled = 'true';
  }

  function objectNode(obj, hits) {
    var node = el('div', 'node');
    var row = makeRow(1, 'object');
    row.dataset.uri = obj.uri;
    row.setAttribute('aria-expanded', String(obj.expanded === true));
    var main = mainCell(1);
    main.appendChild(caretSpan(obj.expanded ? 'caret' : 'caret collapsed'));
    main.appendChild(el('span', 'kind kind-' + obj.kind, obj.kind));
    main.appendChild(el('span', 'name', obj.name));
    // an object with more hits than were sent shows "500+"
    main.appendChild(el('span', 'count', '(' + hits.length + (isCapped(obj, hits.length) ? '+' : '') + ')'));
    var path = el('div', 'cell path', obj.path);
    path.title = obj.uri;
    row.appendChild(main);
    row.appendChild(path);
    var children = el('div', 'children');
    children.setAttribute('role', 'group');
    children.hidden = obj.expanded !== true;
    if (obj.expanded) {
      fillChildren(children, obj, hits);
    }
    node.appendChild(row);
    node.appendChild(children);
    node._obj = obj;
    return node;
  }

  function renderResults() {
    results.textContent = '';
    selected = null;
    objects.forEach(function (obj) {
      var hits = visibleHits(obj);
      if (hits.length > 0) {
        results.appendChild(objectNode(obj, hits));
      }
    });
    updateSummary();
  }

  function toggleNode(node, expand) {
    var obj = node._obj;
    var row = node.firstChild;
    var children = node.lastChild;
    if (expand === undefined) {
      expand = obj.expanded !== true;
    }
    obj.expanded = expand;
    row.setAttribute('aria-expanded', String(expand));
    row.querySelector('.caret').classList.toggle('collapsed', !expand);
    if (expand && children.dataset.filled !== 'true') {
      fillChildren(children, obj, visibleHits(obj));
    }
    children.hidden = !expand;
  }

  function setAllExpanded(expand) {
    results.querySelectorAll('.node').forEach(function (node) {
      toggleNode(node, expand);
    });
  }

  // ---- summary line ----

  // More hits were found than were sent. Under a filter that hides some of the sent hits the count is no longer a floor.
  function isCapped(obj, visibleCount) {
    return obj.total > obj.hits.length && visibleCount === obj.hits.length;
  }

  // Streaming sends many messages: the summary is recomputed once per frame, not once per message.
  var summaryFrame = 0;
  function scheduleSummary() {
    if (!summaryFrame) {
      summaryFrame = requestAnimationFrame(function () {
        summaryFrame = 0;
        updateSummary();
      });
    }
  }

  function counts() {
    var objectCount = 0;
    var matches = 0;
    var capped = false;
    var hidden = 0;
    objects.forEach(function (obj) {
      var hits = visibleHits(obj).length;
      if (hits > 0) {
        objectCount++;
        matches += hits;
        capped = capped || isCapped(obj, hits);
      } else {
        // found, but all of its hits are filtered out by "Limit search to"
        hidden++;
      }
    });
    return { objects: objectCount, matches: matches, capped: capped, hidden: hidden };
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function updateSummary() {
    var c = counts();
    var text = 'Result:';
    summaryEl.classList.toggle('error', message !== '');
    if (message) {
      text = message;
    } else if (running) {
      var done = progress ? ' (' + progress.scanned + ' of ' + progress.total + ' files)' : '';
      text = 'Searching…' + done + ' Matches found in ' + plural(c.objects, 'object');
    } else if (searched && c.objects === 0 && c.hidden === 0) {
      text = 'Result: No matches found';
    } else if (searched && c.objects === 0) {
      text = 'Result: No matches shown';
    } else if (searched) {
      var matchText = c.matches + (c.capped ? '+' : '') + (c.matches === 1 ? ' match' : ' matches');
      text = 'Result: Matches found in ' + plural(c.objects, 'object') + ' (' + matchText + ')';
    }
    if (c.hidden > 0 && message === '') {
      // without this hint a ticked-off property silently drops objects from the list
      text += ' – ' + plural(c.hidden, 'more object') + ' hidden by "Limit search to"';
    }
    if (!running && outcome) {
      if (outcome.cancelled) {
        text += ' – stopped';
      }
      if (outcome.summary.truncated) {
        text += ' – limit reached, narrow the search';
      }
      if (outcome.summary.failed > 0) {
        text += ' – ' + plural(outcome.summary.failed, 'file') + ' could not be read';
      }
    }
    summaryEl.textContent = text;
    $('progress').hidden = !running;
    if (progress) {
      $('progress').max = progress.total;
      $('progress').value = progress.scanned;
    }
    $('start').hidden = running;
    $('stop').hidden = !running;
    $('expand-all').disabled = c.objects === 0;
    $('collapse-all').disabled = c.objects === 0;
  }

  // ---- search ----

  function remember(listId, value) {
    var list = $(listId);
    Array.prototype.slice.call(list.children).forEach(function (option) {
      if (option.value === value) {
        list.removeChild(option);
      }
    });
    var option = el('option');
    option.value = value;
    list.insertBefore(option, list.firstChild);
    while (list.children.length > MAX_HISTORY) {
      list.removeChild(list.lastChild);
    }
  }

  function startSearch() {
    var term = termInput.value.trim();
    if (term === '') {
      message = 'Enter a text to search for.';
      updateSummary();
      termInput.focus();
      return;
    }
    message = '';
    lastTerm = term;
    remember('terms', term);
    saveState();
    vscodeApi.postMessage({
      type: 'search',
      term: term,
      exact: exactInput.checked,
      folder: folderInput.value,
    });
  }

  function addObjects(batch) {
    batch.forEach(function (obj) {
      obj.expanded = false;
      objects.push(obj);
      var hits = visibleHits(obj);
      if (hits.length > 0) {
        results.appendChild(objectNode(obj, hits));
      }
    });
    scheduleSummary();
  }

  function finish(done) {
    running = false;
    searched = true;
    outcome = done;
    if (counts().matches <= AUTO_EXPAND_MATCHES) {
      objects.forEach(function (obj) {
        obj.expanded = true;
      });
      renderResults();
    } else {
      updateSummary();
    }
  }

  // ---- selection, keyboard and opening ----

  function select(row) {
    if (selected) {
      selected.classList.remove('selected');
      selected.tabIndex = -1;
    }
    selected = row;
    if (row) {
      row.classList.add('selected');
      row.tabIndex = 0;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function visibleRows() {
    return Array.prototype.slice.call(results.querySelectorAll('.row')).filter(function (row) {
      return row.offsetParent !== null;
    });
  }

  function openRow(row, asText) {
    vscodeApi.postMessage({ type: 'open', uri: row.dataset.uri, asText: asText, needle: lastTerm });
  }

  results.addEventListener('click', function (event) {
    var row = event.target.closest('.row');
    if (!row) {
      return;
    }
    select(row);
    if (event.target.closest('.caret') && row.classList.contains('object')) {
      toggleNode(row.parentNode);
    }
  });

  results.addEventListener('dblclick', function (event) {
    var row = event.target.closest('.row');
    if (row) {
      openRow(row, event.ctrlKey || event.metaKey);
    }
  });

  results.addEventListener('focus', function () {
    var rows = visibleRows();
    if (!selected && rows.length > 0) {
      select(rows[0]);
    }
  });

  results.addEventListener('keydown', function (event) {
    if (!selected) {
      return;
    }
    var rows = visibleRows();
    var at = rows.indexOf(selected);
    var node = selected.classList.contains('object') ? selected.parentNode : null;
    var handled = true;
    if (event.key === 'ArrowDown') {
      select(rows[Math.min(at + 1, rows.length - 1)]);
    } else if (event.key === 'ArrowUp') {
      select(rows[Math.max(at - 1, 0)]);
    } else if (event.key === 'Home') {
      select(rows[0]);
    } else if (event.key === 'End') {
      select(rows[rows.length - 1]);
    } else if (event.key === 'ArrowRight' && node) {
      if (node._obj.expanded) {
        select(rows[at + 1] || selected);
      } else {
        toggleNode(node, true);
      }
    } else if (event.key === 'ArrowLeft') {
      if (node && node._obj.expanded) {
        toggleNode(node, false);
      } else if (!node) {
        select(selected.parentNode.parentNode.firstChild);
      }
    } else if (event.key === 'Enter') {
      openRow(selected, event.ctrlKey || event.metaKey);
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  });

  // ---- first column width ----

  $('col-grip').addEventListener('mousedown', function (event) {
    event.preventDefault();
    var pane = document.querySelector('.result-pane');
    var left = pane.getBoundingClientRect().left;
    function move(e) {
      var width = Math.max(160, Math.min(e.clientX - left, pane.clientWidth - 160));
      document.documentElement.style.setProperty('--col1', width + 'px');
    }
    function stop() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  });

  // ---- wiring ----

  $('search-form').addEventListener('submit', function (event) {
    event.preventDefault();
    startSearch();
  });
  $('stop').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'stop' });
  });
  $('browse').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'browse' });
  });
  $('expand-all').addEventListener('click', function () {
    setAllExpanded(true);
  });
  $('collapse-all').addEventListener('click', function () {
    setAllExpanded(false);
  });
  [termInput, folderInput, exactInput].forEach(function (input) {
    input.addEventListener('change', saveState);
  });

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data.type !== 'string') {
      return;
    }
    if (data.type === 'init' || data.type === 'folder') {
      folderInput.value = data.folder || folderInput.value;
      saveState();
      if (data.type === 'init') {
        (data.folders || []).forEach(function (folder) {
          remember('folders', folder);
        });
      }
      termInput.focus();
      termInput.select();
    } else if (data.type === 'started') {
      running = true;
      progress = null;
      outcome = null;
      message = '';
      objects = [];
      results.textContent = '';
      selected = null;
      updateSummary();
    } else if (data.type === 'progress') {
      progress = { scanned: data.scanned, total: data.total };
      scheduleSummary();
    } else if (data.type === 'found') {
      addObjects(data.objects);
    } else if (data.type === 'done') {
      finish({ summary: data.summary, cancelled: data.cancelled === true });
    } else if (data.type === 'failed') {
      running = false;
      outcome = null;
      message = data.message;
      updateSummary();
    }
  });

  renderLimits();
  updateSummary();
  vscodeApi.postMessage({ type: 'ready' });
})();
