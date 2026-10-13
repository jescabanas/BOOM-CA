// Rankings read down each column in groups of ten; additional groups wrap.
window.renderRankingColumns = function (rows, renderRow) {
  let html = '';
  for (let start = 0; start < rows.length; start += 10) {
    html += `<div class="ranking-column">${rows.slice(start, start + 10).map(renderRow).join('')}</div>`;
  }
  return html;
};
