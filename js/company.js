// js/company.js
import { auth, db } from './firebase.js';
import { ref, set, get, update, push, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { MIN_WAGE, ROBOT_PRICES, WORK_STYLES, allCompanies, allUsers } from './app.js';

let currentCompanyId = null;
let miningActive = false;
let miningInterval = null;
let selectedTool = null;
let layoutGridSize = 16;

// ===== 회사 열기 =====
window.openCompany = (cid) => {
  currentCompanyId = cid;
  const company = allCompanies[cid];
  if (!company) return;
  const uid = auth.currentUser?.uid;
  const isBoss = company.bossUid === uid;

  document.getElementById('comp-name').textContent = company.name;
  document.getElementById('comp-role-badge').innerHTML =
    isBoss ? '<span class="badge badge-yellow">👑 사장</span>' : '<span class="badge badge-blue">👷 직원</span>';

  // 일하는 방식에 따라 UI 결정
  const workStyle = company.workStyle || 1;
  let myRole = null;

  if (workStyle === 1) myRole = 'mining';
  else if (workStyle === 2) myRole = 'sales';
  else if (workStyle === 3) myRole = 'production';
  else if (workStyle === 4) myRole = isBoss ? 'sales' : 'mining';
  else if (workStyle === 5) myRole = isBoss ? 'mining' : 'sales';
  else if (workStyle === 6) myRole = isBoss ? 'mining' : 'production';

  // 모든 work-ui 숨기기
  document.querySelectorAll('.work-ui').forEach(el => el.style.display = 'none');
  if (myRole) document.getElementById('work-' + myRole).style.display = 'block';

  // 사장 패널
  const bossPanel = document.getElementById('boss-panel');
  bossPanel.style.display = isBoss ? 'block' : 'none';
  if (isBoss) {
    renderBossOverview(company);
    renderEmployeeList(company);
    renderApplicationList(company);
    renderRobotList(company);
    initLayout(company);
  }

  // 각 역할 UI 초기화
  if (myRole === 'mining') initMiningUI(company);
  if (myRole === 'sales') initSalesUI(company);
  if (myRole === 'production') initProductionUI(company);

  showPage('company');
};

// ===== 채굴 =====
function initMiningUI(company) {
  updateMiningStats(company);
}

function updateMiningStats(company) {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  document.getElementById('m-coin-price').textContent = '₩' + (company.coinPrice || 100).toLocaleString();
  document.getElementById('m-my-cash').textContent = '₩' + (user?.cash || 0).toLocaleString();
  document.getElementById('m-my-coins').textContent = (user?.[`holdings_${currentCompanyId}`] || 0).toLocaleString();

  const robotCount = getRobotCount(company, 'mining');
  const baseRate = miningActive ? (1 + robotCount * 2) : 0;
  document.getElementById('m-rate').textContent = baseRate + '/분';
}

window.toggleMining = async () => {
  miningActive = !miningActive;
  const btn = document.getElementById('mining-btn');
  const status = document.getElementById('mining-status');
  if (miningActive) {
    btn.classList.add('active');
    document.getElementById('mining-btn-text').textContent = '⚡ 채굴 중';
    status.textContent = '채굴 진행중...';
    startMining();
  } else {
    btn.classList.remove('active');
    document.getElementById('mining-btn-text').textContent = '⚡ 채굴 시작';
    status.textContent = '대기중';
    if (miningInterval) clearInterval(miningInterval);
  }
};

function startMining() {
  if (miningInterval) clearInterval(miningInterval);
  miningInterval = setInterval(async () => {
    if (!miningActive || !currentCompanyId) return;
    const company = allCompanies[currentCompanyId];
    if (!company) return;
    const uid = auth.currentUser?.uid;
    const user = allUsers[uid];
    const robotCount = getRobotCount(company, 'mining');
    const mineAmount = 1 + robotCount;

    // 코인 추가
    await update(ref(db, `users/${uid}`), {
      [`holdings_${currentCompanyId}`]: (user?.[`holdings_${currentCompanyId}`] || 0) + mineAmount
    });
    await update(ref(db, `companies/${currentCompanyId}`), {
      totalMined: (company.totalMined || 0) + mineAmount,
      holdings: (company.holdings || 0) + mineAmount
    });
    updateMiningStats(allCompanies[currentCompanyId]);
  }, 5000);
}

// ===== 판매 =====
function initSalesUI(company) {
  renderSalesInventory(company);
  document.getElementById('s-coin-price').textContent = '₩' + (company.coinPrice || 100).toLocaleString();
  const profitRate = company.totalSales > 0 ? ((company.totalRevenue / (company.totalSales * 100)) * 100).toFixed(1) : '0';
  document.getElementById('s-profit-rate').textContent = profitRate + '%';
  document.getElementById('s-today-sales').textContent = company.todaySales || 0;
}

function renderSalesInventory(company) {
  const inv = document.getElementById('sales-inventory');
  const orders = document.getElementById('sales-orders');
  if (!inv) return;
  const stock = company.stock || {};
  if (Object.keys(stock).length === 0) {
    inv.innerHTML = '<div class="text-sm">재고 없음</div>';
    orders.innerHTML = '<div class="text-sm">주문 내역 없음</div>';
    return;
  }
  inv.innerHTML = Object.entries(stock).map(([item, qty]) => `
    <div class="inv-item">
      <div><div class="inv-name">${item}</div><div class="inv-qty">x${qty}</div></div>
      <button class="btn btn-sm" onclick="sellItem('${currentCompanyId}', '${item}')">판매</button>
    </div>`).join('');

  const lowStock = Object.entries(stock).filter(([k, v]) => v < 10);
  orders.innerHTML = lowStock.length === 0
    ? '<div class="text-sm">재고 충분</div>'
    : lowStock.map(([item, qty]) => `<div class="inv-item"><div><div class="inv-name">${item}</div><div class="inv-qty" style="color:var(--red)">재고 부족 (${qty})</div></div></div>`).join('');
}

window.sellItem = async (cid, itemName) => {
  const company = allCompanies[cid];
  if (!company || company.haltSales) { showToast('❌ 현재 판매 불가 상태!'); return; }
  const stock = { ...(company.stock || {}) };
  if (!stock[itemName] || stock[itemName] <= 0) { showToast('재고 없음!'); return; }
  const price = company.coinPrice || 100;
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const revenue = Math.floor(price * 1.1);

  stock[itemName]--;
  await update(ref(db, `companies/${cid}`), {
    stock,
    totalSales: (company.totalSales || 0) + 1,
    totalRevenue: (company.totalRevenue || 0) + revenue,
    todaySales: (company.todaySales || 0) + 1
  });
  await update(ref(db, `users/${company.bossUid}`), {
    cash: ((allUsers[company.bossUid]?.cash) || 0) + revenue
  });
  showToast(`🛒 ${itemName} 판매! +₩${revenue.toLocaleString()}`);
  initSalesUI(allCompanies[cid]);
};

window.orderStock = () => {
  const company = allCompanies[currentCompanyId];
  if (!company) return;
  showModal('📦 재고 주문', `
    <div class="form-group"><label>물건 이름</label><input type="text" id="order-item-name" placeholder="예: 다용도 배터리"></div>
    <div class="form-group"><label>수량</label><input type="number" id="order-qty" value="50" min="1"></div>
    <div class="form-group"><label>비용 (개당 ₩1,000)</label><div class="stat-val yellow">₩<span id="order-cost">50,000</span></div></div>
  `, [
    { text: '주문', cls: 'btn', action: async () => {
      const name = document.getElementById('order-item-name').value.trim();
      const qty = parseInt(document.getElementById('order-qty').value);
      const cost = qty * 1000;
      const uid = auth.currentUser?.uid;
      const user = allUsers[uid];
      if (!name) { showToast('이름 입력 필요'); return; }
      if ((user?.cash || 0) < cost) { showToast('💸 잔고 부족!'); return; }
      const stock = { ...(company.stock || {}) };
      stock[name] = (stock[name] || 0) + qty;
      await update(ref(db, `companies/${currentCompanyId}`), { stock });
      await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - cost });
      showToast(`📦 ${name} x${qty} 입고 완료!`);
      closeModal();
      initSalesUI(allCompanies[currentCompanyId]);
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
  document.getElementById('order-qty').oninput = () => {
    const qty = parseInt(document.getElementById('order-qty').value) || 0;
    document.getElementById('order-cost').textContent = (qty * 1000).toLocaleString();
  };
};

// ===== 생산 =====
function initProductionUI(company) {
  document.getElementById('p-coin-price').textContent = '₩' + (company.coinPrice || 100).toLocaleString();
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  document.getElementById('p-cash').textContent = '₩' + (user?.cash || 0).toLocaleString();
  document.getElementById('p-target').textContent = company.productionTarget || 100;
  document.getElementById('p-current').textContent = Object.values(company.stock || {}).reduce((a, b) => a + b, 0);

  const robotCount = getRobotCount(company, 'production');
  document.getElementById('p-speed').textContent = (1 + robotCount) + '/분';

  renderProductionItems(company);
}

function renderProductionItems(company) {
  const el = document.getElementById('prod-items');
  if (!el) return;
  const products = company.products || ['다용도 배터리', '전자부품', '포장재'];
  el.innerHTML = products.map((p, i) => `
    <div class="inv-item">
      <div class="inv-name">${p}</div>
      <span class="badge badge-purple">생산 가능</span>
    </div>`).join('');
}

window.produceItem = async () => {
  const company = allCompanies[currentCompanyId];
  if (!company) return;
  showModal('🏭 생산하기', `
    <div class="form-group"><label>생산할 물건</label>
    <select id="produce-item-select">
      ${(company.products || ['다용도 배터리', '전자부품', '포장재']).map(p => `<option>${p}</option>`).join('')}
      <option value="__custom__">직접 입력</option>
    </select></div>
    <div class="form-group" id="custom-item-wrap" style="display:none"><label>물건 이름</label><input type="text" id="custom-item-name"></div>
    <div class="form-group"><label>수량</label><input type="number" id="produce-qty" value="10" min="1"></div>
    <p class="text-sm">생산 후 B2B 마켓에 등록됩니다.</p>
  `, [
    { text: '생산 시작', cls: 'btn btn-purple', action: async () => {
      let itemName = document.getElementById('produce-item-select').value;
      if (itemName === '__custom__') itemName = document.getElementById('custom-item-name').value.trim();
      const qty = parseInt(document.getElementById('produce-qty').value);
      if (!itemName) { showToast('물건 이름 필요'); return; }

      // B2B 마켓에 등록
      const iid = push(ref(db, 'items')).key;
      await set(ref(db, `items/${iid}`), {
        name: itemName, company: company.name, companyId: currentCompanyId,
        price: (company.coinPrice || 100) * 2, qty, isB2B: true, createdAt: Date.now()
      });

      // 회사 재고에도 추가
      const stock = { ...(company.stock || {}) };
      stock[itemName] = (stock[itemName] || 0) + qty;
      await update(ref(db, `companies/${currentCompanyId}`), { stock });
      showToast(`🏭 ${itemName} x${qty} 생산 완료! B2B 등록됨`);
      closeModal();
      initProductionUI(allCompanies[currentCompanyId]);
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
  document.getElementById('produce-item-select').onchange = (e) => {
    document.getElementById('custom-item-wrap').style.display = e.target.value === '__custom__' ? '' : 'none';
  };
};

// ===== 사장 - 현황 =====
function renderBossOverview(company) {
  document.getElementById('b-coin-price').textContent = '₩' + (company.coinPrice || 100).toLocaleString();
  document.getElementById('b-total-sales').textContent = (company.totalSales || 0).toLocaleString();
  document.getElementById('b-balance').textContent = '₩' + ((allUsers[company.bossUid]?.cash) || 0).toLocaleString();
  document.getElementById('b-employee-count').textContent = Object.keys(company.employees || {}).length + '명';
}

// ===== 사장 - 직원 관리 =====
function renderEmployeeList(company) {
  const list = document.getElementById('employee-list');
  if (!list) return;
  const emps = Object.entries(company.employees || {});
  list.innerHTML = emps.length === 0 ? '<div class="text-sm">직원 없음</div>' : '';
  emps.forEach(([uid, info]) => {
    const user = allUsers[uid];
    list.innerHTML += `
      <div class="emp-item">
        <div><div class="emp-name">${user?.nick || uid}</div><div class="emp-role">직원</div></div>
        <div class="emp-btns">
          <button class="btn btn-red btn-xs" onclick="fireEmployee('${uid}')">해고</button>
        </div>
      </div>`;
  });
}

function renderApplicationList(company) {
  const list = document.getElementById('application-list');
  if (!list) return;
  const apps = Object.entries(company.applications || {}).filter(([k, v]) => v === 'pending');
  list.innerHTML = apps.length === 0 ? '<div class="text-sm">지원자 없음</div>' : '';
  apps.forEach(([uid, status]) => {
    const user = allUsers[uid];
    list.innerHTML += `
      <div class="app-item">
        <div><div class="emp-name">${user?.nick || uid}</div></div>
        <div class="app-btns">
          <button class="btn btn-sm" onclick="acceptEmployee('${uid}')">수락</button>
          <button class="btn btn-outline btn-sm" onclick="holdEmployee('${uid}')">보류</button>
          <button class="btn btn-red btn-sm" onclick="rejectEmployee('${uid}')">거절</button>
        </div>
      </div>`;
  });
}

window.acceptEmployee = async (uid) => {
  const company = allCompanies[currentCompanyId];
  const maxEmployees = countEquipment(company);
  if (Object.keys(company.employees || {}).length >= maxEmployees) {
    showToast('⚠️ 장비 수 초과! 먼저 장비를 배치하세요.'); return;
  }
  await update(ref(db, `companies/${currentCompanyId}`), {
    [`employees/${uid}`]: true,
    [`applications/${uid}`]: 'accepted'
  });
  const userCompanies = [...(allUsers[uid]?.companies || []), currentCompanyId];
  await update(ref(db, `users/${uid}`), { companies: userCompanies });
  showToast('✅ 직원 수락 완료!');
  renderEmployeeList(allCompanies[currentCompanyId]);
  renderApplicationList(allCompanies[currentCompanyId]);
};

window.holdEmployee = async (uid) => {
  await update(ref(db, `companies/${currentCompanyId}/applications`), { [uid]: 'hold' });
  showToast('보류 처리됨');
  renderApplicationList(allCompanies[currentCompanyId]);
};

window.rejectEmployee = async (uid) => {
  await update(ref(db, `companies/${currentCompanyId}/applications`), { [uid]: 'rejected' });
  showToast('거절 처리됨');
  renderApplicationList(allCompanies[currentCompanyId]);
};

window.fireEmployee = async (uid) => {
  await remove(ref(db, `companies/${currentCompanyId}/employees/${uid}`));
  const userCompanies = (allUsers[uid]?.companies || []).filter(c => c !== currentCompanyId);
  await update(ref(db, `users/${uid}`), { companies: userCompanies });
  showToast('직원 해고 완료');
  renderEmployeeList(allCompanies[currentCompanyId]);
};

// ===== 사장 탭 전환 =====
window.switchBossTab = (tab) => {
  ['overview', 'employees', 'layout', 'robots', 'settings'].forEach(t => {
    document.getElementById('boss-' + t).style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#boss-panel .tab').forEach((t, i) => {
    t.classList.toggle('active', ['overview','employees','layout','robots','settings'][i] === tab);
  });
  const company = allCompanies[currentCompanyId];
  if (!company) return;
  if (tab === 'overview') renderBossOverview(company);
  if (tab === 'employees') { renderEmployeeList(company); renderApplicationList(company); }
  if (tab === 'robots') renderRobotList(company);
};

// ===== 배치 그리드 =====
function initLayout(company) {
  const grid = document.getElementById('layout-grid');
  if (!grid) return;
  const size = company.gridSize || 16;
  layoutGridSize = size;
  grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  grid.innerHTML = '';
  const layout = company.layout || {};
  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement('div');
    cell.className = 'layout-cell';
    cell.dataset.index = i;
    const item = layout[i];
    if (item) {
      cell.textContent = getItemEmoji(item);
      cell.classList.add('filled', `item-${getItemCategory(item)}`);
    }
    cell.onclick = () => handleCellClick(i, cell, company);
    grid.appendChild(cell);
  }
}

function getItemEmoji(item) {
  const map = { 'mining-pc': '💻', 'mining-body': '🖥️', 'shelf': '📦', 'desk': '🪑', 'counter': '🏪', 'container': '📫', 'table': '🪵', 'car': '🚗' };
  return map[item] || '?';
}

function getItemCategory(item) {
  if (['mining-pc', 'mining-body'].includes(item)) return 'mining';
  if (['shelf', 'desk', 'counter'].includes(item)) return 'sales';
  if (['container', 'table', 'car'].includes(item)) return 'production';
  return 'misc';
}

window.selectTool = (tool) => {
  selectedTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
};

async function handleCellClick(index, cell, company) {
  if (!selectedTool) { showToast('먼저 도구를 선택하세요'); return; }
  const layout = { ...(company.layout || {}) };
  if (selectedTool === 'delete') {
    delete layout[index];
    cell.textContent = '';
    cell.className = 'layout-cell';
  } else {
    layout[index] = selectedTool;
    cell.textContent = getItemEmoji(selectedTool);
    cell.className = `layout-cell filled item-${getItemCategory(selectedTool)}`;
  }
  await update(ref(db, `companies/${currentCompanyId}`), { layout });
}

function countEquipment(company) {
  const layout = company.layout || {};
  const items = Object.values(layout);
  const miningPairs = Math.min(items.filter(i => i === 'mining-pc').length, items.filter(i => i === 'mining-body').length);
  const salesItems = items.filter(i => ['shelf','desk','counter'].includes(i)).length;
  const prodItems = items.filter(i => ['container','table'].includes(i)).length;
  return miningPairs + salesItems + prodItems;
}

window.expandLayout = async () => {
  const company = allCompanies[currentCompanyId];
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const cost = 50000000;
  if ((user?.cash || 0) < cost) { showToast('💸 잔고 부족! ₩5천만 필요'); return; }
  const newSize = (company.gridSize || 16) + 4;
  await update(ref(db, `companies/${currentCompanyId}`), { gridSize: newSize });
  await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - cost });
  showToast(`✅ 부지 확장! ${newSize}x${newSize}`);
  initLayout(allCompanies[currentCompanyId]);
};

// ===== 로봇 =====
function renderRobotList(company) {
  const list = document.getElementById('my-robots-list');
  if (!list) return;
  const robots = company.robots || {};
  if (!Object.keys(robots).length) { list.innerHTML = '<div class="text-sm">보유 로봇 없음</div>'; return; }
  list.innerHTML = Object.entries(robots).map(([type, tiers]) =>
    Object.entries(tiers).map(([tier, count]) =>
      `<div class="inv-item"><div><div class="inv-name">${type} 로봇 ${tier}티어</div><div class="inv-qty">x${count}</div></div></div>`
    ).join('')
  ).join('');
}

window.buyRobot = async (type, tier) => {
  const company = allCompanies[currentCompanyId];
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const price = ROBOT_PRICES[tier].buy;
  if ((user?.cash || 0) < price) { showToast(`💸 잔고 부족! ₩${price.toLocaleString()} 필요`); return; }
  await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - price });
  const currentCount = company.robots?.[type]?.[tier] || 0;
  await update(ref(db, `companies/${currentCompanyId}/robots/${type}`), { [tier]: currentCount + 1 });
  showToast(`🤖 ${type} 로봇 ${tier}티어 구매 완료!`);
  renderRobotList(allCompanies[currentCompanyId]);
};

function getRobotCount(company, type) {
  const robots = company.robots?.[type] || {};
  return Object.values(robots).reduce((a, b) => a + b, 0);
}

// ===== 홍보 =====
window.doPromotion = async () => {
  const company = allCompanies[currentCompanyId];
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const cost = 100000000;
  if ((user?.cash || 0) < cost) { showToast('💸 잔고 부족! ₩1억 필요'); return; }
  await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - cost });
  const pid = push(ref(db, 'promos')).key;
  await set(ref(db, `promos/${pid}`), {
    companyName: company.name, companyId: currentCompanyId,
    message: `${company.sector} 분야 최고! 지금 방문하세요!`,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24시간
  });
  showToast('📣 홍보 시작! 24시간 동안 홈에 노출됩니다.');
};

// ===== 설정 =====
window.changeWorkStyle = async () => {
  const style = parseInt(document.getElementById('work-style-change').value);
  await update(ref(db, `companies/${currentCompanyId}`), { workStyle: style });
  showToast('✅ 일하는 방식 변경 완료!');
};

window.setSalary = async () => {
  const salary = parseInt(document.getElementById('salary-input').value);
  if (salary < MIN_WAGE) { showToast(`❌ 최저임금(₩${MIN_WAGE.toLocaleString()}) 이상이어야 해요`); return; }
  await update(ref(db, `companies/${currentCompanyId}`), { salary });
  showToast(`✅ 월급 ₩${salary.toLocaleString()}으로 설정!`);
};

window.registerUsedMarket = async () => {
  const company = allCompanies[currentCompanyId];
  await update(ref(db, `companies/${currentCompanyId}`), { isUsedMarket: true });
  showToast('♻️ 중고거래 회사로 등록 완료!');
};

window.showMergerModal = () => {
  const others = Object.entries(allCompanies).filter(([k, v]) => !v.isSystem && k !== currentCompanyId);
  showModal('🤝 인수합병 제안', `
    <select id="merger-target">
      ${others.map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
    </select>
    <p class="text-sm mt8">상대방이 수락해야 합병이 완료됩니다.</p>
  `, [
    { text: '제안 보내기', cls: 'btn', action: async () => {
      const targetId = document.getElementById('merger-target').value;
      const target = allCompanies[targetId];
      const uid = auth.currentUser?.uid;
      const pid = push(ref(db, 'mergerProposals')).key;
      await set(ref(db, `mergerProposals/${pid}`), {
        from: currentCompanyId, fromName: allCompanies[currentCompanyId]?.name,
        to: targetId, toUid: target.bossUid, status: 'pending', createdAt: Date.now()
      });
      showToast(`📤 ${target.name}에 합병 제안 발송!`);
      closeModal();
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
};