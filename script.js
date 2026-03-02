// 主题切换：支持 白天 / 夜间，保存在 localStorage
const THEME_KEY = 'rollcall_theme_v1';
const themeToggle = document.getElementById('themeToggle');
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.classList.add('light-theme');
  else document.documentElement.classList.remove('light-theme');
  if (themeToggle) themeToggle.textContent = (theme === 'light') ? '☀️' : '🌙';
}
function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) { applyTheme(saved); return; }
    // 若无保存，使用系统偏好
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  } catch (e) { console.warn('theme init error', e); }
}
function toggleTheme() {
  try {
    const isLight = document.documentElement.classList.contains('light-theme');
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  } catch (e) { console.warn(e); }
}
if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

// 初始化主题（在页面其它逻辑前）
initTheme();

// 简单的单页点名器逻辑（无依赖，适合 GitHub Pages）
// ——（原有变量与逻辑保留）——
function updateNamesInputTitle(filename) {
  const nameWithoutExt = filename.replace(/\.csv$/, '');
  const truncated = nameWithoutExt.length > 15 ? nameWithoutExt.substring(0, 15) + '...' : nameWithoutExt;
  namesInputTitle.textContent = truncated;
  namesInputTitle.title = nameWithoutExt;
}

function resetNamesInputTitle() {
  const defaultText = '名单输入（每行一个姓名）';
  namesInputTitle.textContent = defaultText;
  namesInputTitle.title = defaultText;
}
const namesInput = document.getElementById('namesInput');
const shuffleBtn = document.getElementById('shuffle');
const clearAllBtn = document.getElementById('clearAll');
const totalCount = document.getElementById('totalCount');
const remainingCount = document.getElementById('remainingCount');
const nameDisplay = document.getElementById('nameDisplay');
const toggleRollBtn = document.getElementById('toggleRollBtn');
const markBtn = document.getElementById('markBtn');
const calledListEl = document.getElementById('calledList');
const copyCalled = document.getElementById('copyCalled');
const exportCalled = document.getElementById('exportCalled');
const clearCalled = document.getElementById('clearCalled');
const namesInputTitle = document.getElementById('namesInputTitle');

// 新增：Create PR 按钮与模态元素
const createPRBtn = document.getElementById('createPR');
const githubPRModal = document.getElementById('githubPRModal');
const closePRModal = document.getElementById('closePRModal');
const prRepoInput = document.getElementById('prRepo');
const prFilePathInput = document.getElementById('prFilePath');
const prTitleInput = document.getElementById('prTitle');
const prBranchInput = document.getElementById('prBranch');
const prTokenInput = document.getElementById('prToken');
const submitPRBtn = document.getElementById('submitPR');
const cancelPRBtn = document.getElementById('cancelPR');
const prStatus = document.getElementById('prStatus');

createPRBtn.onclick = () => {
  // 预填一些默认值
  const now = new Date();
  const ts = now.toISOString().slice(0,19).replace(/[:-]/g,'').replace('T','_');
  const listName = getListNameForPR();
  const listSlug = sanitizeListNameForPath(listName);
  prFilePathInput.value = prFilePathInput.value || `rollcall/${listSlug}_called_names_${ts}.txt`;
  prTitleInput.value = prTitleInput.value || `Add called names - ${listName} (${now.toISOString().slice(0,10)})`;
  prBranchInput.value = prBranchInput.value || `rollcall/called-names-${now.toISOString().slice(0,10).replace(/-/g,'')}`;
  prTokenInput.value = ''; // 不回显 token（安全）
  prStatus.textContent = '';
  githubPRModal.style.display = 'flex';
};

closePRModal.onclick = () => { githubPRModal.style.display = 'none'; };
cancelPRBtn.onclick = () => { githubPRModal.style.display = 'none'; };
githubPRModal.onclick = (e) => { if (e.target === githubPRModal) githubPRModal.style.display = 'none'; };

// Storage keys
const STORAGE_ALL = 'rollcall_all_names_v1';
const STORAGE_CALLED = 'rollcall_called_names_v1';
const STORAGE_LIST_NAME = 'rollcall_current_list_name_v1';

let allNames = []; // 未点或待点名单
let calledNames = []; // 已点名单
let currentListName = '';
let rolling = false;
let intervalId = null;
let lastShown = '';

function normalizeListName(name) {
  if (!name) return '';
  return String(name).replace(/\.csv$/i, '').trim();
}

function sanitizeListNameForPath(name) {
  const normalized = normalizeListName(name).normalize('NFKC');
  const slug = normalized
    .replace(/[^\p{L}\p{N}\-_]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'manual-list';
}

function setCurrentListName(name) {
  const normalized = normalizeListName(name);
  currentListName = normalized;
  if (normalized) localStorage.setItem(STORAGE_LIST_NAME, normalized);
  else localStorage.removeItem(STORAGE_LIST_NAME);
}

function getManualListName(count) {
  const safeCount = Number.isFinite(count) ? count : 0;
  return safeCount > 0 ? `手动名单-${safeCount}人` : '手动名单';
}

function isManualListName(name) {
  return /^手动名单(?:-\d+人)?$/.test((name || '').trim());
}

function getListNameForPR() {
  if (currentListName) return currentListName;
  if (calledNames.length > 0) return getManualListName(calledNames.length);
  const parsed = parseInput();
  if (parsed.length > 0) return getManualListName(parsed.length);
  return '手动名单';
}

// 初始化：从 localStorage 读取
function loadFromStorage() {
  try {
    const rawAll = localStorage.getItem(STORAGE_ALL);
    const rawCalled = localStorage.getItem(STORAGE_CALLED);
    const rawListName = localStorage.getItem(STORAGE_LIST_NAME);
    allNames = rawAll ? JSON.parse(rawAll) : [];
    calledNames = rawCalled ? JSON.parse(rawCalled) : [];
    currentListName = rawListName ? normalizeListName(rawListName) : '';
    if (currentListName) {
      updateNamesInputTitle(currentListName);
    } else {
      resetNamesInputTitle();
    }
    renderCalledList();
    updateCounts();
    namesInput.value = allNames.join('\n');
    updateUIState(); // 添加UI状态更新
  } catch (e) {
    console.error('storage load error', e);
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_ALL, JSON.stringify(allNames));
  localStorage.setItem(STORAGE_CALLED, JSON.stringify(calledNames));
}

function parseInput() {
  const raw = namesInput.value.trim();
  if (!raw) return [];
  // 支持换行、逗号、分号分隔
  const items = raw.split(/[\n,;，；]+/).map(s => s.trim()).filter(Boolean);
  return Array.from(new Set(items)); // 去重
}

function updateCounts() {
  totalCount.textContent = '总数: ' + (allNames.length + calledNames.length);
  remainingCount.textContent = '剩余: ' + (allNames.length);
}

// 更新UI状态函数
function updateUIState(updateDisplay = true) {
  const hasNames = allNames.length > 0;

  if (updateDisplay) {
    if (allNames.length === 0) {
      if (calledNames.length === 0) {
        nameDisplay.textContent = '名单为空，请导入名单';
      } else {
        nameDisplay.textContent = '所有学生已点名完毕';
      }
    } else {
      nameDisplay.textContent = '点击"开始滚动"开始点名';
    }
  }

  // 更新按钮状态
  toggleRollBtn.disabled = !hasNames;
  toggleRollBtn.classList.toggle('ghost', !hasNames);

  // 更新"打乱顺序"和"清空名单"按钮状态
  const hasAnyNames = hasNames || calledNames.length > 0;
  shuffleBtn.disabled = !hasNames;
  clearAllBtn.disabled = !hasAnyNames;

  shuffleBtn.classList.toggle('ghost', !hasNames);
  clearAllBtn.classList.toggle('ghost', !hasAnyNames);

  if (!clearAllBtn.disabled) {
    clearAllBtn.style.background = '#dc2626';
    clearAllBtn.style.color = 'white';
  } else {
    clearAllBtn.style.background = '';
    clearAllBtn.style.color = '';
  }

  // 已点名单相关按钮状态
  const hasCalledNames = calledNames.length > 0;
  copyCalled.disabled = !hasCalledNames;
  exportCalled.disabled = !hasCalledNames;
  clearCalled.disabled = !hasCalledNames;
  createPRBtn.disabled = !hasCalledNames;
  copyCalled.classList.toggle('ghost', !hasCalledNames);
  exportCalled.classList.toggle('ghost', !hasCalledNames);
  clearCalled.classList.toggle('ghost', !hasCalledNames);
  createPRBtn.classList.toggle('ghost', !hasCalledNames);

  // 设置创建PR按钮激活状态颜色
  if (!createPRBtn.disabled) {
    createPRBtn.style.background = '#059669';
    createPRBtn.style.color = 'white';
  } else {
    createPRBtn.style.background = '';
    createPRBtn.style.color = '';
  }

  // 设置清除按钮激活状态颜色（危险颜色）
  if (!clearCalled.disabled) {
    clearCalled.style.background = '#dc2626';
    clearCalled.style.color = 'white';
  } else {
    clearCalled.style.background = '';
    clearCalled.style.color = '';
  }
}

function renderCalledList() {
  const fragment = document.createDocumentFragment();
  calledNames.forEach((name, idx) => {
    const div = document.createElement('div');
    div.className = 'called-item';
    div.dataset.idx = idx;
    const left = document.createElement('div');
    left.textContent = name;
    const right = document.createElement('div');
    right.style.display = 'flex'; right.style.gap = '8px';
    const rm = document.createElement('button'); rm.textContent = '移除'; rm.className = 'small ghost';
    rm.dataset.action = 'remove';
    right.appendChild(rm);
    div.appendChild(left);
    div.appendChild(right);
    fragment.appendChild(div);
  });
  calledListEl.innerHTML = '';
  calledListEl.appendChild(fragment);
}

// 事件委托：处理已点名单中的按钮点击
calledListEl.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action="remove"]');
  if (!button) return;
  const item = button.closest('.called-item');
  const idx = parseInt(item.dataset.idx);
  const name = calledNames[idx];
  calledNames.splice(idx, 1);
  allNames.push(name);
  saveToStorage();
  renderCalledList();
  updateCounts();
  namesInput.value = allNames.join('\n');
  updateUIState(false);
});

shuffleBtn.onclick = () => {
  for (let i = allNames.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allNames[i], allNames[j]] = [allNames[j], allNames[i]];
  }
  nameDisplay.textContent = '名单已打乱';
  namesInput.value = allNames.join('\n');
  saveToStorage();
}

clearAllBtn.onclick = () => {
  if (!confirm('确认清空全部名单吗？此操作将清空所有名单，包括待点名单和已点名单。')) return;
  allNames = [];
  calledNames = [];
  setCurrentListName('');
  resetNamesInputTitle();
  namesInput.value = '';
  updateCounts();
  saveToStorage();
  renderCalledList();
  nameDisplay.textContent = '已清空';
  updateUIState(); // 添加UI状态更新
}

toggleRollBtn.onclick = () => {
  if (!rolling) {
    // 若当前输入框未加载到存量，则尝试加载
    if (allNames.length === 0) {
      const parsed = parseInput();
      if (parsed.length === 0) { alert('名单为空，请先粘贴或加载名单。'); return; }
      allNames = parsed.filter(n => !calledNames.includes(n));
      saveToStorage();
    }
    rolling = true;
    toggleRollBtn.textContent = '停止';
    nameDisplay.classList.add('blur');

    // 简化：直接用固定间隔的 setInterval 更新展示，避免复杂节流造成的延迟残留覆盖问题
    intervalId = setInterval(() => {
      if (allNames.length === 0) { nameDisplay.textContent = '无候选'; return; }
      let pick = allNames[Math.floor(Math.random() * allNames.length)];
      if (typeof pick === 'string') pick = pick.trim();
      lastShown = pick;
      nameDisplay.textContent = pick;
    }, 60);
  } else {
    rolling = false;
    toggleRollBtn.textContent = '开始滚动';
    nameDisplay.classList.remove('blur');
    if (intervalId) clearInterval(intervalId);
    // 选中当前显示的名字
    // 规范化选中项，优先使用内部记录的 lastShown
    const rawChosen = lastShown || nameDisplay.textContent;
    const chosen = (typeof rawChosen === 'string') ? rawChosen.trim() : rawChosen;

    if (!chosen || chosen === '点击"开始滚动"开始' || chosen === '名单已加载' || chosen === '无候选') {
      nameDisplay.textContent = '未能选中有效姓名';
      return;
    }
    // 将选中者从 allNames 移到 calledNames
    // 使用 trim 比较，兼容 allNames 中潜在的空白字符
    const idx = allNames.findIndex(n => (typeof n === 'string' ? n.trim() : n) === chosen);

    if (idx !== -1) allNames.splice(idx, 1);
    const toAdd = (typeof chosen === 'string') ? chosen : String(chosen);
    if (!calledNames.includes(toAdd)) calledNames.unshift(toAdd);

    saveToStorage();
    renderCalledList();
    updateCounts();
    nameDisplay.textContent = chosen; // 显示选中的名字

    // 从文本框显示中移除选中的名字
    const currentText = namesInput.value;
    const lines = currentText.split('\n').filter(line => line.trim() !== chosen);
    namesInput.value = lines.join('\n');

    updateUIState(false); // 更新按钮状态但不覆盖显示内容
  }
}

// 动态更新"手动标记"按钮状态
function updateMarkBtnState() {
  const textarea = namesInput;
  const startPos = textarea.selectionStart;
  const endPos = textarea.selectionEnd;
  let hasSelection = false;

  if (startPos !== endPos) {
    hasSelection = true;
  } else {
    const text = textarea.value;
    const lines = text.split('\n');
    let lineStart = 0;
    let lineEnd = 0;

    for (const line of lines) {
      lineEnd = lineStart + line.length + 1;
      if (startPos >= lineStart && startPos < lineEnd) {
        hasSelection = line.trim().length > 0;
        break;
      }
      lineStart = lineEnd;
    }
  }

  markBtn.disabled = !hasSelection;
  markBtn.classList.toggle('ghost', !hasSelection);
}

function cleanupNamesInputEmptyLines() {
  const raw = namesInput.value;
  const cleaned = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

  if (cleaned !== raw) {
    namesInput.value = cleaned;
    namesInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// 监听输入框的选中和光标变化
namesInput.addEventListener('select', updateMarkBtnState);
namesInput.addEventListener('click', updateMarkBtnState);
namesInput.addEventListener('keyup', updateMarkBtnState);
namesInput.addEventListener('blur', cleanupNamesInputEmptyLines);

// 监听输入框内容变化，只在文本框完全清空且不是滚动点名过程中更新数据
namesInput.addEventListener('input', () => {
  const parsed = parseInput();
  if (parsed.length === 0 && !rolling) {
    // 手动清空文本框且不在滚动过程中时，清空待点名单
    allNames = [];
    setCurrentListName('');
    resetNamesInputTitle();
    saveToStorage();
    updateCounts();
    updateUIState();
  } else {
    // 有内容时自动录入到allNames
    allNames = parsed.filter(n => !calledNames.includes(n));
    if (!currentListName || isManualListName(currentListName)) {
      const manualName = getManualListName(parsed.length);
      setCurrentListName(manualName);
      updateNamesInputTitle(manualName);
    }
    saveToStorage();
    updateCounts();
    updateUIState();
  }
});
// 每次输入后自动刷新相关按钮UI状态
namesInput.addEventListener('input', updateMarkBtnState);

// 初始化按钮状态
updateMarkBtnState();

markBtn.onclick = () => {
  if (markBtn.disabled) return;

  // 获取当前输入框中光标所在行的文本
  const textarea = namesInput;
  const startPos = textarea.selectionStart;
  const endPos = textarea.selectionEnd;

  // 如果选中了文本，则使用选中文本；否则获取光标所在行的文本
  let selectedText = '';
  if (startPos !== endPos) {
    selectedText = textarea.value.substring(startPos, endPos).trim();
  } else {
    // 获取光标所在行的文本
    const text = textarea.value;
    const lines = text.split('\n');
    let lineStart = 0;
    let lineEnd = 0;
    let currentLine = '';

    for (const line of lines) {
      lineEnd = lineStart + line.length + 1; // +1 for the newline character
      if (startPos >= lineStart && startPos < lineEnd) {
        currentLine = line.trim();
        break;
      }
      lineStart = lineEnd;
    }
    selectedText = currentLine;
  }

  if (!selectedText) return alert('未检测到姓名可标记');

  // 支持多行
  const items = selectedText.split(/[\n,;，；]+/).map(s => s.trim()).filter(Boolean);
  items.forEach(it => {
    const idx = allNames.indexOf(it);
    if (idx !== -1) allNames.splice(idx, 1);
    if (!calledNames.includes(it)) calledNames.unshift(it);
  });
  saveToStorage(); renderCalledList(); updateCounts(); namesInput.value = allNames.join('\n');

  // 标记完成后禁用按钮，直到下一次选中
  markBtn.disabled = true;
  markBtn.classList.add('ghost');
}

copyCalled.onclick = async () => {
  try {
    await navigator.clipboard.writeText(calledNames.join('\n'));
    alert('已复制到剪贴板');
  } catch (e) { alert('复制失败，请手动选择并复制。'); }
}

exportCalled.onclick = () => {
  const blob = new Blob([calledNames.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'called_names.txt';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

clearCalled.onclick = () => {
  if (!confirm('确认清除已点名单？此操作不可恢复。')) return;
  allNames = allNames.concat(calledNames);
  calledNames = [];
  saveToStorage();
  renderCalledList();
  updateCounts();
  namesInput.value = allNames.join('\n');
  updateUIState(); // 添加UI状态更新
}

// 页面离开时自动保存当前 textarea
window.addEventListener('beforeunload', () => {
  const parsed = parseInput();
  if (parsed.length > 0) {
    allNames = parsed.filter(n => !calledNames.includes(n));
  }
  saveToStorage();
});

// GitHub 导入逻辑（保留）
const githubModal = document.getElementById('githubModal');
const closeModal = document.getElementById('closeModal');
const fetchCSV = document.getElementById('fetchCSV');
const githubRepo = document.getElementById('githubRepo');
const csvFiles = document.getElementById('csvFiles');
const importFromGitHub = document.getElementById('importFromGitHub');

importFromGitHub.onclick = () => {
  githubModal.style.display = 'flex';
};

githubModal.onclick = (e) => {
  if (e.target === githubModal) {
    githubModal.style.display = 'none';
  }
};

closeModal.onclick = () => {
  githubModal.style.display = 'none';
};

fetchCSV.onclick = async () => {
  const repo = githubRepo.value.trim();
  if (!repo) return alert('请输入 GitHub 仓库地址');

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents`);
    const data = await response.json();
    const csvFilesList = data.filter(file => file.name.endsWith('.csv'));

    if (csvFilesList.length === 0) {
      csvFiles.innerHTML = '未找到 CSV 文件';
      return;
    }

    csvFiles.innerHTML = '<h4>选择 CSV 文件：</h4>';
    csvFilesList.forEach(file => {
      const button = document.createElement('button');
      button.textContent = file.name;
      button.style.margin = '5px';
      button.onclick = async () => {
        try {
          const csvResponse = await fetch(file.download_url);
          const csvText = await csvResponse.text();
          const names = csvText.split('\n').map(line => line.trim()).filter(Boolean);
          // 先设置数据模型：清空已点名单并设置待点名单
          calledNames = [];
          allNames = names.slice();
          // 将文本框与数据同步（保证 textarea 与 allNames 完全一致）
          namesInput.value = allNames.join('\n');
          // 持久化并刷新 UI（先保存再渲染，避免 race）
          saveToStorage();
          renderCalledList(); // 更新已点名单显示（目前为空）
          updateCounts();
          setCurrentListName(file.name);
          updateNamesInputTitle(file.name);
          // 触发 input 事件以保证其他监听器（例如 mark 按钮状态）同步
          namesInput.dispatchEvent(new Event('input', { bubbles: true }));
          // 关闭 modal 并显示加载完成状态，不让 updateUIState 覆盖这个展示
          githubModal.style.display = 'none';
          updateUIState(false);
          nameDisplay.textContent = 'CSV 文件已加载';
        } catch (error) {
          console.error('Error loading CSV:', error);
          alert('加载 CSV 文件失败');
        }
      };
      csvFiles.appendChild(button);
    });
  } catch (error) {
    console.error('Error fetching GitHub repo:', error);
    alert('获取仓库内容失败');
  }
};

// ----------------- 新增：创建 PR 的主流程函数 -----------------
/**
 * 创建 Pull Request 的主要步骤：
 * 1. 获取仓库信息（以获取 default_branch）
 * 2. 获取 default_branch 的 latest commit SHA
 * 3. 创建新分支（基于 default_branch）
 * 4. 在新分支上创建文件（PUT /contents/{path}）
 * 5. 创建 PR（POST /pulls）
 *
 * 注意：PAT（个人访问令牌）必须具备适当权限（public_repo 或 repo）
 */
async function createPullRequestFlow({ token, repo, branch, filePath, contentBase64, prTitle, prBody }) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`
  };

  // 1. 获取仓库信息（含 default_branch）
  let repoResp = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoResp.ok) throw new Error(`无法获取仓库信息：${repoResp.status} ${repoResp.statusText}`);
  const repoJson = await repoResp.json();
  const defaultBranch = repoJson.default_branch;

  // 2. 获取 default_branch 的 commit sha
  const refResp = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${defaultBranch}`, { headers });
  if (!refResp.ok) throw new Error(`无法获取默认分支引用：${refResp.status} ${refResp.statusText}`);
  const refJson = await refResp.json();
  const baseSha = refJson.object.sha;

  // 3. 创建新分支（若分支已存在则继续使用）
  const branchRef = `refs/heads/${branch}`;
  // 先检测分支是否存在
  const checkBranch = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, { headers });
  if (!checkBranch.ok) {
    // 分支不存在 -> 创建
    const createRefResp = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: branchRef, sha: baseSha })
    });
    if (!createRefResp.ok) {
      const txt = await createRefResp.text();
      throw new Error(`创建分支失败：${createRefResp.status} ${createRefResp.statusText} ${txt}`);
    }
  } // else 分支已存在，直接使用

  // 4. 在指定分支上创建文件（PUT /repos/{owner}/{repo}/contents/{path}）
  const putResp = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prTitle || `Add called names`,
      content: contentBase64,
      branch
    })
  });
  if (!putResp.ok) {
    const txt = await putResp.text();
    throw new Error(`创建文件失败：${putResp.status} ${putResp.statusText} ${txt}`);
  }
  const putJson = await putResp.json();

  // 5. 创建 Pull Request
  const prResp = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: prTitle || `Add called names`,
      head: branch,
      base: defaultBranch,
      body: prBody || `Add called names via rollcall tool.`
    })
  });
  if (!prResp.ok) {
    const txt = await prResp.text();
    throw new Error(`创建 PR 失败：${prResp.status} ${prResp.statusText} ${txt}`);
  }
  const prJson = await prResp.json();
  return prJson;
}

// 点击“创建 PR”模态的提交按钮逻辑
submitPRBtn.onclick = async () => {
  const repo = prRepoInput.value.trim();
  const filePath = prFilePathInput.value.trim();
  const prTitle = prTitleInput.value.trim();
  let branch = prBranchInput.value.trim();
  const token = prTokenInput.value.trim();

  if (!repo || !filePath || !token) {
    prStatus.textContent = '请填写目标仓库、文件路径与 PAT。';
    return;
  }
  // 生成内容：已点名单（按行）
  const contentText = calledNames.join('\n') || '';
  if (!contentText) {
    prStatus.textContent = '已点名单为空，无法创建 PR。';
    return;
  }

  // 默认分支名若为空，则由 API 自动生成带时间戳的分支名
  if (!branch) {
    const now = new Date();
    branch = `rollcall/called-${now.toISOString().slice(0,19).replace(/[:-]/g,'').replace('T','_')}`;
  }

  prStatus.textContent = '正在创建分支与提交，请稍候...';
  submitPRBtn.disabled = true;

  try {
    // 将 contentText 按 UTF-8 编码为 Base64（兼容中文）
    function utf8_to_b64(str) {
      return btoa(unescape(encodeURIComponent(str)));
    }
    const contentBase64 = utf8_to_b64(contentText);

    const prJson = await createPullRequestFlow({
      token, repo, branch, filePath, contentBase64, prTitle, prBody: `Called names created by rollcall tool.`
    });

    prStatus.innerHTML = `PR 已创建：<a href="${prJson.html_url}" target="_blank">${prJson.html_url}</a>`;
    // 关闭模态（若希望用户能查看链接可不关闭）
    // githubPRModal.style.display = 'none';
  } catch (err) {
    console.error(err);
    prStatus.textContent = `操作失败：${err.message}`;
  } finally {
    submitPRBtn.disabled = false;
  }
};

// 初次加载
loadFromStorage();
