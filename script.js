/* ==========================================================================
   课堂随机点名器 —— 星空版
   无外部依赖，直接打开 index.html 即可离线使用。
   分层：状态与存储 → 名单解析 → 导入/预览 → 点名引擎 → 星空视图 → 事件绑定
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const unique = (arr) => Array.from(new Set(arr));
const KEY_STATE = 'rollcall_state_v2';
const KEY_THEME = 'rollcall_theme_v1';
const KEY_SYNC_REPO = 'rollcall_sync_repo_v1';
const SESSION_TOKEN = 'rollcall_pat_session_v1';
const LEGACY = {
  all: 'rollcall_all_names_v1',
  called: 'rollcall_called_names_v1',
  listName: 'rollcall_current_list_name_v1'
};
const DEFAULT_GROUP = '全班';
const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  allNames: [],        // 待点
  calledNames: [],     // 已点（最近点名的排在最前）
  groups: [],          // 组名数组，有序；可为空/一项/多项
  groupOf: {},         // 姓名 -> 组名
  listName: '',
  rolling: false,
  highlight: '',
  lastShown: '',
  lit: null            // 最近一次点亮 { name, t0 }
};

const el = {};
[
  'themeToggle', 'themeIcon',
  'namesInputTitle', 'namesInputTitleText', 'namesInput', 'namesHint',
  'listCard', 'listBody', 'toggleListCard', 'listSummary',
  'dropZone', 'fileInput', 'shuffle', 'clearAll', 'totalCount', 'remainingCount',
  'starView', 'starCanvas', 'starGroupName', 'starName', 'starProgress', 'starLegend',
  'toggleRollBtn', 'markBtn',
  'calledPanelBtn', 'calledDrawer', 'closeCalledDrawer',
  'calledList', 'calledDropHint', 'calledCount', 'calledFileInput',
  'importCalled', 'copyCalled', 'exportCalled', 'quickSync', 'clearCalled',
  'importFromGitHub', 'githubModal', 'closeModal', 'githubRepo', 'fetchCSV', 'csvFiles',
  'importModal', 'closeImportModal', 'cancelImport', 'confirmImport',
  'importSource', 'importSummary', 'importGroups', 'importIssues', 'importPreview', 'resetCalledRow', 'resetCalled',
  'calledImportModal', 'closeCalledImportModal', 'cancelCalledImport', 'confirmCalledImport',
  'calledImportSource', 'calledImportSummary', 'calledImportPreview',
  'syncModal', 'closeSyncModal', 'cancelSync', 'submitSync', 'syncRepo', 'syncToken',
  'toggleAdvanced', 'advancedFields', 'syncPath', 'syncTitleInput', 'syncBranch',
  'syncStatus', 'toast'
].forEach((id) => { el[id] = $(id); });

let rollTimer = null;
let inputDebounce = null;
let toastTimer = null;
let pendingImport = null;
let pendingCalledImport = null;

/* --------------------------------------------------------------------------
   通用工具
   -------------------------------------------------------------------------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
}

function openModal(id) { el[id].classList.add('is-open'); }
function closeModal(id) { el[id].classList.remove('is-open'); }

/* 已点名单抽屉：开/关时同步头部按钮的 aria-expanded，焦点进出有来有回 */
function openCalledPanel() {
  el.calledDrawer.classList.add('is-open');
  el.calledPanelBtn.setAttribute('aria-expanded', 'true');
  el.closeCalledDrawer.focus();
}

function closeCalledPanel() {
  el.calledDrawer.classList.remove('is-open');
  el.calledPanelBtn.setAttribute('aria-expanded', 'false');
  el.calledPanelBtn.focus();
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function timeParts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    compact: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`,
    full: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
  };
}

function sanitizeForPath(name) {
  const slug = String(name || '').normalize('NFKC')
    .replace(/[^\p{L}\p{N}\-_]+/gu, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return slug || 'manual-list';
}

/* --------------------------------------------------------------------------
   主题
   -------------------------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.classList.toggle('light-theme', theme === 'light');
  const use = el.themeIcon.firstElementChild;
  if (use) use.setAttribute('href', theme === 'light' ? '#i-sun' : '#i-moon');
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY_THEME); } catch (e) { /* 隐私模式 */ }
  if (!saved) {
    saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(saved);
}

el.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.classList.contains('light-theme') ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem(KEY_THEME, next); } catch (e) { /* ignore */ }
  readStarTokens();
});

/* --------------------------------------------------------------------------
   状态、存储与旧版迁移
   -------------------------------------------------------------------------- */
function allStudents() { return unique([...state.allNames, ...state.calledNames]); }

function ensureGroupCoverage() {
  if (!state.groups.length) state.groups = [DEFAULT_GROUP];
  const primary = state.groups[0];
  allStudents().forEach((n) => {
    if (!state.groupOf[n]) state.groupOf[n] = primary;
  });
  // 只保留实际还有成员的组
  const active = new Set(Object.values(state.groupOf));
  state.groups = state.groups.filter((g) => active.has(g));
  if (!state.groups.length) state.groups = [primary];
}

function saveState() {
  try {
    localStorage.setItem(KEY_STATE, JSON.stringify({
      allNames: state.allNames,
      calledNames: state.calledNames,
      groups: state.groups,
      groupOf: state.groupOf,
      listName: state.listName
    }));
  } catch (e) { console.warn('保存失败', e); }
}

function loadState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY_STATE) || 'null'); } catch (e) { /* ignore */ }

  if (!raw) {
    // 从 v1 平滑迁移：旧 key 只读不删，用户数据保持原样
    let all = [], called = [], listName = '';
    try {
      all = JSON.parse(localStorage.getItem(LEGACY.all) || '[]');
      called = JSON.parse(localStorage.getItem(LEGACY.called) || '[]');
      listName = localStorage.getItem(LEGACY.listName) || '';
    } catch (e) { /* ignore */ }
    if (!Array.isArray(all)) all = [];
    if (!Array.isArray(called)) called = [];
    const group = listName || DEFAULT_GROUP;
    raw = {
      allNames: all.filter((x) => typeof x === 'string' && x.trim()),
      calledNames: called.filter((x) => typeof x === 'string' && x.trim()),
      groups: [group],
      groupOf: {},
      listName
    };
    unique([...raw.allNames, ...raw.calledNames]).forEach((n) => { raw.groupOf[n] = group; });
  }

  state.allNames = Array.isArray(raw.allNames) ? raw.allNames.filter((x) => typeof x === 'string' && x.trim()) : [];
  state.calledNames = Array.isArray(raw.calledNames) ? raw.calledNames.filter((x) => typeof x === 'string' && x.trim()) : [];
  state.groups = Array.isArray(raw.groups) ? raw.groups.filter((g) => typeof g === 'string' && g.trim()) : [];
  state.groupOf = (raw.groupOf && typeof raw.groupOf === 'object') ? raw.groupOf : {};
  state.listName = typeof raw.listName === 'string' ? raw.listName : '';
  // 旧版本 v2 数据里可能带有 mode 字段（classic/star），星空版一律忽略
  ensureGroupCoverage();
}

/* --------------------------------------------------------------------------
   名单解析：纯文本 / CSV / TSV，自动识别表头、姓名列与班级列
   -------------------------------------------------------------------------- */
function splitRows(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .split('\n').filter((r) => r.trim().length > 0);
}

function detectDelimiter(line) {
  let best = null, bestCount = 0;
  ['\t', ',', ';', '，', '；'].forEach((d) => {
    const count = line.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  });
  return best; // null 表示单列
}

function parseLine(line, delim) {
  if (!delim) return [line.trim()];
  const cells = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delim && !quoted) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const HEADER_WORD = /^(姓名|名字|学生姓名|学生|名单|name|student|full\s*name|学号|序号|编号|班级|class|group|年级|专业|id|no\.?)$/i;

function isHeaderRow(cells) {
  if (!cells || !cells.length) return false;
  if (cells.length === 1) return HEADER_WORD.test(cells[0].trim());
  return cells.some((c) => HEADER_WORD.test(c.trim()));
}

function isNumericCell(s) { return /^\d+$/.test(String(s || '').trim()); }

function pickNameColumn(cells, header) {
  if (header) {
    const idx = header.findIndex((c) => /姓名|名字|name/i.test(c));
    if (idx >= 0) return idx;
  }
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i] || '';
    if (c && !isNumericCell(c) && !/^(班级|class|group|年级|专业|学号|序号|编号|id)$/i.test(c)) return i;
  }
  return 0;
}

function findClassColumn(header) {
  if (!header) return -1;
  return header.findIndex((c) => /班级|class|group/i.test(c));
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/^["'「『]|["'」』]$/g, '').trim();
}

/**
 * 把一段名单文本解析成 [{name, group}]。
 * fallbackGroup 通常是文件名；没有班级信息时，整份名单就是一组 → 全班一片星空。
 */
function parseRoster(text, fallbackGroup) {
  const rows = splitRows(text);
  const issues = [];
  if (!rows.length) return { items: [], issues: ['文件里没有可识别的内容'], hasClassColumn: false };

  const delim = detectDelimiter(rows[0]);
  const table = rows.map((r) => parseLine(r, delim));
  let header = null;
  if (isHeaderRow(table[0])) header = table.shift();

  const nameCol = pickNameColumn(table[0] || [], header);
  const classCol = findClassColumn(header);
  const items = [];

  table.forEach((cells, i) => {
    const name = cleanName(cells[nameCol]);
    if (!name) { issues.push(`第 ${i + 1} 行未识别到姓名，已跳过`); return; }
    if (isHeaderRow(cells)) { issues.push(`第 ${i + 1} 行疑似表头，已跳过`); return; }
    if (name.length > 24) issues.push(`第 ${i + 1} 行内容偏长（${name.length} 字），请留意`);
    const group = classCol >= 0 ? cleanName(cells[classCol]) : '';
    items.push({ name, group: group || fallbackGroup || DEFAULT_GROUP });
  });

  return { items, issues, hasClassColumn: classCol >= 0 };
}

function parseTextarea() {
  const raw = el.namesInput.value.trim();
  if (!raw) return [];
  return unique(raw.split(/[\n,;，；]+/).map((s) => cleanName(s)).filter(Boolean));
}

/* --------------------------------------------------------------------------
   导入预览（名单）
   -------------------------------------------------------------------------- */
function buildImportPreview(parts) {
  const seen = new Set(), duplicates = [], items = [];
  parts.forEach((p) => p.items.forEach((it) => {
    if (seen.has(it.name)) { duplicates.push(it.name); return; }
    seen.add(it.name); items.push(it);
  }));
  const groupMap = new Map();
  items.forEach((it) => {
    const g = it.group || DEFAULT_GROUP;
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g).push(it.name);
  });
  const issues = parts.flatMap((p) => p.issues.map((s) => `${p.file}：${s}`));
  const hasClassColumn = parts.some((p) => p.hasClassColumn);
  // 名单明确带来分组信息（班级列 / 多份文件）时，之前自动兜底的「全班」
  // 不再单独占一个星区，否则预览看到的星区数会和落地结果对不上。
  const dropDefault = hasClassColumn || parts.length > 1;
  const existingGroups = state.groups.filter((g) => !(dropDefault && g === DEFAULT_GROUP));
  return {
    items, duplicates, groupMap, issues,
    sources: parts.map((p) => p.file),
    hasClassColumn, dropDefault,
    groupCountAppend: unique([...existingGroups, ...groupMap.keys()]).length,
    groupCountReplace: groupMap.size,
    existingCount: allStudents().length
  };
}

function statBox(value, label) {
  return `<div class="stat-box"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function renderChips(container, names, limit = 12) {
  container.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'preview-label';
  label.textContent = `姓名预览${names.length > limit ? `（前 ${limit} 位）` : ''}`;
  container.appendChild(label);
  const row = document.createElement('div');
  row.className = 'chip-row';
  names.slice(0, limit).forEach((n) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = n;
    row.appendChild(chip);
  });
  if (names.length > limit) {
    const more = document.createElement('span');
    more.className = 'chip chip-muted';
    more.textContent = `… 另 ${names.length - limit} 人`;
    row.appendChild(more);
  }
  if (!names.length) {
    const empty = document.createElement('span');
    empty.className = 'chip chip-muted';
    empty.textContent = '没有可导入的姓名';
    row.appendChild(empty);
  }
  container.appendChild(row);
}

/** 预览里的星区数必须等于确认导入后的真实星区数，切换写入方式时同步刷新 */
function renderImportStats() {
  if (!pendingImport) return;
  const d = pendingImport;
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const groupCount = mode === 'replace' ? d.groupCountReplace : d.groupCountAppend;
  el.importSummary.innerHTML = [
    statBox(d.items.length, '识别到人数'),
    statBox(groupCount, '导入后星区数'),
    statBox(d.duplicates.length, '重复姓名（自动去重）')
  ].join('');
  const note = mode === 'append' && d.existingCount
    ? ` 当前已有 ${d.existingCount} 人，追加后共 ${groupCount} 个星区${d.dropDefault ? '，未分组的现有学生归入第一片星区' : ''}。`
    : '';
  el.importSource.textContent = `来源：${d.sources.join('、')}${d.hasClassColumn ? ' · 识别到班级列' : ''}。${note}`;
}

function openImportPreview(parts) {
  pendingImport = buildImportPreview(parts);
  const d = pendingImport;

  if (d.groupMap.size) {
    const rows = [...d.groupMap.entries()].map(([g, names]) =>
      `<tr><td>${esc(g)}</td><td>${esc(names.slice(0, 4).join('、'))}${names.length > 4 ? ' …' : ''}</td><td>${names.length} 人</td></tr>`).join('');
    el.importGroups.innerHTML = `<table><thead><tr><th>星区 / 分组</th><th>示例</th><th>人数</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    el.importGroups.innerHTML = '';
  }

  el.importIssues.innerHTML = '';
  const shown = d.issues.slice(0, 3);
  shown.forEach((s) => {
    const line = document.createElement('div');
    line.className = 'issue-line';
    line.innerHTML = `<svg class="icon"><use href="#i-alert" /></svg><span>${esc(s)}</span>`;
    el.importIssues.appendChild(line);
  });
  if (d.issues.length > 3) {
    const more = document.createElement('div');
    more.className = 'issue-more';
    more.textContent = `另有 ${d.issues.length - 3} 条提示`;
    el.importIssues.appendChild(more);
  }
  if (!d.issues.length && d.duplicates.length) {
    const line = document.createElement('div');
    line.className = 'issue-line';
    line.innerHTML = `<svg class="icon"><use href="#i-alert" /></svg><span>重复姓名：${esc(d.duplicates.slice(0, 6).join('、'))}${d.duplicates.length > 6 ? ' …' : ''}</span>`;
    el.importIssues.appendChild(line);
  }

  renderChips(el.importPreview, d.items.map((it) => it.name));
  document.querySelector('input[name="importMode"][value="append"]').checked = true;
  el.resetCalled.checked = false;
  el.resetCalledRow.hidden = true;
  renderImportStats();
  openModal('importModal');
}

function confirmImport() {
  if (!pendingImport) return;
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const resetCalled = el.resetCalled.checked;
  const d = pendingImport;
  const newGroupOf = {};
  d.items.forEach((it) => { newGroupOf[it.name] = it.group || DEFAULT_GROUP; });
  const newNames = d.items.map((it) => it.name);

  if (mode === 'replace') {
    state.allNames = [];
    state.groupOf = {};
    state.groups = [];
    if (resetCalled) state.calledNames = [];
    state.listName = '';
  } else if (d.dropDefault) {
    // 撤掉此前自动兜底的「全班」标签：预览报几个星区，落地就是几个
    Object.keys(state.groupOf).forEach((n) => {
      if (state.groupOf[n] === DEFAULT_GROUP) delete state.groupOf[n];
    });
    state.groups = state.groups.filter((g) => g !== DEFAULT_GROUP);
  }

  const calledSet = new Set(state.calledNames);
  state.allNames = unique([...state.allNames, ...newNames.filter((n) => !calledSet.has(n))]);
  Object.assign(state.groupOf, newGroupOf);
  state.groups = unique([...state.groups, ...Object.values(newGroupOf)]);
  state.listName = d.sources.length === 1
    ? d.sources[0].replace(/\.(txt|csv|tsv)$/i, '')
    : `${d.sources.length} 份名单`;

  ensureGroupCoverage();
  saveState();
  syncTextarea();
  updateNamesTitle();
  renderAll({ keepResult: false });
  closeModal('importModal');
  pendingImport = null;
  const finalGroups = state.groups.length;
  toast(`已导入 ${d.items.length} 人${finalGroups > 1 ? `，共 ${finalGroups} 个星区` : '，全班一片星空'}`);
  computeStarLayout();
}

/* --------------------------------------------------------------------------
   已点名单传回预览
   -------------------------------------------------------------------------- */
function openCalledImportPreview(parts) {
  const ordered = unique(parts.flatMap((p) => p.items.map((it) => it.name)));
  const existing = new Set(state.calledNames);
  pendingCalledImport = {
    toAdd: ordered.filter((n) => !existing.has(n)),
    skipped: ordered.filter((n) => existing.has(n)),
    sources: parts.map((p) => p.file),
    issues: parts.flatMap((p) => p.issues)
  };
  const d = pendingCalledImport;
  el.calledImportSource.textContent = `来源：${d.sources.join('、')}`;
  el.calledImportSummary.innerHTML = [
    statBox(d.toAdd.length, '将补入已点'),
    statBox(d.skipped.length, '已存在，跳过'),
    statBox(state.allNames.length - d.toAdd.filter((n) => state.allNames.includes(n)).length, '合并后剩余待点')
  ].join('');
  renderChips(el.calledImportPreview, d.toAdd);
  openModal('calledImportModal');
}

function confirmCalledImport() {
  if (!pendingCalledImport) return;
  const { toAdd } = pendingCalledImport;
  const addSet = new Set(toAdd);
  state.allNames = state.allNames.filter((n) => !addSet.has(n));
  state.calledNames = [...state.calledNames, ...toAdd];
  ensureGroupCoverage();
  saveState();
  syncTextarea();
  renderAll({ keepResult: false });
  closeModal('calledImportModal');
  pendingCalledImport = null;
  toast(`已传回 ${toAdd.length} 人，点名进度已续上`);
  computeStarLayout();
}

/* --------------------------------------------------------------------------
   文件入口：拖拽 / 点选
   -------------------------------------------------------------------------- */
async function handleFiles(fileList, target) {
  const files = Array.from(fileList).filter((f) => /\.(txt|csv|tsv)$/i.test(f.name) || /text|csv|tsv/.test(f.type));
  if (!files.length) { toast('请选择 .txt / .csv / .tsv 名单文件'); return; }
  const parts = [];
  for (const f of files) {
    try {
      const text = await f.text();
      const fallback = f.name.replace(/\.(txt|csv|tsv)$/i, '').trim() || DEFAULT_GROUP;
      parts.push({ file: f.name, ...parseRoster(text, fallback) });
    } catch (e) {
      toast(`读取 ${f.name} 失败`);
    }
  }
  if (!parts.length) return;
  if (target === 'called') openCalledImportPreview(parts);
  else openImportPreview(parts);
}

function bindDrop(zone, target, classNames) {
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault();
    classNames.forEach((c) => c.classList.add('is-dragover'));
  }));
  zone.addEventListener('dragleave', (e) => {
    if (zone.contains(e.relatedTarget)) return;
    classNames.forEach((c) => c.classList.remove('is-dragover'));
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    classNames.forEach((c) => c.classList.remove('is-dragover'));
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, target);
  });
}

/* --------------------------------------------------------------------------
   点名引擎（两种视图共用）
   -------------------------------------------------------------------------- */
function startRoll() {
  if (state.rolling) return;
  if (!state.allNames.length) { toast('名单为空，请先导入名单'); return; }
  state.rolling = true;
  state.lastShown = '';
  state.lit = null;
  rollTimer = setInterval(() => {
    if (!state.allNames.length) return;
    const pick = state.allNames[Math.floor(Math.random() * state.allNames.length)];
    state.highlight = pick;
    state.lastShown = pick;
    showRolling(pick);
  }, 70);
  renderRollButtons();
}

function stopRoll() {
  if (!state.rolling) return;
  clearInterval(rollTimer);
  rollTimer = null;
  state.rolling = false;
  const chosen = state.lastShown;
  renderRollButtons();
  if (!chosen || !state.allNames.includes(chosen)) { state.highlight = ''; renderAll({ keepResult: false }); return; }
  markName(chosen);
}

function markName(name) {
  if (!name) return;
  const idx = state.allNames.indexOf(name);
  if (idx !== -1) state.allNames.splice(idx, 1);
  state.calledNames = [name, ...state.calledNames.filter((n) => n !== name)];
  state.lit = { name, t0: performance.now() };
  state.highlight = '';
  state.rolling = false;
  ensureGroupCoverage();
  saveState();
  syncTextarea();
  renderAll({ keepResult: true });
  renderRollButtons();
  computeStarLayout();
}

function renderRollButtons() {
  el.toggleRollBtn.textContent = state.rolling ? '停止' : '开始滚动';
}

/* --------------------------------------------------------------------------
   视图渲染
   -------------------------------------------------------------------------- */
function updateCounts() {
  el.totalCount.textContent = '总数: ' + allStudents().length;
  el.remainingCount.textContent = '剩余: ' + state.allNames.length;
  el.calledCount.textContent = '已点 ' + state.calledNames.length + ' 人';
  updateListSummary();
}

/** 收起后的单行摘要：一眼看清是哪份名单、多少人、点了多少 */
function updateListSummary() {
  const total = allStudents().length;
  const parts = [];
  if (state.groups.length > 1) parts.push(`${state.groups.length} 个星区`);
  else if (state.listName) parts.push(state.listName);
  else if (total) parts.push('全班一片星空');
  if (total) parts.push(`${total} 人`);
  if (state.calledNames.length) parts.push(`已点 ${state.calledNames.length} 人`);
  if (state.allNames.length) parts.push(`剩余 ${state.allNames.length} 人`);
  el.listSummary.innerHTML = parts.length
    ? parts.map((p) => `<span class="chip chip-muted">${esc(p)}</span>`).join('')
    : '<span class="chip chip-muted">还没有名单，点右侧箭头展开后导入</span>';
}

/** 名单区收起/展开；收起后星图独占纵向空间 */
function setListCollapsed(collapsed) {
  el.listBody.hidden = collapsed;
  el.listSummary.hidden = !collapsed;
  el.toggleListCard.setAttribute('aria-expanded', String(!collapsed));
  el.toggleListCard.title = collapsed ? '展开名单区' : '收起名单区，给星图腾空间';
}

function updateNamesTitle() {
  const text = state.listName || '名单输入';
  el.namesInputTitleText.textContent = text.length > 18 ? text.slice(0, 18) + '…' : text;
  el.namesInputTitle.title = text;
  el.namesHint.textContent = state.groups.length > 1 ? `${state.groups.length} 个星区 · 可粘贴 / 编辑 / 拖入文件` : '可粘贴 / 编辑 / 拖入文件';
}

function updateUIState() {
  const hasNames = state.allNames.length > 0;
  const hasAny = hasNames || state.calledNames.length > 0;
  const hasCalled = state.calledNames.length > 0;
  el.toggleRollBtn.disabled = !hasNames;
  el.toggleRollBtn.classList.toggle('ghost', !hasNames);
  el.shuffle.disabled = !hasNames;
  el.clearAll.disabled = !hasAny;
  el.copyCalled.disabled = !hasCalled;
  el.exportCalled.disabled = !hasCalled;
  el.quickSync.disabled = !hasCalled;
  el.clearCalled.disabled = !hasCalled;
  updateMarkBtnState();
}

function renderCalledList() {
  const frag = document.createDocumentFragment();
  if (!state.calledNames.length) {
    const empty = document.createElement('div');
    empty.className = 'called-empty';
    empty.textContent = '还没有已点名单';
    frag.appendChild(empty);
  } else {
    const showGroup = state.groups.length > 1;
    state.calledNames.forEach((name, idx) => {
      const row = document.createElement('div');
      row.className = 'called-item';
      row.dataset.idx = String(idx);
      const left = document.createElement('div');
      left.className = 'called-person';
      const order = document.createElement('span');
      order.className = 'called-order';
      order.textContent = String(idx + 1);
      const nameText = document.createElement('span');
      nameText.className = 'called-name';
      nameText.textContent = name;
      left.appendChild(order);
      left.appendChild(nameText);
      if (showGroup && state.groupOf[name]) {
        const tag = document.createElement('span');
        tag.className = 'chip chip-muted';
        tag.textContent = state.groupOf[name];
        left.appendChild(tag);
      }
      const right = document.createElement('div');
      right.className = 'called-item-actions';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '移除';
      rm.className = 'small ghost';
      rm.dataset.action = 'remove';
      right.appendChild(rm);
      row.appendChild(left);
      row.appendChild(right);
      frag.appendChild(row);
    });
  }
  el.calledList.innerHTML = '';
  el.calledList.appendChild(frag);
}

function showIdle() {
  el.starName.textContent = state.allNames.length
    ? '等待点名'
    : (state.calledNames.length ? '全部已点亮' : '请先导入名单');
  el.starName.classList.remove('is-rolling');
  el.starName.classList.add('is-idle');
  el.starGroupName.textContent = '';
}

function showResult(name) {
  el.starName.textContent = name;
  el.starName.classList.remove('is-rolling', 'is-idle');
  el.starGroupName.textContent = state.groups.length > 1 ? (state.groupOf[name] || '') : '';
}

function showRolling(name) {
  el.starName.classList.remove('is-idle');
  el.starName.classList.add('is-rolling');
  el.starName.textContent = name;
  el.starGroupName.textContent = state.groups.length > 1 ? (state.groupOf[name] || '') : '';
}

function renderStarLegend() {
  const groups = starGroups();
  el.starLegend.innerHTML = '';
  const addChip = (text) => {
    const chip = document.createElement('span');
    chip.className = 'star-legend-chip';
    chip.textContent = text;
    el.starLegend.appendChild(chip);
  };
  if (groups.length <= 1) {
    const total = groups.length ? groups[0][1].length : 0;
    addChip(`全班 · ${state.calledNames.length}/${total} 颗已点亮`);
  } else {
    groups.forEach(([g, members]) => {
      addChip(`${g} · ${members.filter((n) => state.calledNames.includes(n)).length}/${members.length}`);
    });
  }
}

function renderStarProgress() {
  el.starProgress.textContent = state.allNames.length
    ? `剩余 ${state.allNames.length} 人待点亮`
    : (state.calledNames.length ? '全部已点亮' : '请先导入名单');
}

function renderAll(opts = {}) {
  updateCounts();
  updateNamesTitle();
  renderCalledList();
  updateUIState();
  renderStarLegend();
  renderStarProgress();
  if (state.rolling) return;
  if (opts.keepResult && state.calledNames.length) showResult(state.calledNames[0]);
  else showIdle();
}

function syncTextarea() {
  el.namesInput.value = state.allNames.join('\n');
}

/* 手动标记按钮：光标所在行或选中文本 */
function updateMarkBtnState() {
  const ta = el.namesInput;
  const start = ta.selectionStart, end = ta.selectionEnd;
  let hasSelection = false;
  if (start !== end) hasSelection = ta.value.substring(start, end).trim().length > 0;
  else {
    const lines = ta.value.split('\n');
    let cursor = 0;
    for (const line of lines) {
      const lineEnd = cursor + line.length + 1;
      if (start >= cursor && start < lineEnd) { hasSelection = line.trim().length > 0; break; }
      cursor = lineEnd;
    }
  }
  el.markBtn.disabled = !hasSelection;
  el.markBtn.classList.toggle('ghost', !hasSelection);
}

function manualMark() {
  if (el.markBtn.disabled || state.rolling) return;
  const ta = el.namesInput;
  const start = ta.selectionStart, end = ta.selectionEnd;
  let selected;
  if (start !== end) selected = ta.value.substring(start, end);
  else {
    const lines = ta.value.split('\n');
    let cursor = 0;
    for (const line of lines) {
      const lineEnd = cursor + line.length + 1;
      if (start >= cursor && start < lineEnd) { selected = line; break; }
      cursor = lineEnd;
    }
  }
  const names = unique(String(selected || '').split(/[\n,;，；]+/).map(cleanName).filter(Boolean));
  const valid = names.filter((n) => state.allNames.includes(n));
  if (!valid.length) { toast('未检测到可标记的姓名'); return; }
  valid.forEach((n) => {
    state.allNames = state.allNames.filter((x) => x !== n);
    state.calledNames = [n, ...state.calledNames.filter((x) => x !== n)];
  });
  state.lit = { name: valid[valid.length - 1], t0: performance.now() };
  ensureGroupCoverage();
  saveState();
  syncTextarea();
  renderAll({ keepResult: true });
  toast(`已标记 ${valid.length} 人`);
  computeStarLayout();
}

/* --------------------------------------------------------------------------
   星空视图（Canvas 2D）
   -------------------------------------------------------------------------- */
const star = {
  ctx: null, width: 0, height: 0, dpr: 1, scale: 1,
  tokens: {}, layout: [], layoutMap: new Map(), areas: [], dust: [], raf: null
};

function readStarTokens() {
  const cs = getComputedStyle(document.documentElement);
  ['star-bg-top', 'star-bg-bottom', 'star-dim', 'star-lit', 'star-glow',
    'star-line', 'star-highlight', 'star-dust', 'star-text-soft'].forEach((k) => {
      star.tokens[k] = cs.getPropertyValue('--' + k).trim();
    });
}

/** 按 groupOf 聚合现有学生；没有任何班级信息时自然只得到一组 */
function starGroups() {
  const map = new Map();
  state.groups.forEach((g) => map.set(g, []));
  allStudents().forEach((n) => {
    const g = state.groupOf[n] || state.groups[0] || DEFAULT_GROUP;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(n);
  });
  return [...map.entries()].filter(([, members]) => members.length > 0);
}

function resizeStarCanvas() {
  const rect = el.starCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  star.dpr = Math.min(window.devicePixelRatio || 1, 2);
  star.width = rect.width;
  star.height = rect.height;
  el.starCanvas.width = Math.round(rect.width * star.dpr);
  el.starCanvas.height = Math.round(rect.height * star.dpr);
  star.ctx.setTransform(star.dpr, 0, 0, star.dpr, 0, 0);
  computeStarLayout();
}

function computeStarLayout() {
  const W = star.width, H = star.height;
  if (!W || !H) return;
  // 画布越大星点跟着放大，保证投影距离下仍看得清
  star.scale = Math.max(1, Math.min(1.8, Math.min(W, H) / 420));
  const pad = Math.round(34 * Math.min(star.scale, 1.3)); // 顶部留出星区标签的空间，避免与 legend 叠在一起
  const groups = starGroups();
  const areas = [];

  if (groups.length <= 1) {
    areas.push({
      x: pad, y: pad, w: W - pad * 2, h: H - pad * 2,
      name: groups.length ? groups[0][0] : DEFAULT_GROUP,
      members: groups.length ? groups[0][1] : []
    });
  } else {
    const cols = groups.length <= 4 ? 2 : 3;
    const rows = Math.ceil(groups.length / cols);
    const gap = 20;
    const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const ch = (H - pad * 2 - gap * (rows - 1)) / rows;
    groups.forEach(([g, members], i) => {
      const c = i % cols, r = Math.floor(i / cols);
      areas.push({ x: pad + c * (cw + gap), y: pad + r * (ch + gap), w: cw, h: ch, name: g, members });
    });
  }

  star.areas = areas;
  star.layout = [];
  star.layoutMap = new Map();
  areas.forEach((area) => {
    const n = area.members.length;
    if (!n) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * (area.w / Math.max(area.h, 1)))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = area.w / cols, cellH = area.h / rows;
    // 按姓名哈希固定落位：谁被点到都不会让别人的星跳位置，星座也就能均匀长满整片星空
    const ordered = [...area.members].sort((a, b) => hashString(a + '|' + area.name) - hashString(b + '|' + area.name));
    ordered.forEach((name, i) => {
      const rnd = mulberry32(hashString(name + '|' + area.name));
      const c = i % cols, r = Math.floor(i / cols);
      const point = {
        name, group: area.name,
        x: area.x + (c + 0.22 + rnd() * 0.56) * cellW,
        y: area.y + (r + 0.22 + rnd() * 0.56) * cellH,
        phase: rnd() * Math.PI * 2
      };
      star.layout.push(point);
      star.layoutMap.set(name, point);
    });
  });

  const rnd = mulberry32(20261110);
  star.dust = [];
  // 微星密度随画布面积走，星图变大后背景不至于显得空
  const dustCount = Math.min(260, Math.round(W * H / 3200));
  for (let i = 0; i < dustCount; i++) {
    star.dust.push({ x: rnd() * W, y: rnd() * H, r: 0.4 + rnd() * 0.9, phase: rnd() * 6.28, speed: 0.3 + rnd() * 0.7 });
  }
}

function drawStarFrame(now) {
  const ctx = star.ctx, T = star.tokens;
  if (!ctx || !star.width) return;
  const W = star.width, H = star.height, t = now / 1000;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, T['star-bg-top']);
  bg.addColorStop(1, T['star-bg-bottom']);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 多分组时给每片星区一圈极淡的光晕，帮助区分
  if (star.areas.length > 1) {
    star.areas.forEach((a) => {
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      const radius = Math.max(a.w, a.h) * 0.62;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glow.addColorStop(0, T['star-line'] + '18');
      glow.addColorStop(1, T['star-line'] + '00');
      ctx.fillStyle = glow;
      ctx.fillRect(a.x, a.y, a.w, a.h);
      ctx.strokeStyle = T['star-line'];
      ctx.globalAlpha = 0.16;
      ctx.setLineDash([3, 6]);
      ctx.strokeRect(a.x + 2, a.y + 2, a.w - 4, a.h - 4);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
  }

  // 背景微星
  ctx.fillStyle = T['star-dust'];
  star.dust.forEach((d) => {
    ctx.globalAlpha = REDUCE_MOTION ? 0.3 : 0.16 + 0.24 * (0.5 + 0.5 * Math.sin(t * d.speed + d.phase));
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * Math.min(star.scale || 1, 1.4), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  const calledSet = new Set(state.calledNames);
  const calledOldestFirst = [...state.calledNames].reverse();

  // 星座连线：同组内按点名先后连起来
  ctx.strokeStyle = T['star-line'];
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.34;
  star.areas.forEach((area) => {
    const pts = calledOldestFirst
      .filter((n) => (state.groupOf[n] || state.groups[0] || DEFAULT_GROUP) === area.name)
      .map((n) => star.layoutMap.get(n)).filter(Boolean);
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // 星点
  const s = star.scale || 1;
  star.layout.forEach((p) => {
    const called = calledSet.has(p.name);
    const highlight = state.highlight === p.name;
    const twinkle = REDUCE_MOTION ? 0.7 : 0.58 + 0.42 * (0.5 + 0.5 * Math.sin(t * 1.5 + p.phase));
    const radius = (highlight ? 5.2 : called ? 2.9 : 2.2) * s;

    if (called || highlight) {
      const glowR = (highlight ? 26 : 12) * s;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      glow.addColorStop(0, (highlight ? T['star-highlight'] : T['star-glow']) + 'aa');
      glow.addColorStop(1, (highlight ? T['star-highlight'] : T['star-glow']) + '00');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    // 每颗星一层极淡柔光，保证投影上暗星也看得见
    ctx.fillStyle = called ? T['star-glow'] : T['star-dim'];
    ctx.globalAlpha = called ? 0.14 : 0.1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (called ? 8 : 5) * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = highlight ? T['star-highlight'] : called ? T['star-lit'] : T['star-dim'];
    ctx.globalAlpha = highlight ? 1 : called ? 0.95 : 0.55 + 0.35 * twinkle;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // 已点学生姓名直接标在各自星点旁：星空模式不再占用右侧栏，名单长在星图上
  const labelScale = Math.min(s, 1.45);
  ctx.font = `600 ${Math.round(14 * labelScale)}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = T['star-glow'];
  ctx.shadowBlur = 9 * labelScale;
  let labelCount = 0;
  star.layout.forEach((p) => {
    if (!calledSet.has(p.name)) return;
    labelCount++;
    const gap = 7 * s;
    const w = ctx.measureText(p.name).width;
    const toRight = p.x + gap + w <= W - 8; // 贴右边界的星把名字写到左侧，避免被裁掉
    ctx.textAlign = toRight ? 'left' : 'right';
    ctx.fillStyle = state.highlight === p.name ? T['star-highlight'] : T['star-lit'];
    ctx.globalAlpha = state.highlight === p.name ? 1 : 0.9;
    ctx.fillText(p.name, toRight ? p.x + gap : p.x - gap, p.y + 0.5);
  });
  star.labelCount = labelCount;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // 点亮涟漪
  if (state.lit && !REDUCE_MOTION) {
    const age = (now - state.lit.t0) / 1000;
    const p = star.layoutMap.get(state.lit.name);
    if (p && age < 1.6) {
      ctx.strokeStyle = T['star-glow'];
      ctx.lineWidth = 1.6 * (star.scale || 1);
      for (let k = 0; k < 2; k++) {
        const a = age - k * 0.28;
        if (a <= 0) continue;
        ctx.globalAlpha = Math.max(0, 0.6 * (1 - a / 1.6));
        ctx.beginPath();
        ctx.arc(p.x, p.y, (6 + a * 36) * (star.scale || 1), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

function starLoop(now) {
  drawStarFrame(now);
  star.raf = requestAnimationFrame(starLoop);
}

function startStarLoop() {
  if (!star.raf) star.raf = requestAnimationFrame(starLoop);
}

/* --------------------------------------------------------------------------
   GitHub：导入名单 / 同步已点名单
   -------------------------------------------------------------------------- */
el.fetchCSV.addEventListener('click', async () => {
  const repo = el.githubRepo.value.trim();
  if (!repo) { toast('请输入仓库地址'); return; }
  el.csvFiles.innerHTML = '<span class="empty-hint">正在读取仓库…</span>';
  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}/contents`);
    if (!resp.ok) throw new Error(String(resp.status));
    const data = await resp.json();
    const files = (Array.isArray(data) ? data : []).filter((f) => /\.csv$/i.test(f.name));
    el.csvFiles.innerHTML = '';
    if (!files.length) {
      el.csvFiles.innerHTML = '<span class="empty-hint">仓库根目录没有找到 CSV 文件</span>';
      return;
    }
    files.forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'file-chip ghost';
      btn.textContent = f.name;
      btn.addEventListener('click', async () => {
        try {
          const r = await fetch(f.download_url);
          const text = await r.text();
          const fallback = f.name.replace(/\.csv$/i, '');
          openImportPreview([{ file: f.name, ...parseRoster(text, fallback) }]);
          closeModal('githubModal');
        } catch (e) { toast('读取 CSV 失败'); }
      });
      el.csvFiles.appendChild(btn);
    });
  } catch (e) {
    el.csvFiles.innerHTML = '<span class="empty-hint">读取仓库失败，请检查仓库名或网络</span>';
  }
});

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function createPullRequestFlow({ token, repo, branch, filePath, contentBase64, prTitle }) {
  const headers = { Accept: 'application/vnd.github.v3+json', Authorization: `token ${token}` };
  const repoResp = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoResp.ok) throw new Error(`无法获取仓库信息：${repoResp.status}`);
  const defaultBranch = (await repoResp.json()).default_branch;

  const refResp = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${defaultBranch}`, { headers });
  if (!refResp.ok) throw new Error(`无法获取默认分支：${refResp.status}`);
  const baseSha = (await refResp.json()).object.sha;

  const check = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, { headers });
  if (check.status === 404) {
    const created = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha })
    });
    if (!created.ok) throw new Error(`创建分支失败：${created.status} ${await created.text()}`);
  } else if (!check.ok) throw new Error(`检查分支失败：${check.status}`);

  const path = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const put = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prTitle || 'Add called names', content: contentBase64, branch })
  });
  if (!put.ok) throw new Error(`提交文件失败：${put.status} ${await put.text()}`);

  const pr = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: prTitle || 'Add called names', head: branch, base: defaultBranch,
      body: 'Called names created by rollcall tool.'
    })
  });
  if (!pr.ok) throw new Error(`创建 PR 失败：${pr.status} ${await pr.text()}`);
  return (await pr.json()).html_url;
}

function openSyncModal() {
  const stamp = timeParts();
  const slug = sanitizeForPath(state.listName || '手动名单');
  try {
    el.syncRepo.value = localStorage.getItem(KEY_SYNC_REPO) || '';
    el.syncToken.value = sessionStorage.getItem(SESSION_TOKEN) || '';
  } catch (e) { /* ignore */ }
  el.syncPath.value = `rollcall/${slug}_called_names_${stamp.full}.txt`;
  el.syncTitleInput.value = `Add called names - ${state.listName || '手动名单'} (${stamp.date})`;
  el.syncBranch.value = `rollcall/called-${stamp.compact}`;
  el.syncStatus.textContent = '';
  el.advancedFields.hidden = true;
  el.toggleAdvanced.setAttribute('aria-expanded', 'false');
  openModal('syncModal');
}

el.submitSync.addEventListener('click', async () => {
  const repo = el.syncRepo.value.trim();
  const token = el.syncToken.value.trim();
  if (!repo || !token) { el.syncStatus.textContent = '请填写仓库与 PAT。'; return; }
  if (!state.calledNames.length) { el.syncStatus.textContent = '已点名单为空，没有可同步的内容。'; return; }
  try {
    localStorage.setItem(KEY_SYNC_REPO, repo);
    sessionStorage.setItem(SESSION_TOKEN, token);
  } catch (e) { /* ignore */ }

  const stamp = timeParts();
  const branch = el.syncBranch.value.trim() || `rollcall/called-${stamp.compact}_${stamp.full.slice(-4)}`;
  el.syncStatus.textContent = '正在创建分支与提交，请稍候…';
  el.submitSync.disabled = true;
  try {
    const url = await createPullRequestFlow({
      token, repo, branch,
      filePath: el.syncPath.value.trim(),
      contentBase64: utf8ToB64(state.calledNames.join('\n')),
      prTitle: el.syncTitleInput.value.trim()
    });
    el.syncStatus.textContent = '';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'PR 已创建，点此查看';
    el.syncStatus.appendChild(link);
    toast('已同步到 GitHub');
  } catch (err) {
    el.syncStatus.textContent = `操作失败：${err.message}`;
  } finally {
    el.submitSync.disabled = false;
  }
});

/* --------------------------------------------------------------------------
   事件绑定
   -------------------------------------------------------------------------- */
/* 已点名单抽屉：头部按钮开合、关闭按钮、点遮罩关闭 */
el.calledPanelBtn.addEventListener('click', () => {
  if (el.calledDrawer.classList.contains('is-open')) closeCalledPanel();
  else openCalledPanel();
});
el.closeCalledDrawer.addEventListener('click', closeCalledPanel);
el.calledDrawer.addEventListener('click', (e) => {
  if (e.target === el.calledDrawer) closeCalledPanel();
});

// 名单区收起/展开：收起后星图立刻吃掉腾出来的空间
el.toggleListCard.addEventListener('click', () => {
  setListCollapsed(el.toggleListCard.getAttribute('aria-expanded') === 'true');
  requestAnimationFrame(resizeStarCanvas);
});

el.dropZone.addEventListener('click', () => el.fileInput.click());
el.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
});
el.fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files, 'roster');
  e.target.value = '';
});
bindDrop(el.dropZone, 'roster', [el.dropZone]);

el.importCalled.addEventListener('click', () => el.calledFileInput.click());
el.calledFileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files, 'called');
  e.target.value = '';
});
bindDrop(el.calledList, 'called', [el.calledList]);
bindDrop(el.calledDropHint, 'called', [el.calledList]);

// 星空模式下列表收起、拖拽区一起隐藏：整页拖拽兜底，文件拖到页面任意位置都能导入名单
['dragover', 'drop'].forEach((ev) => {
  document.addEventListener(ev, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    if (ev !== 'drop') return;
    const t = e.target;
    if (t && t.closest && t.closest('#dropZone, #calledList, #calledDropHint')) return; // 交给各自的落点处理
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'roster');
  });
});

el.toggleRollBtn.addEventListener('click', () => state.rolling ? stopRoll() : startRoll());
el.markBtn.addEventListener('click', manualMark);

['select', 'click', 'keyup'].forEach((ev) => el.namesInput.addEventListener(ev, updateMarkBtnState));
el.namesInput.addEventListener('blur', () => {
  const raw = el.namesInput.value;
  const cleaned = raw.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (cleaned !== raw) {
    el.namesInput.value = cleaned;
    el.namesInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
el.namesInput.addEventListener('input', () => {
  clearTimeout(inputDebounce);
  inputDebounce = setTimeout(() => {
    if (state.rolling) return;
    const parsed = parseTextarea();
    const calledSet = new Set(state.calledNames);
    state.allNames = parsed.filter((n) => !calledSet.has(n));
    if (!parsed.length) { state.listName = ''; }
    else if (!state.listName || /^手动名单/.test(state.listName)) state.listName = `手动名单-${parsed.length}人`;
    ensureGroupCoverage();
    saveState();
    renderAll({ keepResult: false });
    computeStarLayout();
  }, 180);
});

el.calledList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="remove"]');
  if (!btn) return;
  const idx = parseInt(btn.closest('.called-item').dataset.idx, 10);
  const name = state.calledNames[idx];
  if (!name) return;
  state.calledNames.splice(idx, 1);
  state.allNames.push(name);
  ensureGroupCoverage();
  saveState();
  syncTextarea();
  renderAll({ keepResult: false });
  computeStarLayout();
});

el.shuffle.addEventListener('click', () => {
  for (let i = state.allNames.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.allNames[i], state.allNames[j]] = [state.allNames[j], state.allNames[i]];
  }
  saveState();
  syncTextarea();
  toast('名单已打乱');
});

el.clearAll.addEventListener('click', () => {
  if (!confirm('确认清空全部名单吗？待点名单和已点记录都会被清空，此操作不可恢复。')) return;
  state.allNames = []; state.calledNames = []; state.groupOf = {}; state.groups = []; state.listName = '';
  state.lit = null; state.highlight = '';
  ensureGroupCoverage();
  saveState();
  syncTextarea();
  renderAll({ keepResult: false });
  computeStarLayout();
  toast('名单已清空');
});

el.clearCalled.addEventListener('click', () => {
  if (!confirm('确认清除已点名单？所有人会回到待点名单，此操作不可恢复。')) return;
  state.allNames = unique([...state.allNames, ...state.calledNames]);
  state.calledNames = [];
  state.lit = null;
  ensureGroupCoverage();
  saveState();
  syncTextarea();
  renderAll({ keepResult: false });
  computeStarLayout();
  toast('已点名单已清除');
});

el.copyCalled.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.calledNames.join('\n'));
    toast('已复制到剪贴板');
  } catch (e) {
    toast('复制失败，请用「导出」保存文件');
  }
});

el.exportCalled.addEventListener('click', () => {
  const blob = new Blob([state.calledNames.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `已点名单_${timeParts().date}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('已导出，可在另一台设备用「传回」续点');
});

el.starCanvas.addEventListener('click', (e) => {
  if (state.rolling) return;
  const rect = el.starCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  let best = null, bestD = 15;
  star.layout.forEach((p) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  });
  if (!best) return;
  if (state.allNames.includes(best.name)) { markName(best.name); toast(`已标记 ${best.name}`); }
  else if (state.calledNames.includes(best.name)) toast(`${best.name} 已经点过了`);
});

// 模态开合
el.importFromGitHub.addEventListener('click', () => openModal('githubModal'));
el.quickSync.addEventListener('click', openSyncModal);
el.closeModal.addEventListener('click', () => closeModal('githubModal'));
el.closeImportModal.addEventListener('click', () => closeModal('importModal'));
el.cancelImport.addEventListener('click', () => closeModal('importModal'));
el.confirmImport.addEventListener('click', confirmImport);
el.closeCalledImportModal.addEventListener('click', () => closeModal('calledImportModal'));
el.cancelCalledImport.addEventListener('click', () => closeModal('calledImportModal'));
el.confirmCalledImport.addEventListener('click', confirmCalledImport);
el.closeSyncModal.addEventListener('click', () => closeModal('syncModal'));
el.cancelSync.addEventListener('click', () => closeModal('syncModal'));
el.toggleAdvanced.addEventListener('click', () => {
  const open = el.advancedFields.hidden;
  el.advancedFields.hidden = !open;
  el.toggleAdvanced.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('is-open'); });
});
document.querySelectorAll('input[name="importMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    el.resetCalledRow.hidden = document.querySelector('input[name="importMode"]:checked').value !== 'replace';
    renderImportStats();
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (el.calledDrawer.classList.contains('is-open')) { closeCalledPanel(); return; }
  document.querySelectorAll('.modal.is-open').forEach((m) => m.classList.remove('is-open'));
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeStarCanvas, 120);
});

// 星图跟着容器走：收起名单、窗口缩放都能自动重排
if (window.ResizeObserver) {
  let roRaf = null;
  new ResizeObserver(() => {
    cancelAnimationFrame(roRaf);
    roRaf = requestAnimationFrame(() => resizeStarCanvas());
  }).observe(el.starView);
}
window.addEventListener('beforeunload', () => {
  if (!state.rolling) {
    const parsed = parseTextarea();
    if (parsed.length) state.allNames = parsed.filter((n) => !state.calledNames.includes(n));
    saveState();
  }
});

/* --------------------------------------------------------------------------
   初始化
   -------------------------------------------------------------------------- */
function init() {
  initTheme();
  readStarTokens();
  loadState();
  syncTextarea();
  updateNamesTitle();
  star.ctx = el.starCanvas.getContext('2d');
  // 已有名单时把名单区收成一行，星图独占纵向空间；空名单保持展开方便导入
  setListCollapsed(allStudents().length > 0);
  resizeStarCanvas();
  startStarLoop();
  renderRollButtons();
  renderAll({ keepResult: state.calledNames.length > 0 });
}

init();
