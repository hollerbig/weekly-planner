/* ========== 周计划任务管理器 - 云端版 ========== */

const STORAGE_KEY = 'weeklyPlanner';
const CLOUD_API = 'https://jsonblob.com/api/jsonBlob';
const SYNC_DEBOUNCE = 2000;

let appData = {
  tasks: [],
  archives: [],
  meta: { lastArchiveDate: null, syncId: null, createdAt: null }
};
let currentFilter = 'all';
let syncTimer = null;
let isSyncing = false;

/* ========== 初始化 ========== */
function init() {
  loadData();
  checkAndArchive();
  renderAll();
  initCloudSync();
  setupEvents();
}

/* ========== 本地存储 ========== */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      appData = {
        tasks: p.tasks || [],
        archives: p.archives || [],
        meta: p.meta || { lastArchiveDate: null, syncId: null, createdAt: null }
      };
    }
  } catch (e) { console.error('Load failed', e); }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  renderFooter();
  scheduleCloudSync();
}

/* ========== 云同步 ========== */
function setSyncStatus(status, text) {
  const badge = document.getElementById('syncBadge');
  badge.className = 'sync-badge ' + status;
  document.getElementById('syncText').textContent = text;
}

async function initCloudSync() {
  if (appData.meta.syncId) {
    setSyncStatus('syncing', '同步中...');
    const ok = await pullFromCloud();
    if (ok) {
      setSyncStatus('synced', '已同步');
      renderAll();
    } else {
      setSyncStatus('offline', '离线模式');
    }
  } else {
    setSyncStatus('syncing', '创建云端...');
    const id = await createCloudBlob();
    if (id) {
      appData.meta.syncId = id;
      appData.meta.createdAt = new Date().toISOString();
      saveData();
      setSyncStatus('synced', '已同步');
      toast('云端同步已开启！同步码：' + id, 'success');
    } else {
      setSyncStatus('offline', '离线模式');
      toast('云端服务暂时不可用，已切换到离线模式。仍可正常使用，数据存在本地。', 'warning');
    }
  }
  updateSettingsUI();
}

async function createCloudBlob() {
  try {
    const res = await fetch(CLOUD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(appData)
    });
    if (!res.ok) return null;

    // 优先: X-jsonblob-id header（jsonblob.com 专属头，已通过 CORS 暴露给浏览器）
    let id = null;
    try { id = res.headers.get('X-jsonblob-id'); } catch (e) {}
    // 备选: Location header
    if (!id) {
      try { const loc = res.headers.get('Location'); if (loc) id = loc.split('/').pop(); } catch (e) {}
    }
    return id;
  } catch (e) {
    console.error('Create blob failed', e);
    return null;
  }
}

async function pushToCloud() {
  if (!appData.meta.syncId || isSyncing) return;
  isSyncing = true;
  setSyncStatus('syncing', '同步中...');
  try {
    const res = await fetch(`${CLOUD_API}/${appData.meta.syncId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(appData)
    });
    if (res.ok) {
      setSyncStatus('synced', '已同步');
    } else if (res.status === 404) {
      // blob 已过期（jsonblob.com 24h 限制），自动创建新 blob 恢复
      const newId = await createCloudBlob();
      if (newId) {
        appData.meta.syncId = newId;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        setSyncStatus('synced', '已同步');
        toast('云端存储已自动刷新，同步码已更新', 'warning');
        updateSettingsUI();
      } else {
        setSyncStatus('error', '同步失败');
      }
    } else {
      setSyncStatus('error', '同步失败');
    }
  } catch (e) {
    setSyncStatus('error', '同步失败');
    console.error('Push failed', e);
  }
  isSyncing = false;
}

async function pullFromCloud() {
  if (!appData.meta.syncId) return false;
  try {
    const res = await fetch(`${CLOUD_API}/${appData.meta.syncId}`);
    if (!res.ok) {
      if (res.status === 404 && !isSyncing) {
        // blob 已过期，从本地数据创建新 blob 并推送
        const newId = await createCloudBlob();
        if (newId) {
          appData.meta.syncId = newId;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
          toast('云端数据已过期，已从本地恢复并更新同步码', 'warning');
          updateSettingsUI();
        }
      }
      return false;
    }
    const cloud = await res.json();
    if (cloud && cloud.tasks !== undefined) {
      cloud.meta = cloud.meta || {};
      cloud.meta.syncId = appData.meta.syncId;
      appData = cloud;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      return true;
    }
  } catch (e) { console.error('Pull failed', e); }
  return false;
}

async function connectCloud() {
  const input = document.getElementById('connectSyncId');
  const sid = input.value.trim();
  const st = document.getElementById('connectStatusText');
  if (!sid) { st.textContent = '请输入同步码'; st.className = 'sync-status-text err'; return; }

  st.textContent = '正在关联...'; st.className = 'sync-status-text';
  try {
    const res = await fetch(`${CLOUD_API}/${sid}`);
    if (res.ok) {
      const cloud = await res.json();
      if (cloud && cloud.tasks !== undefined) {
        cloud.meta = cloud.meta || {};
        cloud.meta.syncId = sid;
        appData = cloud;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        renderAll();
        setSyncStatus('synced', '已同步');
        updateSettingsUI();
        st.textContent = '✅ 关联成功！数据已同步';
        st.className = 'sync-status-text ok';
        toast('关联成功，数据已从云端同步', 'success');
        input.value = '';
      } else {
        st.textContent = '同步码无效'; st.className = 'sync-status-text err';
      }
    } else {
      st.textContent = '同步码不存在或网络问题'; st.className = 'sync-status-text err';
    }
  } catch (e) {
    st.textContent = '连接失败，请检查网络'; st.className = 'sync-status-text err';
    console.error(e);
  }
}

function scheduleCloudSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushToCloud(), SYNC_DEBOUNCE);
}

function copySyncId() {
  const sid = appData.meta.syncId;
  if (!sid) { toast('暂无同步码', 'warning'); return; }
  navigator.clipboard?.writeText(sid).then(
    () => toast('同步码已复制：' + sid, 'success'),
    () => {
      const inp = document.getElementById('syncIdInput');
      inp.removeAttribute('readonly'); inp.select();
      document.execCommand('copy'); inp.setAttribute('readonly', '');
      toast('同步码已复制', 'success');
    }
  );
}

function updateSettingsUI() {
  const inp = document.getElementById('syncIdInput');
  const st = document.getElementById('syncStatusText');
  if (appData.meta.syncId) {
    inp.value = appData.meta.syncId;
    st.textContent = '✅ 云端同步已开启，数据自动同步';
    st.className = 'sync-status-text ok';
  } else {
    inp.value = '';
    st.textContent = '⚠️ 云端同步未开启，数据仅存本地';
    st.className = 'sync-status-text err';
  }
}

/* ========== 日期工具 ========== */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(date) {
  const m = getMonday(date);
  const s = new Date(m); s.setDate(m.getDate() + 6);
  return { monday: m, sunday: s };
}

function getISOWeek(date) {
  const d = new Date(date);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((t - ys) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ========== 归档逻辑 ========== */
function checkAndArchive() {
  const now = new Date();
  const { monday } = getWeekRange(now);
  const last = appData.meta.lastArchiveDate ? new Date(appData.meta.lastArchiveDate) : null;
  if (!last || last < monday) { doArchive(false); }
}

async function confirmArchive() {
  const n = appData.tasks.length;
  if (!confirm(n === 0 ? '当前没有任务，确认归档？（仅记录时间）' : `确认归档当前 ${n} 个任务？\n归档后计划表将重置，并自动生成一张JPG图片（含任务表+进程表）。`)) return;
  await doArchive(true);
}

async function doArchive(manual) {
  const now = new Date();
  const n = appData.tasks.length;
  if (n > 0) {
    const { monday, sunday } = getWeekRange(now);
    const archiveData = {
      id: 'arc-' + Date.now(),
      archivedAt: now.toISOString(),
      weekStart: fmtDate(monday),
      weekEnd: fmtDate(sunday),
      isoWeek: getISOWeek(now),
      taskCount: n,
      tasks: JSON.parse(JSON.stringify(appData.tasks))
    };
    await generateArchiveImage(archiveData);
    appData.archives.unshift(archiveData);
    appData.tasks = [];
    toast(manual ? `已归档 ${n} 个任务，JPG图片已生成下载` : `自动归档 ${n} 个任务（${archiveData.isoWeek}）`, 'success');
  } else if (manual) {
    toast('已记录归档时间', 'info');
  }
  appData.meta.lastArchiveDate = now.toISOString();
  saveData();
  renderAll();
}

async function generateArchiveImage(archiveData) {
  if (typeof html2canvas === 'undefined') {
    console.warn('html2canvas 未加载，跳过图片生成');
    return;
  }
  try {
    const capture = document.createElement('div');
    capture.className = 'export-capture';
    const order = { '高': 0, '中': 1, '低': 2 };
    const sorted = [...archiveData.tasks].sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
    let html = '<div class="exp-title">📋 周计划任务管理器</div>';
    html += `<div class="exp-sub">${archiveData.isoWeek} | ${archiveData.weekStart} ~ ${archiveData.weekEnd} | 归档于 ${new Date(archiveData.archivedAt).toLocaleString('zh-CN')}</div>`;
    html += `<div class="exp-section-title">📝 本周任务（${archiveData.taskCount}个）</div>`;
    html += '<table class="archive-detail-table"><thead><tr><th>项目名称</th><th>优先级</th><th>开始</th><th>结束</th><th>负责人</th><th>状态</th></tr></thead><tbody>';
    sorted.forEach(t => {
      html += `<tr><td>${esc(t.projectName)}</td><td>${t.priority}</td><td>${t.startDate || '—'}</td><td>${t.endDate || '—'}</td><td>${esc(t.owner || '—')}</td><td>${t.status}</td></tr>`;
    });
    html += '</tbody></table>';
    html += '<div class="exp-section-title">📊 每周进程表</div>';
    html += ganttTableHtml(archiveData.tasks);
    capture.innerHTML = html;
    document.body.appendChild(capture);
    await new Promise(r => setTimeout(r, 200));
    const canvas = await html2canvas(capture, { backgroundColor: '#0d0d1a', scale: 2, logging: false, useCORS: true });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${archiveData.isoWeek}_${archiveData.weekStart}_${archiveData.weekEnd}.jpg`;
    link.click();
    document.body.removeChild(capture);
  } catch (e) {
    console.error('生成图片失败', e);
    toast('图片生成失败，归档数据仍已保存', 'warning');
  }
}

/* ========== 任务 CRUD ========== */
function genId() { return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function addTask(t) { t.id = genId(); t.createdAt = new Date().toISOString(); appData.tasks.push(t); saveData(); }
function updateTask(id, u) { const t = appData.tasks.find(x => x.id === id); if (t) { Object.assign(t, u); saveData(); } }
function deleteTask(id) { appData.tasks = appData.tasks.filter(t => t.id !== id); saveData(); }

/* ========== UI 渲染 ========== */
function renderAll() { renderWeek(); renderStats(); renderTasks(); renderGantt(); renderFooter(); }

function renderWeek() {
  const { monday, sunday } = getWeekRange(new Date());
  document.getElementById('weekInfo').textContent = `${getISOWeek(new Date())} | ${fmtDate(monday)} ~ ${fmtDate(sunday)}`;
}

function renderStats() {
  document.getElementById('statTotal').textContent = appData.tasks.length;
  document.getElementById('statHigh').textContent = appData.tasks.filter(t => t.priority === '高').length;
  document.getElementById('statProgress').textContent = appData.tasks.filter(t => t.status === '进行中').length;
  document.getElementById('statDone').textContent = appData.tasks.filter(t => t.status === '已完成').length;
}

function renderTasks() {
  const tbody = document.getElementById('taskBody');
  let tasks = appData.tasks;
  if (currentFilter !== 'all') tasks = tasks.filter(t => t.status === currentFilter);

  if (tasks.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9"><div class="empty-state"><span class="empty-icon">🗒️</span><p>${currentFilter === 'all' ? '本周还没有任务，点击「新增任务」开始规划' : '该状态下暂无任务'}</p></div></td></tr>`;
    return;
  }

  const order = { '高': 0, '中': 1, '低': 2 };
  tasks = [...tasks].sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));

  tbody.innerHTML = tasks.map((t, i) => `
    <tr>
      <td style="color:var(--text-dim)">${i + 1}</td>
      <td><strong>${esc(t.projectName)}</strong></td>
      <td>${pTag(t.priority)}</td>
      <td>${t.startDate ? t.startDate.slice(5) : '—'}</td>
      <td>${t.endDate ? t.endDate.slice(5) : '—'}</td>
      <td>${esc(t.owner || '—')}</td>
      <td><span class="status-dot status-${t.status}">${t.status}</span></td>
      <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.remark || '')}">${esc(t.remark || '—')}</td>
      <td>
        <button class="op-btn" onclick="openTaskModal('${t.id}')" title="编辑">✏️</button>
        <button class="op-btn del" onclick="delConfirm('${t.id}')" title="删除">🗑️</button>
      </td>
    </tr>`).join('');
}

/* ========== 每周进程表（甘特视图） ========== */
function getWeekDays() {
  const { monday } = getWeekRange(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(d); }
  return days;
}

function ganttHeadHtml() {
  const days = getWeekDays();
  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
  const todayStr = fmtDate(new Date());
  let h = '<tr><th class="gantt-name-col">负责人</th>';
  days.forEach((d, i) => {
    const isToday = fmtDate(d) === todayStr;
    const isWeekend = i >= 5;
    h += `<th class="gantt-day${isToday ? ' today' : ''}${isWeekend ? ' gantt-weekend' : ''}"><div class="day-week">周${dayNames[i]}</div><div class="day-date">${d.getMonth() + 1}/${d.getDate()}</div></th>`;
  });
  return h + '</tr>';
}

function ganttBodyHtml(tasks) {
  const days = getWeekDays();
  const order = { '高': 0, '中': 1, '低': 2 };
  const sorted = [...tasks].sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
  const barClass = { '高': 'bar-high', '中': 'bar-mid', '低': 'bar-low' };
  if (sorted.length === 0) return '<tr><td colspan="8" class="gantt-empty">📊 本周暂无任务，添加任务后将自动生成进程表</td></tr>';
  const weekStartStr = fmtDate(days[0]);
  const weekEndStr = fmtDate(days[6]);
  let body = '';
  sorted.forEach(t => {
    const sd = t.startDate || '', ed = t.endDate || '';
    const bc = barClass[t.priority] || 'bar-mid';
    // 行首：负责人名称
    body += `<tr><td class="gantt-name" title="${esc(t.owner || '')}">${esc(t.owner || '—')}</td>`;
    // 无日期：7 个空格
    if (!sd || !ed) {
      for (let i = 0; i < 7; i++) body += `<td class="gantt-cell${i >= 5 ? ' gantt-weekend' : ''}"></td>`;
      body += '</tr>';
      return;
    }
    // 限制到本周范围
    const effStart = sd < weekStartStr ? weekStartStr : sd;
    const effEnd = ed > weekEndStr ? weekEndStr : ed;
    let i = 0;
    while (i < 7) {
      const ds = fmtDate(days[i]);
      const isWeekend = i >= 5;
      if (ds === effStart) {
        // 贯穿色块：计算跨度，用 colspan 一次性输出完整色块
        let span = 0, j = i;
        while (j < 7 && fmtDate(days[j]) <= effEnd) { span++; j++; }
        const name = esc(t.projectName || '');
        body += `<td colspan="${span}" class="gantt-cell gantt-span${isWeekend ? ' gantt-weekend' : ''}"><div class="gantt-bar ${bc} bar-full" title="${name}">${name}</div></td>`;
        i = j;
      } else {
        body += `<td class="gantt-cell${isWeekend ? ' gantt-weekend' : ''}"></td>`;
        i++;
      }
    }
    body += '</tr>';
  });
  return body;
}

function ganttTableHtml(tasks) {
  return `<table class="gantt-table"><thead>${ganttHeadHtml()}</thead><tbody>${ganttBodyHtml(tasks)}</tbody></table>`;
}

function renderGantt() {
  document.getElementById('ganttHead').innerHTML = ganttHeadHtml();
  document.getElementById('ganttBody').innerHTML = ganttBodyHtml(appData.tasks);
}

function renderFooter() {
  const el = document.getElementById('updateInfo');
  el.textContent = appData.meta.lastArchiveDate
    ? `上次归档: ${new Date(appData.meta.lastArchiveDate).toLocaleString('zh-CN')}`
    : '尚未归档';
}

function pTag(p) {
  const m = { '高': 'tag-high', '中': 'tag-mid', '低': 'tag-low' };
  const ic = { '高': '🔴', '中': '🟡', '低': '🟢' };
  return `<span class="tag ${m[p] || 'tag-mid'}">${ic[p] || ''} ${p}</span>`;
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ========== Toast ========== */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; setTimeout(() => el.remove(), 300); }, 3000);
}

/* ========== 弹窗 ========== */
function openTaskModal(id = null) {
  const modal = document.getElementById('taskModal');
  const { monday } = getWeekRange(new Date());
  const ms = fmtDate(monday);

  if (id) {
    const t = appData.tasks.find(x => x.id === id);
    if (!t) return;
    document.getElementById('taskModalTitle').textContent = '编辑任务';
    setForm(t.projectName || '', t.priority || '中', t.status || '未开始', t.startDate || ms, t.endDate || ms, t.owner || '', t.remark || '');
    modal.dataset.taskId = id;
  } else {
    document.getElementById('taskModalTitle').textContent = '新增任务';
    setForm('', '中', '未开始', ms, ms, '', '');
    modal.dataset.taskId = '';
  }
  modal.classList.add('show');
  setTimeout(() => document.getElementById('fProjectName').focus(), 100);
}

function setForm(name, pri, st, sd, ed, owner, remark) {
  document.getElementById('fProjectName').value = name;
  document.getElementById('fPriority').value = pri;
  document.getElementById('fStatus').value = st;
  document.getElementById('fStartDate').value = sd;
  document.getElementById('fEndDate').value = ed;
  document.getElementById('fOwner').value = owner;
  document.getElementById('fRemark').value = remark;
}

function closeTaskModal() { document.getElementById('taskModal').classList.remove('show'); }

function saveTask() {
  const id = document.getElementById('taskModal').dataset.taskId;
  const p = {
    projectName: document.getElementById('fProjectName').value.trim(),
    priority: document.getElementById('fPriority').value,
    status: document.getElementById('fStatus').value,
    startDate: document.getElementById('fStartDate').value,
    endDate: document.getElementById('fEndDate').value,
    owner: document.getElementById('fOwner').value.trim(),
    remark: document.getElementById('fRemark').value.trim()
  };
  if (!p.projectName) { toast('请填写项目名称', 'error'); return; }
  if (!p.startDate || !p.endDate) { toast('请填写开始和结束时间', 'error'); return; }
  if (p.endDate < p.startDate) { toast('结束时间不能早于开始时间', 'error'); return; }

  if (id) { updateTask(id, p); toast('任务已更新', 'success'); }
  else { addTask(p); toast('任务已添加', 'success'); }
  closeTaskModal();
  renderAll();
}

function delConfirm(id) {
  if (!confirm('确认删除这个任务？')) return;
  deleteTask(id);
  toast('任务已删除', 'success');
  renderAll();
}

function openSettingsModal() { document.getElementById('settingsModal').classList.add('show'); updateSettingsUI(); }
function closeSettingsModal() { document.getElementById('settingsModal').classList.remove('show'); }

/* ========== 归档历史 ========== */
function openArchiveDrawer() {
  document.getElementById('archiveDrawerOverlay').classList.add('show');
  document.getElementById('archiveDrawer').classList.add('show');
  loadArchives();
}
function closeArchiveDrawer() {
  document.getElementById('archiveDrawerOverlay').classList.remove('show');
  document.getElementById('archiveDrawer').classList.remove('show');
}

function loadArchives() {
  const list = document.getElementById('archiveList');
  if (appData.archives.length === 0) { list.innerHTML = '<p class="drawer-empty">暂无归档记录</p>'; return; }
  list.innerHTML = appData.archives.map(a => `
    <div class="archive-item" onclick="viewArchive('${a.id}')">
      <div class="archive-item-top">
        <span class="archive-week">${a.isoWeek || '—'}</span>
        <span class="archive-count">${a.taskCount || (a.tasks ? a.tasks.length : 0)} 个任务</span>
      </div>
      <div class="archive-item-meta">
        <span>📅 ${a.weekStart || '?'} ~ ${a.weekEnd || '?'}</span>
        <span>🕐 ${a.archivedAt ? new Date(a.archivedAt).toLocaleString('zh-CN') : '—'}</span>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();viewArchive('${a.id}')">查看详情</button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();downloadArchive('${a.id}')">⬇ 下载</button>
      </div>
    </div>`).join('');
}

function viewArchive(id) {
  const a = appData.archives.find(x => x.id === id);
  if (!a) return;
  document.getElementById('archiveDetailTitle').textContent = `${a.isoWeek} 归档详情 (${a.weekStart} ~ ${a.weekEnd})`;
  const tasks = a.tasks || [];
  document.getElementById('archiveDetailBody').innerHTML = tasks.length === 0
    ? '<p style="color:var(--text-dim);text-align:center;padding:30px">本周无任务记录</p>'
    : `<table class="archive-detail-table"><thead><tr><th>项目名称</th><th>优先级</th><th>开始</th><th>结束</th><th>负责人</th><th>状态</th></tr></thead><tbody>${tasks.map(t => `<tr><td><strong>${esc(t.projectName)}</strong></td><td>${t.priority}</td><td>${t.startDate || '—'}</td><td>${t.endDate || '—'}</td><td>${esc(t.owner || '—')}</td><td>${t.status}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('archiveDetailModal').classList.add('show');
}
function closeArchiveDetail() { document.getElementById('archiveDetailModal').classList.remove('show'); }

function downloadArchive(id) {
  const a = appData.archives.find(x => x.id === id);
  if (!a) return;
  const blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.isoWeek}_${a.weekStart}_${a.weekEnd}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('归档文件已下载', 'success');
}

/* ========== 导出 / 导入 ========== */
function exportData() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weekly-planner-${fmtDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('数据已导出', 'success');
}

function importData(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const d = JSON.parse(e.target.result);
      if (d.tasks && d.archives) {
        appData = d;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        renderAll();
        scheduleCloudSync();
        toast('数据导入成功', 'success');
        closeSettingsModal();
      } else { toast('文件格式不正确', 'error'); }
    } catch { toast('导入失败：文件格式错误', 'error'); }
  };
  r.readAsText(file);
}

/* ========== 事件绑定 ========== */
function setupEvents() {
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-btn')) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderTasks();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeTaskModal(); closeSettingsModal(); closeArchiveDetail(); closeArchiveDrawer(); }
    if (e.key === 'Enter' && e.ctrlKey) { if (document.getElementById('taskModal').classList.contains('show')) saveTask(); }
  });

  document.getElementById('taskModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTaskModal(); });
  document.getElementById('settingsModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSettingsModal(); });
  document.getElementById('archiveDetailModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeArchiveDetail(); });

  // 每5分钟检查归档
  setInterval(() => checkAndArchive(), 5 * 60 * 1000);
  // 每2分钟从云端拉取
  setInterval(() => { if (appData.meta.syncId && !isSyncing) pullFromCloud().then(ok => { if (ok) renderAll(); }); }, 2 * 60 * 1000);
  // 页面重新可见时拉取
  document.addEventListener('visibilitychange', () => { if (!document.hidden && appData.meta.syncId && !isSyncing) pullFromCloud().then(ok => { if (ok) renderAll(); }); });
}

/* ========== 启动 ========== */
init();
