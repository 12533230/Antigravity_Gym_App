/* ===================================================
   TrainTrack — app.js
   Workout Tracker with Google Sheets Sync
   =================================================== */

'use strict';

// ============ CONSTANTS ============
const STORAGE_KEY = 'traintrack_entries';
const CONFIG_KEY = 'traintrack_config';
const APPS_SCRIPT_CODE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['ID','Data','Exercício','Carga (kg)','Reps','Séries','Volume','Notas','Sessão']);
    }
    sheet.appendRow([
      data.id, data.date, data.exercise,
      data.load, data.reps, data.sets,
      data.volume, data.notes || '', data.sessionId
    ]);
    return ContentService.createTextOutput(JSON.stringify({status:'ok'}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error',message:err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

// ============ STATE ============
let state = {
  entries: [],
  config: { sheetsUrl: '' },
  session: {
    active: false,
    id: null,
    date: null,
    entries: []
  },
  chartMode: 'load',
  chartInstance: null,
  autocompleteIndex: -1,
  autoSaveTimer: null
};

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  loadConfig();
  renderAppsScriptCode();
  renderHistorico();
  populateChartExerciseSelect();
  document.getElementById('sheetsUrl').value = state.config.sheetsUrl || '';
  initSetsTable();
  initNotifStatus();
  // Restore location toggle preference
  const locPref = localStorage.getItem('traintrack_location_enabled');
  const locToggle = document.getElementById('locationToggle');
  if (locToggle && locPref !== null) locToggle.checked = locPref === '1';
});

// ============ DATA LAYER ============
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.entries = raw ? JSON.parse(raw) : [];
  } catch { state.entries = []; }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
  showAutosaveIndicator();
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    state.config = raw ? JSON.parse(raw) : { sheetsUrl: '' };
  } catch { state.config = { sheetsUrl: '' }; }
}

function saveConfig() {
  const url = document.getElementById('sheetsUrl').value.trim();
  state.config.sheetsUrl = url;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  showConfigMsg('✓ Configuração salva com sucesso!', 'success');
  showToast('Configuração salva!', 'success');
}

function showAutosaveIndicator() {
  const el = document.getElementById('autosaveIndicator');
  if (!el) return;
  el.classList.add('visible');
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}

// ============ GOOGLE SHEETS SYNC ============
async function syncToSheets(entry) {
  if (!state.config.sheetsUrl) return;
  setSyncStatus('syncing', 'Sincronizando...');
  try {
    await fetch(state.config.sheetsUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    setSyncStatus('synced', 'Sincronizado');
    setTimeout(() => setSyncStatus('', 'Local'), 3000);
  } catch (err) {
    setSyncStatus('error', 'Erro sync');
    showToast('Falha ao sincronizar com Sheets', 'error');
  }
}

function setSyncStatus(cls, label) {
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  dot.className = 'sync-dot' + (cls ? ' ' + cls : '');
  lbl.textContent = label;
}

async function testSheets() {
  const url = document.getElementById('sheetsUrl').value.trim();
  if (!url) { showConfigMsg('Cole a URL do Web App primeiro.', 'error'); return; }
  showConfigMsg('Testando conexão...', '');
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test', date: new Date().toLocaleDateString('pt-BR'), exercise: 'TESTE', load: 0, reps: 0, sets: 0, volume: 0, notes: 'Teste de conexão', sessionId: 'test' })
    });
    showConfigMsg('✓ Requisição enviada! Verifique sua planilha.', 'success');
  } catch {
    showConfigMsg('✗ Erro ao conectar. Verifique a URL.', 'error');
  }
}

function showConfigMsg(msg, type) {
  const el = document.getElementById('configMsg');
  el.textContent = msg;
  el.className = 'config-msg' + (type ? ' ' + type : '');
}

// ============ TAB NAVIGATION ============
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('content-' + tab).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');

  if (tab === 'historico') renderHistorico();
  if (tab === 'performance') populateChartExerciseSelect();
}

// ============ SESSION MANAGEMENT ============
function startSession() {
  state.session.active = true;
  state.session.id = 'session_' + Date.now();
  state.session.date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  state.session.entries = [];
  state.session.location = null;
  currentLocation = null;

  document.getElementById('startSessionBtn').style.display = 'none';
  document.getElementById('finishSessionBtn').style.display = 'inline-flex';
  document.getElementById('sessionInfo').style.display = 'flex';
  document.getElementById('sessionDateDisplay').textContent = state.session.date;
  document.getElementById('exerciseFormCard').style.display = 'block';
  document.getElementById('currentSessionList').innerHTML = '';
  updateSessionCount();
  clearForm();
  document.getElementById('exerciseName').focus();

  // Auto-detect location
  detectLocation();
}

function finishSession() {
  if (state.session.entries.length === 0) {
    showToast('Adicione pelo menos um exercício antes de finalizar.', 'warning');
    return;
  }
  state.session.active = false;
  document.getElementById('startSessionBtn').style.display = 'inline-flex';
  document.getElementById('finishSessionBtn').style.display = 'none';
  document.getElementById('sessionInfo').style.display = 'none';
  document.getElementById('exerciseFormCard').style.display = 'none';
  document.getElementById('insightBanner').style.display = 'none';
  document.getElementById('currentSessionList').innerHTML = '';
  document.getElementById('locationBar').style.display = 'none';
  showToast(`Treino finalizado! ${state.session.entries.length} exercício(s) registrado(s).`, 'success');
  state.session.entries = [];
  renderHistorico();
}

function updateSessionCount() {
  const n = state.session.entries.length;
  document.getElementById('sessionCount').textContent = n + ' exercício' + (n !== 1 ? 's' : '');
  document.getElementById('exerciseNum').textContent = 'Exercício #' + (n + 1);
}

// ============ PER-SET TABLE ============
let setCounter = 0;

function initSetsTable() {
  setCounter = 0;
  const tbody = document.getElementById('setsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  addSet();
  addSet();
  addSet();
}

function addSet() {
  setCounter++;
  const tbody = document.getElementById('setsTableBody');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.className = 'set-row';
  tr.dataset.setId = setCounter;
  tr.innerHTML = `
    <td class="set-num-cell"><span class="set-badge">${setCounter}</span></td>
    <td><input type="number" class="set-input set-load" placeholder="0" min="0" step="0.5"
      oninput="calcVolumeFromSets()" /></td>
    <td><input type="number" class="set-input set-reps" placeholder="0" min="0"
      oninput="calcVolumeFromSets()" /></td>
    <td class="set-vol-cell"><span class="set-vol">—</span></td>
    <td><button class="set-remove" type="button" onclick="removeSet(this)" title="Remover série">✕</button></td>
  `;
  tbody.appendChild(tr);
  // Focus load of new row
  tr.querySelector('.set-load').focus();
  renumberSets();
  calcVolumeFromSets();
}

function removeSet(btn) {
  const row = btn.closest('.set-row');
  const tbody = document.getElementById('setsTableBody');
  if (tbody.querySelectorAll('.set-row').length <= 1) {
    showToast('Mantenha ao menos 1 série.', 'warning');
    return;
  }
  row.remove();
  renumberSets();
  calcVolumeFromSets();
}

function renumberSets() {
  const rows = document.querySelectorAll('#setsTableBody .set-row');
  rows.forEach((row, i) => {
    row.querySelector('.set-badge').textContent = i + 1;
  });
}

function getSetRows() {
  const rows = document.querySelectorAll('#setsTableBody .set-row');
  return Array.from(rows).map(row => ({
    load: parseFloat(row.querySelector('.set-load').value) || 0,
    reps: parseInt(row.querySelector('.set-reps').value) || 0
  }));
}

function calcVolumeFromSets() {
  const sets = getSetRows();
  let total = 0;
  const rows = document.querySelectorAll('#setsTableBody .set-row');
  rows.forEach((row, i) => {
    const s = sets[i];
    const vol = s.load * s.reps;
    total += vol;
    row.querySelector('.set-vol').textContent = vol > 0 ? vol.toLocaleString('pt-BR') : '—';
  });
  const el = document.getElementById('volumeValue');
  el.textContent = total > 0 ? total.toLocaleString('pt-BR') + ' kg' : '— kg';
  if (total > 0) {
    el.classList.add('record-pop');
    setTimeout(() => el.classList.remove('record-pop'), 400);
  }
  // Live insights update
  const name = document.getElementById('exerciseName').value.trim();
  if (name.length >= 2) checkInsights();
}

// Keep calcVolume as alias for backward compat
function calcVolume() { calcVolumeFromSets(); }

// ============ EXERCISE FORM ============
function clearForm() {
  document.getElementById('exerciseName').value = '';
  document.getElementById('notesInput').value = '';
  document.getElementById('volumeValue').textContent = '— kg';
  document.getElementById('insightBanner').style.display = 'none';
  closeAutocomplete();
  initSetsTable();
}

function saveAndNext() {
  const name = document.getElementById('exerciseName').value.trim();
  const notes = document.getElementById('notesInput').value.trim();
  const setsData = getSetRows();

  if (!name) { showToast('Informe o nome do exercício.', 'warning'); document.getElementById('exerciseName').focus(); return; }

  const validSets = setsData.filter(s => s.reps > 0);
  if (validSets.length === 0) {
    showToast('Preencha ao menos 1 série com repetições.', 'warning');
    return;
  }

  const volume = validSets.reduce((sum, s) => sum + s.load * s.reps, 0);
  const maxLoad = Math.max(...validSets.map(s => s.load));
  const totalReps = validSets.reduce((sum, s) => sum + s.reps, 0);

  const entry = {
    id: 'entry_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    date: new Date().toLocaleDateString('pt-BR'),
    sessionId: state.session.id,
    exercise: name,
    sets: validSets,
    setsCount: validSets.length,
    maxLoad,
    totalReps,
    volume,
    notes,
    location: currentLocation ? { name: currentLocation.name, mapsUrl: currentLocation.mapsUrl } : null,
    timestamp: Date.now()
  };

  state.entries.push(entry);
  state.session.entries.push(entry);
  saveData();
  syncToSheets(entry);
  renderCurrentSessionItem(entry);
  updateSessionCount();
  clearForm();
  document.getElementById('exerciseName').focus();
  showToast(`"${name}" salvo!`, 'success');
}

function renderCurrentSessionItem(entry) {
  const list = document.getElementById('currentSessionList');
  const idx = state.session.entries.length;
  const div = document.createElement('div');
  div.className = 'session-exercise-item';
  div.id = 'sei_' + entry.id;

  // Build sets summary
  const setsArr = entry.sets || [{ load: entry.load || 0, reps: entry.reps || 0 }];
  const setsSummary = setsArr.map((s, i) =>
    `<span class="sei-set-chip">${i + 1}: ${s.load}kg×${s.reps}</span>`
  ).join('');

  div.innerHTML = `
    <div class="sei-num">${idx}</div>
    <div class="sei-info">
      <div class="sei-name">${escHtml(entry.exercise)}</div>
      <div class="sei-sets-row">${setsSummary}</div>
      ${entry.notes ? `<div class="sei-details" style="font-style:italic;">${escHtml(entry.notes)}</div>` : ''}
    </div>
    <div>
      <div class="sei-volume">${entry.volume.toLocaleString('pt-BR')}</div>
      <div class="sei-volume-label">vol (kg)</div>
    </div>
    <button class="sei-delete" onclick="deleteCurrentEntry('${entry.id}')" title="Remover">✕</button>
  `;
  list.appendChild(div);
}

function deleteCurrentEntry(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  state.session.entries = state.session.entries.filter(e => e.id !== id);
  saveData();
  const el = document.getElementById('sei_' + id);
  if (el) el.remove();
  updateSessionCount();
  showToast('Exercício removido.', 'info');
}

// ============ AUTOCOMPLETE ============
function onExerciseInput() {
  const val = document.getElementById('exerciseName').value.trim();
  if (val.length < 2) { closeAutocomplete(); return; }

  const query = val.toLowerCase();
  const unique = getUniqueExercises();
  const matches = unique.filter(ex => ex.toLowerCase().includes(query));

  if (matches.length === 0) { closeAutocomplete(); return; }

  const dropdown = document.getElementById('autocompleteDropdown');
  dropdown.innerHTML = '';
  state.autocompleteIndex = -1;

  matches.slice(0, 8).forEach((ex, i) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.idx = i;
    item.innerHTML = highlightMatch(ex, val);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectAutocomplete(ex);
    });
    dropdown.appendChild(item);
  });

  dropdown.classList.add('open');
}

function onExerciseBlur() {
  setTimeout(() => {
    closeAutocomplete();
    checkInsights();
  }, 200);
}

document.addEventListener('keydown', (e) => {
  const dropdown = document.getElementById('autocompleteDropdown');
  if (!dropdown || !dropdown.classList.contains('open')) return;
  const items = dropdown.querySelectorAll('.autocomplete-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.autocompleteIndex = Math.min(state.autocompleteIndex + 1, items.length - 1);
    updateAutocompleteSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.autocompleteIndex = Math.max(state.autocompleteIndex - 1, -1);
    updateAutocompleteSelection(items);
  } else if (e.key === 'Enter' && state.autocompleteIndex >= 0) {
    e.preventDefault();
    selectAutocomplete(items[state.autocompleteIndex].textContent);
  } else if (e.key === 'Escape') {
    closeAutocomplete();
  }
});

function updateAutocompleteSelection(items) {
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === state.autocompleteIndex);
  });
}

function selectAutocomplete(name) {
  document.getElementById('exerciseName').value = name;
  closeAutocomplete();
  checkInsights();
  document.getElementById('loadInput').focus();
}

function closeAutocomplete() {
  const dropdown = document.getElementById('autocompleteDropdown');
  if (dropdown) dropdown.classList.remove('open');
  state.autocompleteIndex = -1;
}

function getUniqueExercises() {
  const set = new Set(state.entries.map(e => e.exercise));
  return Array.from(set).sort();
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escHtml(text);
  return escHtml(text.slice(0, idx)) +
    '<mark>' + escHtml(text.slice(idx, idx + query.length)) + '</mark>' +
    escHtml(text.slice(idx + query.length));
}

// ============ INSIGHTS ENGINE ============
function checkInsights() {
  const name = document.getElementById('exerciseName').value.trim();
  if (!name) return;

  const history = state.entries
    .filter(e => e.exercise.toLowerCase() === name.toLowerCase() && !state.session.entries.find(s => s.id === e.id))
    .sort((a, b) => b.timestamp - a.timestamp);

  if (history.length === 0) {
    showInsight([{ icon: '🆕', text: `Primeiro registro de "${name}". Boa sorte!` }], 'info');
    return;
  }

  const last = history[0];
  const lastMaxLoad = last.maxLoad !== undefined ? last.maxLoad : (last.load || 0);
  const lastTotalReps = last.totalReps !== undefined ? last.totalReps : (last.reps || 0);
  const insights = [];

  // Current values from the per-set table
  const currentSets = getSetRows().filter(s => s.reps > 0);
  const currentMaxLoad = currentSets.length > 0 ? Math.max(...currentSets.map(s => s.load)) : 0;
  const currentTotalReps = currentSets.reduce((sum, s) => sum + s.reps, 0);

  if (currentMaxLoad > 0 && currentMaxLoad > lastMaxLoad) {
    insights.push({ icon: '🏆', text: `Novo recorde de carga! ${lastMaxLoad}kg → ${currentMaxLoad}kg (+${(currentMaxLoad - lastMaxLoad).toFixed(1)}kg)` });
  }
  if (currentTotalReps > 0 && currentTotalReps < lastTotalReps) {
    const diff = lastTotalReps - currentTotalReps;
    insights.push({ icon: '⚠️', text: `Atenção: Você caiu ${diff} repetição${diff > 1 ? 'ões' : ''} no total em relação ao treino passado (${lastTotalReps} → ${currentTotalReps} reps).` });
  }

  if (insights.length === 0) {
    // Show last session as reference
    const lastSetsArr = last.sets || [{ load: last.load || 0, reps: last.reps || 0 }];
    const lastSummary = lastSetsArr.map((s, i) => `S${i + 1}: ${s.load}kg×${s.reps}`).join(' | ');
    showInsight([{ icon: '📊', text: `Último treino: ${lastSummary} | Vol: ${last.volume.toLocaleString('pt-BR')}kg` }], 'info');
  } else {
    const hasRecord = insights.some(i => i.icon === '🏆');
    const hasWarning = insights.some(i => i.icon === '⚠️');
    const bannerType = hasRecord && !hasWarning ? 'record' : hasWarning ? 'warning' : 'info';
    showInsight(insights, bannerType);
  }
}

function showInsight(items, type) {
  const banner = document.getElementById('insightBanner');
  banner.className = 'insight-banner ' + type;
  banner.innerHTML = items.map(i => `<div class="insight-item"><span>${i.icon}</span><span>${escHtml(i.text)}</span></div>`).join('');
  banner.style.display = 'flex';

  // Fire native notification for records and warnings
  if (type === 'record') {
    const msg = items.find(i => i.icon === '🏆');
    if (msg) sendNotification('🏆 Novo Recorde! — TrainTrack', msg.text);
  } else if (type === 'warning') {
    const msg = items.find(i => i.icon === '⚠️');
    if (msg) sendNotification('⚠️ Atenção — TrainTrack', msg.text);
  }
}

// ============ INSIGHTS ENGINE ============
// (checkInsights is defined above, this block removed to avoid duplicate)


// ============ HISTÓRICO ============
function renderHistorico() {
  const container = document.getElementById('historicoList');
  if (!container) return;

  if (state.entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>Nenhum treino registrado ainda.</p></div>`;
    return;
  }

  // Group by sessionId
  const sessions = {};
  state.entries.forEach(e => {
    if (!sessions[e.sessionId]) sessions[e.sessionId] = { date: e.date, entries: [], totalVolume: 0 };
    sessions[e.sessionId].entries.push(e);
    sessions[e.sessionId].totalVolume += e.volume;
  });

  // Sort sessions by most recent first
  const sorted = Object.entries(sessions).sort((a, b) => {
    const aTime = Math.max(...a[1].entries.map(e => e.timestamp || 0));
    const bTime = Math.max(...b[1].entries.map(e => e.timestamp || 0));
    return bTime - aTime;
  });

  container.innerHTML = sorted.map(([sid, sess]) => `
    <div class="historico-session" id="hs_${sid}">
      <div class="historico-session-header" onclick="toggleSession('${sid}')">
        <span class="hs-date">${escHtml(sess.date)}</span>
        <div class="hs-meta">
          <span class="hs-count">${sess.entries.length} exercício${sess.entries.length !== 1 ? 's' : ''}</span>
          <span class="hs-volume">${sess.totalVolume.toLocaleString('pt-BR')} kg vol</span>
          <span class="hs-chevron">▼</span>
        </div>
      </div>
      <div class="historico-session-body">
        ${sess.entries.map(e => {
    const setsArr = e.sets || [{ load: e.load || 0, reps: e.reps || 0 }];
    const setsHtml = setsArr.map((s, i) =>
      `<span class="hist-set-chip">S${i + 1}: ${s.load}kg×${s.reps}</span>`
    ).join('');
    return `
          <div class="historico-exercise-row" id="her_${e.id}">
            <div class="her-main">
              <span class="her-name">${escHtml(e.exercise)}</span>
              <div class="her-sets-row">${setsHtml}</div>
            </div>
            <span class="her-volume">${e.volume.toLocaleString('pt-BR')} kg</span>
            <button class="her-delete" onclick="deleteEntry('${e.id}')" title="Remover">✕</button>
          </div>`;
  }).join('')}
      </div>
    </div>
  `).join('');
}

function toggleSession(sid) {
  const el = document.getElementById('hs_' + sid);
  if (el) el.classList.toggle('open');
}

function deleteEntry(id) {
  if (!confirm('Remover este exercício do histórico?')) return;
  state.entries = state.entries.filter(e => e.id !== id);
  saveData();
  renderHistorico();
  populateChartExerciseSelect();
  showToast('Exercício removido do histórico.', 'info');
}

// ============ PERFORMANCE / CHART ============
function populateChartExerciseSelect() {
  const sel = document.getElementById('chartExerciseSelect');
  if (!sel) return;
  const current = sel.value;
  const exercises = getUniqueExercises();
  sel.innerHTML = '<option value="">— Escolha um exercício —</option>' +
    exercises.map(ex => `<option value="${escHtml(ex)}" ${ex === current ? 'selected' : ''}>${escHtml(ex)}</option>`).join('');
  if (current && exercises.includes(current)) renderChart();
}

function setChartMode(mode) {
  state.chartMode = mode;
  document.getElementById('toggleLoad').classList.toggle('active', mode === 'load');
  document.getElementById('toggleVolume').classList.toggle('active', mode === 'volume');
  renderChart();
}

function renderChart() {
  const exercise = document.getElementById('chartExerciseSelect').value;
  const chartCard = document.getElementById('chartCard');
  const chartEmpty = document.getElementById('chartEmpty');

  if (!exercise) {
    chartCard.style.display = 'none';
    chartEmpty.style.display = 'block';
    return;
  }

  const data = state.entries
    .filter(e => e.exercise.toLowerCase() === exercise.toLowerCase())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Aggregate by date — max load across all sets, sum volume
  const byDate = {};
  data.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = { load: 0, volume: 0 };
    // Support both old schema (e.load) and new schema (e.sets)
    const entryMaxLoad = e.maxLoad !== undefined ? e.maxLoad : (e.load || 0);
    byDate[e.date].load = Math.max(byDate[e.date].load, entryMaxLoad);
    byDate[e.date].volume += e.volume;
  });

  const dates = Object.keys(byDate);
  const values = dates.map(d => state.chartMode === 'load' ? byDate[d].load : byDate[d].volume);

  if (dates.length === 0) {
    chartCard.style.display = 'none';
    chartEmpty.style.display = 'block';
    return;
  }

  chartCard.style.display = 'block';
  chartEmpty.style.display = 'none';

  const ctx = document.getElementById('performanceChart').getContext('2d');
  if (state.chartInstance) state.chartInstance.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(99,102,241,0.4)');
  gradient.addColorStop(1, 'rgba(99,102,241,0.0)');

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: state.chartMode === 'load' ? 'Carga Máx (kg)' : 'Volume Total (kg)',
        data: values,
        borderColor: '#6366f1',
        backgroundColor: gradient,
        borderWidth: 2.5,
        pointBackgroundColor: '#818cf8',
        pointBorderColor: '#1a1a24',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a24',
          borderColor: 'rgba(255,255,255,0.07)',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toLocaleString('pt-BR')} kg`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#475569', font: { family: 'Inter', size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, callback: v => v + ' kg' },
          beginAtZero: false
        }
      }
    }
  });

  // Stats
  const max = Math.max(...values);
  const min = Math.min(...values);
  const last = values[values.length - 1];
  const first = values[0];
  const delta = last - first;
  const deltaSign = delta >= 0 ? '+' : '';

  document.getElementById('chartStats').innerHTML = `
    <div class="stat-chip">
      <div class="stat-chip-label">Máximo</div>
      <div class="stat-chip-value">${max.toLocaleString('pt-BR')} kg</div>
    </div>
    <div class="stat-chip">
      <div class="stat-chip-label">Último</div>
      <div class="stat-chip-value">${last.toLocaleString('pt-BR')} kg</div>
    </div>
    <div class="stat-chip">
      <div class="stat-chip-label">Sessões</div>
      <div class="stat-chip-value">${dates.length}</div>
    </div>
    <div class="stat-chip">
      <div class="stat-chip-label">Evolução</div>
      <div class="stat-chip-value ${delta >= 0 ? 'positive' : 'negative'}">${deltaSign}${delta.toLocaleString('pt-BR')} kg</div>
    </div>
  `;
}

// ============ EXPORT CSV ============
function exportCSV() {
  if (state.entries.length === 0) { showToast('Nenhum dado para exportar.', 'warning'); return; }
  const rows = [];
  rows.push(['ID', 'Data', 'Sessão', 'Exercício', 'Série', 'Carga (kg)', 'Reps', 'Volume Série', 'Volume Total', 'Notas'].join(','));
  state.entries.forEach(e => {
    const setsArr = e.sets || [{ load: e.load || 0, reps: e.reps || 0 }];
    setsArr.forEach((s, i) => {
      rows.push([
        e.id, e.date, e.sessionId, e.exercise,
        i + 1, s.load, s.reps, s.load * s.reps,
        i === 0 ? e.volume : '', // volume total only on first row
        i === 0 ? (e.notes || '') : ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    });
  });
  const csv = rows.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `traintrack_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado com sucesso!', 'success');
}

// ============ CLEAR ALL DATA ============
function clearAllData() {
  if (!confirm('Tem certeza? Todos os dados serão apagados permanentemente.')) return;
  if (!confirm('Confirmação final: apagar TODOS os dados?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.entries = [];
  state.session = { active: false, id: null, date: null, entries: [] };
  renderHistorico();
  populateChartExerciseSelect();
  if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
  document.getElementById('chartCard').style.display = 'none';
  document.getElementById('chartEmpty').style.display = 'block';
  showToast('Todos os dados foram apagados.', 'warning');
}

// ============ APPS SCRIPT CODE ============
function renderAppsScriptCode() {
  const pre = document.getElementById('appsScriptPre');
  if (pre) pre.textContent = APPS_SCRIPT_CODE;
}

function copyAppsScript() {
  navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
    showToast('Código copiado!', 'success');
  }).catch(() => {
    showToast('Não foi possível copiar automaticamente.', 'warning');
  });
}

// ============ GEOLOCATION ============
let currentLocation = null; // { lat, lng, name, mapsUrl }

function saveLocationPref() {
  const enabled = document.getElementById('locationToggle').checked;
  localStorage.setItem('traintrack_location_enabled', enabled ? '1' : '0');
}

function isLocationEnabled() {
  const val = localStorage.getItem('traintrack_location_enabled');
  return val === null ? true : val === '1';
}

function detectLocation() {
  if (!isLocationEnabled()) return;
  if (!navigator.geolocation) {
    showToast('Geolocalização não suportada neste dispositivo.', 'warning');
    return;
  }

  const bar = document.getElementById('locationBar');
  const nameEl = document.getElementById('locationName');
  const linkEl = document.getElementById('locationMapLink');

  bar.style.display = 'flex';
  nameEl.textContent = 'Detectando local...';
  linkEl.style.display = 'none';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      linkEl.href = mapsUrl;
      linkEl.style.display = 'inline';

      // Reverse geocode via Nominatim (free, no API key)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } }
        );
        const data = await res.json();
        const addr = data.address || {};
        // Build a human-readable location name
        const parts = [
          addr.amenity || addr.shop || addr.leisure || addr.building,
          addr.road || addr.pedestrian,
          addr.suburb || addr.neighbourhood || addr.city_district,
          addr.city || addr.town || addr.village
        ].filter(Boolean);
        const locationName = parts.slice(0, 3).join(', ') || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        nameEl.textContent = locationName;
        currentLocation = { lat, lng, name: locationName, mapsUrl };
        state.session.location = currentLocation;
      } catch {
        const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        nameEl.textContent = fallback;
        currentLocation = { lat, lng, name: fallback, mapsUrl };
        state.session.location = currentLocation;
      }
    },
    (err) => {
      bar.style.display = 'none';
      const msgs = {
        1: 'Permissão de localização negada.',
        2: 'Localização indisponível.',
        3: 'Tempo esgotado ao obter localização.'
      };
      showToast(msgs[err.code] || 'Erro ao obter localização.', 'warning');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// ============ NOTIFICATIONS API ============
function initNotifStatus() {
  const btn = document.getElementById('notifBtn');
  const status = document.getElementById('notifStatus');
  if (!('Notification' in window)) {
    if (status) status.textContent = '⚠ Notificações não suportadas neste navegador.';
    if (btn) btn.style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted') {
    if (status) { status.textContent = '✓ Notificações ativadas!'; status.className = 'config-msg success'; }
    if (btn) btn.style.display = 'none';
  } else if (Notification.permission === 'denied') {
    if (status) { status.textContent = '✗ Notificações bloqueadas. Habilite nas configurações do navegador.'; status.className = 'config-msg error'; }
    if (btn) btn.style.display = 'none';
  }
}

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('Notificações não suportadas neste navegador.', 'warning');
    return;
  }
  const permission = await Notification.requestPermission();
  initNotifStatus();
  if (permission === 'granted') {
    showToast('Notificações ativadas!', 'success');
    // Send a test notification
    sendNotification('TrainTrack 💪', 'Notificações ativadas! Você será avisado sobre recordes e regressões.');
  } else {
    showToast('Permissão de notificação negada.', 'warning');
  }
}

function sendNotification(title, body, icon = '💪') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    // Use service worker notification if available (shows in notification bar even with app minimized)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: './icon-192.png',
          badge: './icon-192.png',
          vibrate: [200, 100, 200],
          tag: 'traintrack-insight',
          renotify: true
        });
      });
    } else {
      new Notification(title, { body, icon: './icon-192.png' });
    }
  } catch { /* silent fail */ }
}

// ============ TOAST NOTIFICATIONS ============

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============ UTILITIES ============
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
