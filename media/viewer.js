(function () {
  'use strict';

  function setRowsHidden(table, parentId, hidden) {
    table.querySelectorAll('tr[data-parent="' + parentId + '"]').forEach(function (row) {
      row.classList.toggle('hidden', hidden);
      var caret = row.querySelector('.caret[data-toggle]');
      var childHidden = hidden || (caret && caret.classList.contains('collapsed'));
      setRowsHidden(table, row.dataset.id, childHidden);
    });
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    var caret = target.closest('.caret[data-toggle]');
    if (caret) {
      var collapsed = caret.classList.toggle('collapsed');
      setRowsHidden(caret.closest('table'), caret.dataset.toggle, collapsed);
      return;
    }
    var heading = target.closest('h2[data-toggle-network]');
    if (heading) {
      heading.parentElement.classList.toggle('collapsed');
      heading.querySelector('.caret').classList.toggle('collapsed');
    }
  });

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
})();
