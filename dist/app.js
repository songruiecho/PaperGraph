const state = {
  papers: [], keyword: 'all', status: 'all', search: '', selectedId: null,
  transform: { x: 0, y: 0, scale: 1 }, positions: new Map(), frame: null,
  baseKeywords: []
};

const $ = (selector) => document.querySelector(selector);
const els = {
  svg: $('#graph'), viewport: $('#viewport'), edges: $('#edges'), nodes: $('#nodes'),
  keyword: $('#keyword-filter'), search: $('#search-input'), empty: $('#empty-state'),
  detailEmpty: $('#detail-empty'), detail: $('#paper-detail'), summary: $('#summary-input')
};

const storageKey = 'paper-atlas-overrides-v1';
const customKeywordKey = 'paper-atlas-custom-keywords-v1';
const getOverrides = () => JSON.parse(localStorage.getItem(storageKey) || '{}');
const saveOverrides = (value) => localStorage.setItem(storageKey, JSON.stringify(value));
const getCustomKeywords = () => JSON.parse(localStorage.getItem(customKeywordKey) || '[]');
const saveCustomKeywords = (value) => localStorage.setItem(customKeywordKey, JSON.stringify(value));
let savedEditorRange = null;

loadCatalog()
  .catch(() => {
    $('.graph-panel').innerHTML = '<div class="empty-state" style="display:grid"><strong>论文数据载入失败</strong><p>请通过本地服务器或部署地址打开此页面。</p></div>';
  });

async function loadCatalog() {
  const response = await fetch(`papers.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取论文目录');
  const { papers } = await response.json();
  const overrides = getOverrides();
  let overridesChanged = false;
  Object.values(overrides).forEach((override) => {
    if (!Array.isArray(override.keywords) || !override.keywords.includes('Theory')) return;
    override.keywords = [...new Set(override.keywords.map((keyword) => keyword === 'Theory' ? 'ICL Theory' : keyword))];
    overridesChanged = true;
  });
  if (overridesChanged) saveOverrides(overrides);
  state.baseKeywords = [...new Set(papers.flatMap((paper) => paper.keywords))];
  state.papers = papers.map((paper) => {
    const override = overrides[paper.id] || {};
    return { ...paper, ...override, rating: Math.min(5, Math.max(1, Number(override.rating) || 1)) };
  });
  populateKeywords();
  renderAll();
}

function populateKeywords() {
  const current = state.keyword;
  const counts = new Map();
  state.papers.forEach((paper) => paper.keywords.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1)));
  const allKeywords = [...new Set([...state.baseKeywords, ...getCustomKeywords(), ...counts.keys()])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  els.keyword.replaceChildren();
  const allOption = document.createElement('option'); allOption.value = 'all'; allOption.textContent = '全部关键词'; els.keyword.append(allOption);
  allKeywords.forEach((key) => {
    const option = document.createElement('option');
    option.value = key; option.textContent = `${key} · ${counts.get(key) || 0}`; els.keyword.append(option);
  });
  const addOption = document.createElement('option'); addOption.value = '__add__'; addOption.textContent = '＋ 新增关键词…'; els.keyword.append(addOption);
  els.keyword.value = allKeywords.includes(current) ? current : 'all';
  $('#keyword-count').textContent = allKeywords.length;
}

function allKeywords() {
  return [...new Set([...state.baseKeywords, ...getCustomKeywords(), ...state.papers.flatMap((paper) => paper.keywords)])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function persistPaperKeywords(paper) {
  const overrides = getOverrides();
  overrides[paper.id] = { ...(overrides[paper.id] || {}), keywords: paper.keywords };
  saveOverrides(overrides);
}

function createKeyword() {
  const entered = window.prompt('输入新的关键词名称：');
  if (entered === null) return null;
  const keyword = entered.trim();
  if (!keyword) return null;
  const existing = allKeywords().find((item) => item.toLowerCase() === keyword.toLowerCase());
  if (existing) return existing;
  const custom = getCustomKeywords(); custom.push(keyword); saveCustomKeywords(custom);
  return keyword;
}

function visiblePapers() {
  const query = state.search.trim().toLowerCase();
  return state.papers.filter((paper) => {
    const keywordMatch = state.keyword === 'all' || paper.keywords.includes(state.keyword);
    const statusMatch = state.status === 'all' || (state.status === 'read' ? paper.read : !paper.read);
    const haystack = `${paper.title} ${paper.authors} ${paper.venue} ${paper.year}`.toLowerCase();
    return keywordMatch && statusMatch && (!query || haystack.includes(query));
  });
}

function renderAll() {
  renderStats();
  renderGraph();
  if (state.selectedId) renderDetail(state.papers.find((paper) => paper.id === state.selectedId));
}

function renderStats() {
  const read = state.papers.filter((paper) => paper.read).length;
  const total = state.papers.length;
  const percent = total ? Math.round(read / total * 100) : 0;
  $('#total-count').textContent = total;
  $('#read-count').textContent = read;
  $('#progress-label').textContent = `${percent}%`;
  $('#progress-bar').style.width = `${percent}%`;
  $('#progress-note').textContent = `已完成 ${read} 篇，还有 ${total - read} 篇待阅读。`;
}

function renderGraph() {
  cancelAnimationFrame(state.frame);
  const papers = visiblePapers().sort((a, b) => {
    const aKey = a.keywords.join(' / '), bKey = b.keywords.join(' / ');
    return aKey.localeCompare(bKey, 'zh-CN') || a.title.localeCompare(b.title, 'en');
  });
  const keywordSet = new Set();
  papers.forEach((paper) => paper.keywords.forEach((key) => keywordSet.add(key)));
  const keywordNodes = [...keywordSet].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((key, index) => ({ id: `k:${key}`, label: key, type: 'keyword', radius: 8, index }));
  const paperNodes = papers.map((paper, index) => ({ ...paper, label: paper.title, type: 'paper', radius: 5 + paper.rating * .55 + (paper.read ? .7 : 0), index }));
  const nodes = [...keywordNodes, ...paperNodes];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const links = papers.flatMap((paper) => paper.keywords.map((key) => ({ source: nodeMap.get(paper.id), target: nodeMap.get(`k:${key}`) })));

  $('#scope-title').textContent = state.keyword === 'all' ? '全部论文' : state.keyword;
  $('#scope-count').textContent = `显示 ${papers.length} / ${state.papers.length}`;
  els.empty.hidden = papers.length > 0;
  els.edges.replaceChildren(); els.nodes.replaceChildren();
  if (!papers.length) return;

  const rect = els.svg.getBoundingClientRect();
  const width = Math.max(rect.width, 560);
  const top = 40;
  const keywordX = Math.max(86, width * .15);
  const paperX = Math.max(300, width * .43);
  const paperTextWidth = Math.max(180, width - paperX - 26);
  const paperMaxChars = Math.max(24, Math.floor(paperTextWidth / 6.3));

  let nextPaperY = top;
  paperNodes.forEach((node) => {
    node.labelLines = wrapSvgText(`★${node.rating} · ${node.label}`, paperMaxChars);
    node.rowHeight = Math.max(36, node.labelLines.length * 15 + 12);
    node.x = paperX;
    node.y = nextPaperY;
    nextPaperY += node.rowHeight;
  });
  const height = Math.max(rect.height - 98, nextPaperY + 24);
  els.svg.style.height = `${height}px`;
  els.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  keywordNodes.forEach((node) => {
    const connected = paperNodes.filter((paper) => paper.keywords.includes(node.label));
    node.x = keywordX;
    node.idealY = connected.length ? connected.reduce((sum, paper) => sum + paper.y, 0) / connected.length : top;
  });
  const keywordGap = 38;
  const orderedKeywords = [...keywordNodes].sort((a, b) => a.idealY - b.idealY || a.label.localeCompare(b.label, 'zh-CN'));
  orderedKeywords.forEach((node, index) => {
    node.y = index === 0 ? Math.max(top, node.idealY) : Math.max(node.idealY, orderedKeywords[index - 1].y + keywordGap);
  });
  const keywordBottom = height - 24;
  if (orderedKeywords.length && orderedKeywords[orderedKeywords.length - 1].y > keywordBottom) {
    orderedKeywords[orderedKeywords.length - 1].y = keywordBottom;
    for (let index = orderedKeywords.length - 2; index >= 0; index -= 1) {
      orderedKeywords[index].y = Math.min(orderedKeywords[index].y, orderedKeywords[index + 1].y - keywordGap);
    }
  }

  links.forEach((link) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const sx = link.target.x + link.target.radius, sy = link.target.y;
    const tx = link.source.x - link.source.radius, ty = link.source.y;
    const bend = sx + (tx - sx) * .52;
    path.setAttribute('d', `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty}, ${tx} ${ty}`);
    path.setAttribute('class', 'edge'); path.setAttribute('fill', 'none');
    els.edges.append(path); link.el = path;
  });

  nodes.forEach((node) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `node ${node.type} ${node.type === 'paper' ? (node.read ? 'read' : 'unread') : ''}${node.id === state.selectedId ? ' selected' : ''}`);
    group.dataset.id = node.id;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', node.radius);
    group.append(circle);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', node.radius + 7);
    const keywordMaxChars = Math.max(10, Math.min(30, Math.floor((paperX - keywordX - 42) / 7)));
    if (node.type === 'keyword') {
      text.setAttribute('y', 3);
      text.textContent = `${shorten(node.label, keywordMaxChars)} · ${papers.filter((paper) => paper.keywords.includes(node.label)).length}`;
    } else {
      const firstLineY = 3 - ((node.labelLines.length - 1) * 15) / 2;
      text.setAttribute('y', firstLineY);
      node.labelLines.forEach((line, index) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', node.radius + 7);
        if (index > 0) tspan.setAttribute('dy', 15);
        tspan.textContent = line;
        text.append(tspan);
      });
    }
    group.append(text);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = node.type === 'keyword' ? `关键词：${node.label}` : `${node.title}\n右键修改标题并同步重命名本地 PDF`;
    group.append(title);
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      if (node.type === 'keyword') { state.keyword = node.label; els.keyword.value = node.label; renderGraph(); }
      else { state.selectedId = node.id; renderDetail(node); renderGraph(); }
    });
    group.addEventListener('contextmenu', (event) => {
      if (node.type !== 'paper') return;
      event.preventDefault();
      event.stopPropagation();
      renamePaper(node.id);
    });
    group.setAttribute('transform', `translate(${node.x},${node.y})`);
    els.nodes.append(group); node.el = group;
  });
}

function renderDetail(paper) {
  if (!paper) return;
  savedEditorRange = null;
  els.detailEmpty.hidden = true; els.detail.hidden = false;
  const title = $('#paper-title');
  title.textContent = paper.title;
  title.href = `/open-pdf?path=${encodeURIComponent(paper.path)}`;
  $('#rating-label').textContent = `${paper.rating} / 5`;
  document.querySelectorAll('#rating-stars button').forEach((button) => {
    const active = Number(button.dataset.rating) <= paper.rating;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(Number(button.dataset.rating) === paper.rating));
  });
  if (paper.summaryHtml) {
    els.summary.innerHTML = sanitizeSummaryHtml(paper.summaryHtml);
  } else {
    els.summary.textContent = paper.summary || '';
  }
  const list = $('#paper-keywords'); list.replaceChildren();
  paper.keywords.forEach((keyword) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = keyword;
    button.title = `从当前论文移除“${keyword}”`;
    button.addEventListener('click', () => {
      paper.keywords = paper.keywords.filter((item) => item !== keyword);
      persistPaperKeywords(paper); populateKeywords(); renderAll();
    });
    list.append(button);
  });
  const editor = $('#paper-keyword-editor'); editor.replaceChildren();
  const available = allKeywords().filter((keyword) => !paper.keywords.includes(keyword));
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = available.length ? '选择关键词…' : '暂无可添加关键词'; editor.append(placeholder);
  available.forEach((keyword) => { const option = document.createElement('option'); option.value = keyword; option.textContent = keyword; editor.append(option); });
  editor.disabled = !available.length;
  $('#add-paper-keyword').disabled = !available.length;
}

function saveSummary() {
  const paper = state.papers.find((item) => item.id === state.selectedId);
  if (!paper) return;
  paper.summaryHtml = sanitizeSummaryHtml(els.summary.innerHTML);
  els.summary.innerHTML = paper.summaryHtml;
  paper.summary = els.summary.innerText.trim();
  paper.read = Boolean(paper.summary || els.summary.querySelector('img'));
  const overrides = getOverrides(); overrides[paper.id] = { ...(overrides[paper.id] || {}), summary: paper.summary, summaryHtml: paper.summaryHtml, read: paper.read, keywords: paper.keywords, rating: paper.rating }; saveOverrides(overrides);
  $('#save-state').textContent = paper.read ? '已保存 · 已标记为已读' : '已清空 · 标记为未读';
  renderAll();
  setTimeout(() => { $('#save-state').textContent = '本地保存'; }, 2200);
}

function sanitizeSummaryHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (node.tagName === 'IMG') {
        if (!['src', 'alt'].includes(name)) node.removeAttribute(attribute.name);
      } else {
        node.removeAttribute(attribute.name);
      }
    });
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      try {
        const url = new URL(src, window.location.origin);
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/user-assets/')) node.remove();
      } catch { node.remove(); }
    }
  });
  return template.innerHTML;
}

function rememberEditorSelection() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (els.summary.contains(range.commonAncestorContainer)) savedEditorRange = range.cloneRange();
}

function restoreEditorSelection() {
  els.summary.focus();
  if (!savedEditorRange) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedEditorRange);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadAndInsertImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) {
    $('#save-state').textContent = '图片不能超过 10 MB';
    return;
  }
  $('#save-state').textContent = '正在保存图片…';
  try {
    const dataUrl = await readAsDataUrl(file);
    const response = await fetch('/upload-image', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataUrl });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    restoreEditorSelection();
    const image = document.createElement('img');
    image.src = result.url; image.alt = file.name || '摘要图片';
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range && els.summary.contains(range.commonAncestorContainer)) {
      range.deleteContents(); range.insertNode(image); range.setStartAfter(image); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    } else {
      els.summary.append(image);
    }
    els.summary.append(document.createElement('br'));
    rememberEditorSelection();
    $('#save-state').textContent = '图片已插入，记得保存摘要';
  } catch {
    $('#save-state').textContent = '图片插入失败，请确认通过新版 EXE 启动';
  }
}

function startNodeDrag(event, node, element) {
  event.stopPropagation(); element.setPointerCapture(event.pointerId); node.fixed = true;
  const move = (e) => {
    const point = svgPoint(e); node.x = point.x; node.y = point.y; node.vx = node.vy = 0;
  };
  const end = () => { node.fixed = false; element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); };
  element.addEventListener('pointermove', move); element.addEventListener('pointerup', end);
}

function svgPoint(event) {
  const rect = els.svg.getBoundingClientRect();
  return { x: (event.clientX - rect.left - state.transform.x) / state.transform.scale, y: (event.clientY - rect.top - state.transform.y) / state.transform.scale };
}

function applyTransform() {
  const { x, y, scale } = state.transform;
  els.viewport.setAttribute('transform', `translate(${x},${y}) scale(${scale})`);
}

let canvasDrag = null;
els.svg.addEventListener('pointerdown', (event) => { if (event.target === els.svg) canvasDrag = { x: event.clientX, y: event.clientY, ox: state.transform.x, oy: state.transform.y }; });
els.svg.addEventListener('pointermove', (event) => { if (canvasDrag) { state.transform.x = canvasDrag.ox + event.clientX - canvasDrag.x; state.transform.y = canvasDrag.oy + event.clientY - canvasDrag.y; applyTransform(); } });
els.svg.addEventListener('pointerup', () => { canvasDrag = null; });
els.svg.addEventListener('wheel', (event) => { if (!event.ctrlKey) return; event.preventDefault(); state.transform.scale = Math.max(.55, Math.min(1.8, state.transform.scale * (event.deltaY > 0 ? .9 : 1.1))); applyTransform(); }, { passive: false });

els.keyword.addEventListener('change', () => {
  if (els.keyword.value === '__add__') {
    const keyword = createKeyword();
    populateKeywords();
    if (keyword) { state.keyword = keyword; els.keyword.value = keyword; }
    else { els.keyword.value = state.keyword; }
  } else {
    state.keyword = els.keyword.value;
  }
  renderGraph();
});
els.search.addEventListener('input', () => { state.search = els.search.value; renderGraph(); });
$('#status-filter').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  state.status = button.dataset.status;
  document.querySelectorAll('#status-filter button').forEach((item) => item.classList.toggle('active', item === button));
  renderGraph();
});
$('#reset-filters').addEventListener('click', () => {
  state.keyword = 'all'; state.status = 'all'; state.search = ''; els.keyword.value = 'all'; els.search.value = '';
  document.querySelectorAll('#status-filter button').forEach((item) => item.classList.toggle('active', item.dataset.status === 'all'));
  renderGraph();
});
$('#fit-graph').addEventListener('click', () => { state.transform = { x: 0, y: 0, scale: 1 }; applyTransform(); });
document.querySelectorAll('.editor-toolbar button[data-command]').forEach((button) => {
  button.addEventListener('mousedown', (event) => { event.preventDefault(); rememberEditorSelection(); });
  button.addEventListener('click', () => {
    restoreEditorSelection();
    document.execCommand(button.dataset.command, false, null);
    rememberEditorSelection();
  });
});
els.summary.addEventListener('keyup', rememberEditorSelection);
els.summary.addEventListener('mouseup', rememberEditorSelection);
els.summary.addEventListener('focus', rememberEditorSelection);
els.summary.addEventListener('paste', (event) => {
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;
  event.preventDefault(); rememberEditorSelection(); uploadAndInsertImage(imageItem.getAsFile());
});
els.summary.addEventListener('dragover', (event) => { if ([...(event.dataTransfer?.files || [])].some((file) => file.type.startsWith('image/'))) event.preventDefault(); });
els.summary.addEventListener('drop', (event) => {
  const image = [...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/'));
  if (!image) return;
  event.preventDefault(); rememberEditorSelection(); uploadAndInsertImage(image);
});
$('#insert-image').addEventListener('mousedown', (event) => { event.preventDefault(); rememberEditorSelection(); });
$('#insert-image').addEventListener('click', () => $('#summary-image-input').click());
$('#summary-image-input').addEventListener('change', (event) => {
  uploadAndInsertImage(event.target.files?.[0]);
  event.target.value = '';
});
$('#save-summary').addEventListener('click', saveSummary);
$('#refresh-catalog').addEventListener('click', async () => {
  const button = $('#refresh-catalog');
  const status = $('#refresh-status');
  button.disabled = true;
  status.textContent = '正在扫描论文目录…';
  try {
    const response = await fetch('/refresh-catalog', { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    await loadCatalog();
    if (result.added || result.moved || result.removed) {
      const parts = [];
      if (result.added) parts.push(`新增 ${result.added} 篇`);
      if (result.moved) parts.push(`同步 ${result.moved} 篇路径`);
      if (result.removed) parts.push(`移除 ${result.removed} 条失效记录`);
      status.textContent = `${parts.join('，')}，共 ${result.total} 篇`;
    } else {
      status.textContent = `没有变化，共 ${result.total} 篇`;
    }
  } catch (error) {
    status.textContent = '更新失败，请确认通过 EXE 启动';
  } finally {
    button.disabled = false;
  }
});
$('#paper-title').addEventListener('click', async (event) => {
  event.preventDefault();
  const link = event.currentTarget;
  const previous = $('#save-state').textContent;
  $('#save-state').textContent = '正在调用本地 PDF 阅读器…';
  try {
    const response = await fetch(link.href, { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());
    $('#save-state').textContent = '已在本地阅读器中打开';
  } catch (error) {
    $('#save-state').textContent = '打开失败，请确认文件仍在原位置';
  }
  setTimeout(() => { $('#save-state').textContent = previous; }, 2400);
});
$('#rating-stars').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-rating]');
  const paper = state.papers.find((item) => item.id === state.selectedId);
  if (!button || !paper) return;
  paper.rating = Math.min(5, Math.max(1, Number(button.dataset.rating)));
  const overrides = getOverrides();
  overrides[paper.id] = { ...(overrides[paper.id] || {}), rating: paper.rating };
  saveOverrides(overrides);
  renderAll();
});
$('#add-paper-keyword').addEventListener('click', () => {
  const paper = state.papers.find((item) => item.id === state.selectedId);
  const keyword = $('#paper-keyword-editor').value;
  if (!paper || !keyword || paper.keywords.includes(keyword)) return;
  paper.keywords = [...paper.keywords, keyword];
  persistPaperKeywords(paper); populateKeywords(); renderAll();
});

async function renamePaper(paperId) {
  const paper = state.papers.find((item) => item.id === paperId);
  if (!paper) return;
  const entered = window.prompt('修改论文标题（保存后将同步重命名本地 PDF）：', paper.title);
  if (entered === null) return;
  const title = entered.trim();
  if (!title || title === paper.title) return;
  const status = $('#refresh-status');
  status.textContent = '正在同步修改标题和本地文件名…';
  try {
    const body = new URLSearchParams({ id: paper.id, path: paper.path, title });
    const response = await fetch('/rename-paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString()
    });
    if (!response.ok) throw new Error(await response.text());
    const updated = await response.json();
    Object.assign(paper, updated);
    state.selectedId = paper.id;
    renderAll();
    status.textContent = '标题与本地 PDF 文件名已同步更新';
  } catch (error) {
    status.textContent = `标题修改失败：${error.message || '请确认通过新版 EXE 启动'}`;
    window.alert(status.textContent);
  }
}
function shorten(text, max) { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }

function wrapSvgText(text, maxChars) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    while (word.length > maxChars) {
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    current = word;
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
