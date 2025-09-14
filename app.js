// 点名器应用 - 重构版本
// 模块化设计，代码分离，性能优化

// 配置常量
const STORAGE_ALL = 'rollcall_all_names_v1';
const STORAGE_CALLED = 'rollcall_called_names_v1';
const THEME_KEY = 'rollcall_theme_v1';

// 全局变量
let allNames = [];
let calledNames = [];
let rolling = false;
let intervalId = null;
let lastShown = '';
let modeRandom = true;

// DOM 元素引用
const elements = {
  themeToggle: document.getElementById('themeToggle'),
  namesInput: document.getElementById('namesInput'),
  loadNamesBtn: document.getElementById('loadNames'),
  shuffleBtn: document.getElementById('shuffle'),
  clearAllBtn: document.getElementById('clearAll'),
  totalCount: document.getElementById('totalCount'),
  remainingCount: document.getElementById('remainingCount'),
  nameDisplay: document.getElementById('nameDisplay'),
  toggleRollBtn: document.getElementById('toggleRollBtn'),
  markBtn: document.getElementById('markBtn'),
  calledListEl: document.getElementById('calledList'),
  copyCalled: document.getElementById('copyCalled'),
  exportCalled: document.getElementById('exportCalled'),
  clearCalled: document.getElementById('clearCalled'),
  modeLabel: document.getElementById('modeLabel'),
  namesInputTitle: document.getElementById('namesInputTitle'),
  importFromGitHub: document.getElementById('importFromGitHub'),
  githubModal: document.getElementById('githubModal'),
  closeModal: document.getElementById('closeModal'),
  fetchCSV: document.getElementById('fetchCSV'),
  githubRepo: document.getElementById('githubRepo'),
  csvFiles: document.getElementById('csvFiles')
};

// 主题管理
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light-theme');
  } else {
    document.documentElement.classList.remove('light-theme');
  }
  if (elements.themeToggle) {
    elements.themeToggle.textContent = (theme === 'light') ? '☀️' : '🌙';
  }
}

function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      applyTheme(saved);
      return;
    }
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  } catch (e) {
    console.warn('主题初始化错误', e);
  }
}

function toggleTheme() {
  try {
    const isLight = document.documentElement.classList.contains('light-theme');
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    console.warn('主题切换错误', e);
  }
}

// 存储管理
function loadFromStorage() {
  try {
    const rawAll = localStorage.getItem(STORAGE_ALL);
    const rawCalled = localStorage.getItem(STORAGE_CALLED);
    allNames = rawAll ? JSON.parse(rawAll) : [];
    calledNames = rawCalled ? JSON.parse(rawCalled) : [];
    renderCalledList();
    updateCounts();
    elements.namesInput.value = allNames.join('\n');
    updateUIState();
  } catch (e) {
    console.error('存储加载错误', e);
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_ALL, JSON.stringify(allNames));
  localStorage.setItem(STORAGE_CALLED, JSON.stringify(calledNames));
}

// 输入处理
function parseInput() {
  const raw = elements.namesInput.value.trim();
  if (!raw) return [];
  const items = raw.split(/[\n,;，；]+/).map(s => s.trim()).filter(Boolean);
  return Array.from(new Set(items));
}

// 计数更新
function updateCounts() {
  elements.totalCount.textContent = '总数: ' + (allNames.length + calledNames.length);
  elements.remainingCount.textContent = '剩余: ' + allNames.length;
}

// UI 状态管理
function updateUIState(updateDisplay = true) {
  const hasNames = allNames.length > 0;
  const hasCalledNames = calledNames.length > 0;

  if (updateDisplay) {
    if (allNames.length === 0) {
      if (calledNames.length === 0) {
        elements.nameDisplay.textContent = '名单为空，请导入名单';
      } else {
        elements.nameDisplay.textContent = '所有学生已点名完毕';
      }
    } else {
      elements.nameDisplay.textContent = '点击"开始滚动"开始点名';
    }
  }

  // 更新按钮状态
  elements.toggleRollBtn.disabled = !hasNames;
  elements.toggleRollBtn.classList.toggle('ghost', !hasNames);
  
  elements.shuffleBtn.disabled = !hasNames;
  elements.clearAllBtn.disabled = !hasNames;
  elements.loadNamesBtn.disabled = !hasNames;
  elements.shuffleBtn.classList.toggle('ghost', !hasNames);
  elements.clearAllBtn.classList.toggle('ghost', !hasNames);
  elements.loadNamesBtn.classList.toggle('ghost', !hasNames);
  
  elements.copyCalled.disabled = !hasCalledNames;
  elements.exportCalled.disabled = !hasCalledNames;
  elements.clearCalled.disabled = !hasCalledNames;
  elements.copyCalled.classList.toggle('ghost', !hasCalledNames);
  elements.exportCalled.classList.toggle('ghost', !hasCalledNames);
  elements.clearCalled.classList.toggle('ghost', !hasCalledNames);
}

// 已点名单渲染
function renderCalledList() {
  elements.calledListEl.innerHTML = '';
  calledNames.forEach((name, idx) => {
    const div = document.createElement('div');
    div.className = 'called-item';
    
    const left = document.createElement('div');
    left.textContent = name;
    
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '8px';
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '移除';
    removeBtn.className = 'small ghost';
    removeBtn.onclick = () => {
      calledNames.splice(idx, 1);
      allNames.push(name);
      saveToStorage();
      renderCalledList();
      updateCounts();
      elements.namesInput.value = allNames.join('\n');
    };
    
    right.appendChild(removeBtn);
    div.appendChild(left);
    div.appendChild(right);
    elements.calledListEl.appendChild(div);
  });
}

// 名单操作
function loadNames() {
  const parsed = parseInput();
  allNames = parsed.filter(n => !calledNames.includes(n));
  saveToStorage();
  updateCounts();
  elements.nameDisplay.textContent = '名单已加载';
  
  // 对文本框内容去重
  const uniqueLines = [...new Set(parsed)];
  elements.namesInput.value = uniqueLines.join('\n');
  updateUIState();
}

function shuffleNames() {
  for (let i = allNames.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allNames[i], allNames[j]] = [allNames[j], allNames[i]];
  }
  elements.nameDisplay.textContent = '名单已打乱';
  elements.namesInput.value = allNames.join('\n');
  saveToStorage();
}

function clearAllNames() {
  if (!confirm('确认清空全部名单吗？此操作将同时清空待点名单和已点名单。')) return;
  allNames = [];
  calledNames = [];
  elements.namesInput.value = '';
  updateCounts();
  saveToStorage();
  renderCalledList();
  elements.nameDisplay.textContent = '已清空';
  updateUIState();
}

// 点名功能
function toggleRoll() {
  if (!rolling) {
    // 若当前输入框未加载到存量，则尝试加载
    if (allNames.length === 0) {
      const parsed = parseInput();
      if (parsed.length === 0) {
        alert('名单为空，请先粘贴或加载名单。');
        return;
      }
      allNames = parsed.filter(n => !calledNames.includes(n));
      saveToStorage();
    }
    rolling = true;
    elements.toggleRollBtn.textContent = '停止';
    elements.nameDisplay.classList.add('blur');
    modeRandom = true;
    elements.modeLabel.textContent = '随机';
    
    intervalId = setInterval(() => {
      if (allNames.length === 0) {
        elements.nameDisplay.textContent = '无候选';
        return;
      }
      const pick = allNames[Math.floor(Math.random() * allNames.length)];
      lastShown = pick;
      elements.nameDisplay.textContent = pick;
    }, 60);
  } else {
    rolling = false;
    elements.toggleRollBtn.textContent = '开始滚动';
    elements.nameDisplay.classList.remove('blur');
    if (intervalId) clearInterval(intervalId);
    
    const chosen = lastShown || elements.nameDisplay.textContent;
    if (!chosen || chosen === '点击"开始滚动"开始' || chosen === '名单已加载' || chosen === '无候选') {
      elements.nameDisplay.textContent = '未能选中有效姓名';
      return;
    }
    
    // 将选中者从 allNames 移到 calledNames
    const idx = allNames.indexOf(chosen);
    if (idx !== -1) allNames.splice(idx, 1);
    if (!calledNames.includes(chosen)) calledNames.unshift(chosen);
    saveToStorage();
    renderCalledList();
    updateCounts();
    elements.nameDisplay.textContent = chosen;
    
    // 从文本框显示中移除选中的名字
    const currentText = elements.namesInput.value;
    const lines = currentText.split('\n').filter(line => line.trim() !== chosen);
    elements.namesInput.value = lines.join('\n');
    updateUIState(false);
  }
}

// 手动标记功能
function updateMarkBtnState() {
  const textarea = elements.namesInput;
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

  elements.markBtn.disabled = !hasSelection;
  elements.markBtn.classList.toggle('ghost', !hasSelection);
}

function markSelected() {
  if (elements.markBtn.disabled) return;

  const textarea = elements.namesInput;
  const startPos = textarea.selectionStart;
  const endPos = textarea.selectionEnd;

  let selectedText = '';
  if (startPos !== endPos) {
    selectedText = textarea.value.substring(startPos, endPos).trim();
  } else {
    const text = textarea.value;
    const lines = text.split('\n');
    let lineStart = 0;
    let lineEnd = 0;
    let currentLine = '';

    for (const line of lines) {
      lineEnd = lineStart + line.length + 1;
      if (startPos >= lineStart && startPos < lineEnd) {
        currentLine = line.trim();
        break;
      }
      lineStart = lineEnd;
    }
    selectedText = currentLine;
  }

  if (!selectedText) return alert('未检测到姓名可标记');

  const items = selectedText.split(/[\n,;，；]+/).map(s => s.trim()).filter(Boolean);
  items.forEach(item => {
    const idx = allNames.indexOf(item);
    if (idx !== -1) allNames.splice(idx, 1);
    if (!calledNames.includes(item)) calledNames.unshift(item);
  });
  
  saveToStorage();
  renderCalledList();
  updateCounts();
  elements.namesInput.value = allNames.join('\n');
  elements.markBtn.disabled = true;
  elements.markBtn.classList.add('ghost');
}

// 已点名单操作
async function copyCalledList() {
  try {
    await navigator.clipboard.writeText(calledNames.join('\n'));
    alert('已复制到剪贴板');
  } catch (e) {
    alert('复制失败，请手动选择并复制。');
  }
}

function exportCalledList() {
  const blob = new Blob([calledNames.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'called_names.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function clearCalledList() {
  if (!confirm('确认清除已点名单？此操作不可恢复。')) return;
  allNames = allNames.concat(calledNames);
  calledNames = [];
  saveToStorage();
  renderCalledList();
  updateCounts();
  elements.namesInput.value = allNames.join('\n');
  updateUIState();
}

// GitHub 导入功能
function updateNamesInputTitle(filename) {
  const nameWithoutExt = filename.replace(/\.csv$/, '');
  const truncated = nameWithoutExt.length > 15 ? nameWithoutExt.substring(0, 15) + '...' : nameWithoutExt;
  elements.namesInputTitle.textContent = truncated;
  elements.namesInputTitle.title = nameWithoutExt;
}

async function fetchCSVFiles() {
  const repo = elements.githubRepo.value.trim();
  if (!repo) return alert('请输入 GitHub 仓库地址');

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents`);
    const data = await response.json();
    const csvFilesList = data.filter(file => file.name.endsWith('.csv'));

    if (csvFilesList.length === 0) {
      elements.csvFiles.innerHTML = '未找到 CSV 文件';
      return;
    }

    elements.csvFiles.innerHTML = '<h4>选择 CSV 文件：</h4>';
    csvFilesList.forEach(file => {
      const button = document.createElement('button');
      button.textContent = file.name;
      button.style.margin = '5px';
      button.onclick = async () => {
        try {
          const csvResponse = await fetch(file.download_url);
          const csvText = await csvResponse.text();
          const names = csvText.split('\n').map(line => line.trim()).filter(Boolean);
          elements.namesInput.value = names.join('\n');
          allNames = names.filter(n => !calledNames.includes(n));
          saveToStorage();
          updateCounts();
          updateNamesInputTitle(file.name);
          elements.githubModal.style.display = 'none';
          elements.nameDisplay.textContent = 'CSV 文件已加载';
          updateUIState();
        } catch (error) {
          console.error('CSV 加载错误:', error);
          alert('加载 CSV 文件失败');
        }
      };
      elements.csvFiles.appendChild(button);
    });
  } catch (error) {
    console.error('GitHub 仓库获取错误:', error);
    alert('获取仓库内容失败');
  }
}

// 事件监听器设置
function setupEventListeners() {
  // 主题切换
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', toggleTheme);
  }

  // 名单操作
  elements.loadNamesBtn.addEventListener('click', loadNames);
  elements.shuffleBtn.addEventListener('click', shuffleNames);
  elements.clearAllBtn.addEventListener('click', clearAllNames);
  elements.toggleRollBtn.addEventListener('click', toggleRoll);
  elements.markBtn.addEventListener('click', markSelected);

  // 输入框事件
  elements.namesInput.addEventListener('select', updateMarkBtnState);
  elements.namesInput.addEventListener('click', updateMarkBtnState);
  elements.namesInput.addEventListener('keyup', updateMarkBtnState);
  elements.namesInput.addEventListener('input', () => {
    const parsed = parseInput();
    if (parsed.length === 0 && !rolling) {
      allNames = [];
      saveToStorage();
      updateCounts();
      updateUIState();
    }
  });

  // 已点名单操作
  elements.copyCalled.addEventListener('click', copyCalledList);
  elements.exportCalled.addEventListener('click', exportCalledList);
  elements.clearCalled.addEventListener('click', clearCalledList);

  // GitHub 导入
  elements.importFromGitHub.addEventListener('click', () => {
    elements.githubModal.style.display = 'flex';
  });

  elements.githubModal.addEventListener('click', (e) => {
    if (e.target === elements.githubModal) {
      elements.githubModal.style.display = 'none';
    }
  });

  elements.closeModal.addEventListener('click', () => {
    elements.githubModal.style.display = 'none';
  });

  elements.fetchCSV.addEventListener('click', fetchCSVFiles);

  // 页面离开时保存
  window.addEventListener('beforeunload', () => {
    const parsed = parseInput();
    if (parsed.length > 0) {
      allNames = parsed.filter(n => !calledNames.includes(n));
    }
    saveToStorage();
  });
}

// 初始化应用
function initApp() {
  initTheme();
  loadFromStorage();
  setupEventListeners();
  updateMarkBtnState();
  updateUIState();
}

// 启动应用
document.addEventListener('DOMContentLoaded', initApp);