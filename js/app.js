// js/app.js
import { auth, db } from './firebase.js';
import { ref, set, get, update, onValue, push, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ===== CONSTANTS =====
export const SECTORS = [
  "🍔 식품/외식", "💻 IT/소프트웨어", "👗 패션/의류", "🏥 의료/제약",
  "🚗 자동차", "🏗️ 건설/부동산", "🎮 게임/엔터", "⚡ 에너지",
  "✈️ 항공/물류", "🌿 농업/식품", "💄 뷰티/화장품", "🎓 교육",
  "🏦 금융/보험", "🛒 유통/이커머스", "🔬 연구/과학", "🎵 음악/미디어",
  "🍺 주류/음료", "🐾 펫/동물", "🌊 해양/수산", "🧪 화학/소재"
];

export const WORK_STYLES = {
  1: "전원 채굴",
  2: "전원 판매",
  3: "전원 생산(B2B)",
  4: "사장 판매 / 직원 채굴",
  5: "사장 채굴 / 직원 재고정리",
  6: "사장 채굴 / 직원 생산"
};

export const ROBOT_PRICES = {
  1: { buy: 15000000, electricity: 3000000, interval: 10000 },
  2: { buy: 35000000, electricity: 4500000, interval: 5000 },
  3: { buy: 90000000, electricity: 5500000, interval: 1000 }
};

export const MIN_WAGE = 2060740; // 2024 최저임금/월 기준

export const EVENTS = [
  { type: "bad", msg: "🧹 위생조사! {target}에 위생 불합격!", effect: "sales_halt" },
  { type: "bad", msg: "📋 세무조사! {target} 잔고 20% 감소!", effect: "tax" },
  { type: "bad", msg: "💥 제품 리콜! {target} 코인 15% 하락!", effect: "recall" },
  { type: "good", msg: "🌟 {target} 대박 계약 체결!", effect: "boom" },
  { type: "good", msg: "📰 {target} 언론 주목! 코인 20% 급등!", effect: "press" },
  { type: "bad", msg: "🔥 {target} 비리 폭로! 코인 30% 폭락!", effect: "scandal" },
  { type: "warning", msg: "🌪️ 원자재 파동! {target} 분야 타격", effect: "sector_crisis" },
  { type: "good", msg: "🏆 {target} 수출 대박! 폭등!", effect: "export" },
  { type: "warning", msg: "📬 전기세 통지서 발송!", effect: "electricity_bill" },
];

// ===== STATE =====
export let allCompanies = {};
export let allUsers = {};
export let allPatents = {};
export let allContracts = {};
export let allLawsuits = {};
export let allItems = {}; // 마트 상품
export let usedMarket = {};
export let gameDay = 1;
export let currentCompanyId = null;
export let miningActive = false;
export let miningInterval = null;
export let selectedTool = null;
export let layoutData = {};
export let promos = []; // 현재 홍보 중인 회사들

// ===== INIT =====
window.initApp = () => {
  renderSectorGrid();
  subscribeAll();
  startGameLoop();
  showPage('home');
  updateTopbar();
};

function subscribeAll() {
  onValue(ref(db, 'companies'), snap => {
    allCompanies = snap.val() || {};
    renderHome();
    renderJobs();
    renderLeaderboard('cash');
    renderMarketShop();
    renderExchange();
    updateTicker();
  });
  onValue(ref(db, 'users'), snap => { allUsers = snap.val() || {}; });
  onValue(ref(db, 'patents'), snap => { allPatents = snap.val() || {}; });
  onValue(ref(db, 'contracts'), snap => { allContracts = snap.val() || {}; });
  onValue(ref(db, 'lawsuits'), snap => { allLawsuits = snap.val() || {}; });
  onValue(ref(db, 'items'), snap => { allItems = snap.val() || {}; renderMarketShop(); });
  onValue(ref(db, 'usedMarket'), snap => { usedMarket = snap.val() || {}; renderUsedMarket(); });
  onValue(ref(db, 'promos'), snap => { promos = snap.val() ? Object.values(snap.val()) : []; renderPromos(); });
}

// ===== GAME LOOP =====
function startGameLoop() {
  setInterval(async () => {
    gameDay++;
    document.getElementById('topbar-date').textContent = `Day ${gameDay} (Year ${Math.ceil(gameDay / 365)})`;

    // 실업자 지원금 (30일마다)
    if (gameDay % 30 === 0) {
      const uid = auth.currentUser?.uid;
      const user = allUsers[uid];
      if (user && (!user.companies || user.companies.length === 0)) {
        const grant = Math.floor(MIN_WAGE / 2);
        await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) + grant });
        showToast(`💸 실업자 지원금 +₩${grant.toLocaleString()}`);
      }
      // 사장: 직원 월급 지급
      await payAllSalaries();
      // 전기세 청구
      await chargeElectricityBills();
    }

    // 랜덤 이벤트 3일마다
    if (gameDay % 3 === 0) triggerRandomEvent();

    // 코인 가격 업데이트
    await updateAllPrices();

    // 식사 알림
    checkMealStatus();
  }, 60000); // 1분 = 1 게임일

  // 채굴 UI 업데이트
  setInterval(updateMiningUI, 2000);
}

async function payAllSalaries() {
  const companies = Object.entries(allCompanies).filter(([k, v]) => !v.isSystem);
  for (const [cid, company] of companies) {
    if (!company.employees || !company.salary) continue;
    const totalSalary = company.salary * Object.keys(company.employees).length;
    const bossUid = company.bossUid;
    const bossUser = allUsers[bossUid];
    if (!bossUser) continue;

    if ((bossUser.cash || 0) >= totalSalary) {
      await update(ref(db, `users/${bossUid}`), { cash: (bossUser.cash || 0) - totalSalary });
      // 각 직원에게 월급 지급
      for (const [empUid] of Object.entries(company.employees)) {
        const emp = allUsers[empUid];
        if (emp) await update(ref(db, `users/${empUid}`), { cash: (emp.cash || 0) + company.salary });
      }
    } else {
      // 잔고 마이너스
      await update(ref(db, `users/${bossUid}`), { cash: (bossUser.cash || 0) - totalSalary });
    }
  }
}

async function chargeElectricityBills() {
  const companies = Object.entries(allCompanies).filter(([k, v]) => !v.isSystem);
  for (const [cid, company] of companies) {
    if (!company.robots) continue;
    let totalBill = 0;
    for (const [rtype, robots] of Object.entries(company.robots)) {
      for (const [tier, count] of Object.entries(robots)) {
        totalBill += ROBOT_PRICES[tier].electricity * count;
      }
    }
    if (totalBill > 0) {
      const bossUser = allUsers[company.bossUid];
      if (bossUser) {
        await update(ref(db, `users/${company.bossUid}`), { cash: (bossUser.cash || 0) - totalBill });
        if (company.bossUid === auth.currentUser?.uid) {
          showToast(`📬 전기세 -₩${totalBill.toLocaleString()}`);
        }
      }
    }
  }
}

async function updateAllPrices() {
  const companies = Object.entries(allCompanies).filter(([k, v]) => !v.isSystem);
  for (const [cid, company] of companies) {
    const newPrice = calcCoinPrice(company);
    let hist = company.priceHistory || Array(30).fill(100);
    hist = [...hist.slice(1), newPrice];
    await update(ref(db, `companies/${cid}`), { coinPrice: newPrice, priceHistory: hist });
  }
}

function calcCoinPrice(company) {
  const base = 100;
  const holdingBonus = (company.holdings || 0) * 0.05;
  const salesBonus = (company.totalSales || 0) * 0.8;
  const miningBonus = (company.totalMined || 0) * 0.3;
  const noise = (Math.random() - 0.4) * 15;
  const dropFactor = (company.totalSales || 0) < 5 && gameDay > 5 ? 0.85 : 1;
  return Math.max(1, Math.floor((base + holdingBonus + salesBonus + miningBonus + noise) * dropFactor));
}

async function triggerRandomEvent() {
  const companies = Object.entries(allCompanies).filter(([k, v]) => !v.isSystem);
  if (!companies.length) return;
  const [cid, company] = companies[Math.floor(Math.random() * companies.length)];
  const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  const msg = event.msg.replace('{target}', company.name);
  showToast(msg);

  if (event.effect === 'tax') {
    const loss = Math.floor((allUsers[company.bossUid]?.cash || 0) * 0.2);
    await update(ref(db, `users/${company.bossUid}`), { cash: Math.max(-99999999, (allUsers[company.bossUid]?.cash || 0) - loss) });
  } else if (event.effect === 'recall' || event.effect === 'scandal') {
    const drop = event.effect === 'scandal' ? 0.7 : 0.85;
    await update(ref(db, `companies/${cid}`), { coinPrice: Math.floor((company.coinPrice || 100) * drop) });
  } else if (event.effect === 'boom' || event.effect === 'export') {
    await update(ref(db, `companies/${cid}`), { totalSales: (company.totalSales || 0) + 50, coinPrice: Math.floor((company.coinPrice || 100) * 1.2) });
  } else if (event.effect === 'sales_halt') {
    await update(ref(db, `companies/${cid}`), { haltSales: true });
    setTimeout(() => update(ref(db, `companies/${cid}`), { haltSales: false }), 30000);
  } else if (event.effect === 'sector_crisis') {
    for (const [c2id, c2] of Object.entries(allCompanies).filter(([k, v]) => v.sector === company.sector && !v.isSystem)) {
      await update(ref(db, `companies/${c2id}`), { coinPrice: Math.floor((c2.coinPrice || 100) * 0.9) });
    }
  }
}

// ===== PAGE NAV =====
window.showPage = (page) => {
  const pages = ['home', 'jobs', 'leaderboard', 'market', 'mypage', 'company', 'government'];
  pages.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.toggle('active', p === page);
    const tab = document.getElementById('tab-' + p);
    if (tab) tab.classList.toggle('active', p === page);
  });
  if (page === 'home') { renderHome(); renderExchange(); }
  if (page === 'jobs') renderJobs();
  if (page === 'leaderboard') renderLeaderboard('cash');
  if (page === 'market') renderMarketShop();
  if (page === 'mypage') renderMypage();
};

// ===== COMPANY SETUP =====
window.doSetup = async () => {
  const name = document.getElementById('company-name-input').value.trim();
  const coin = document.getElementById('coin-name-input').value.trim().toUpperCase();
  const selected = document.querySelector('.sector-btn.selected');
  const workStyle = parseInt(document.getElementById('work-style-select').value);
  if (!name || !coin || !selected) {
    document.getElementById('setup-msg').textContent = '모든 항목을 입력/선택하세요.'; return;
  }
  const uid = auth.currentUser.uid;
  const user = allUsers[uid] || {};
  if ((user.companies || []).length >= 5) {
    document.getElementById('setup-msg').textContent = '회사는 최대 5개까지 가능합니다.'; return;
  }
  const cid = push(ref(db, 'companies')).key;
  await set(ref(db, `companies/${cid}`), {
    id: cid, bossUid: uid, bossName: auth.currentUser.displayName,
    name, coinName: coin, sector: selected.textContent,
    coinPrice: 100, holdings: 1000, totalSales: 0, totalRevenue: 0,
    totalMined: 0, workStyle, salary: MIN_WAGE,
    employees: {}, robots: {}, layout: {},
    priceHistory: Array(30).fill(100),
    haltSales: false, createdAt: Date.now()
  });
  const companies = [...(user.companies || []), cid];
  await update(ref(db, `users/${uid}`), { companies, unemployedSince: null });
  showScreen('app');
  window.initApp && window.initApp();
};

// ===== SECTOR GRID =====
function renderSectorGrid() {
  const grid = document.getElementById('sector-grid');
  if (!grid) return;
  grid.innerHTML = '';
  SECTORS.forEach(s => {
    const b = document.createElement('button');
    b.className = 'sector-btn'; b.textContent = s;
    b.onclick = () => {
      document.querySelectorAll('.sector-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    };
    grid.appendChild(b);
  });
}

// ===== TOPBAR =====
window.updateTopbar = () => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user) return;
  document.getElementById('topbar-balance').textContent = '₩' + (user.cash || 0).toLocaleString();
};

// ===== HOME =====
function renderHome() {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user) return;

  // 홍보 배너
  renderPromos();

  // 자산
  document.getElementById('home-cash').textContent = '₩' + (user.cash || 0).toLocaleString();
  document.getElementById('home-status').textContent =
    (user.companies && user.companies.length > 0) ? `회사 ${user.companies.length}개` : '실업자';

  // 집
  document.getElementById('home-house').textContent = user.house ? `${user.house}평` : '없음';

  // 코인 환산 총자산
  let coinTotal = 0;
  (user.companies || []).forEach(cid => {
    const c = allCompanies[cid];
    if (c) coinTotal += (user[`holdings_${cid}`] || 0) * (c.coinPrice || 100);
  });
  document.getElementById('home-total-coins').textContent = '₩' + coinTotal.toLocaleString();

  // 내 회사 목록
  const myList = document.getElementById('my-companies-list');
  const companies = (user.companies || []).map(cid => allCompanies[cid]).filter(Boolean);
  myList.innerHTML = companies.length === 0
    ? '<div class="text-sm">회사 없음 — 취업하거나 직접 만들어보세요!</div>'
    : companies.map(c => `
      <div class="list-item" onclick="openCompany('${c.id}')">
        <div>
          <div class="list-item-name">${c.name}</div>
          <div class="list-item-sub">${c.sector} · ${c.coinName}</div>
        </div>
        <div class="list-item-right">
          <div class="stat-val green">₩${(c.coinPrice || 100).toLocaleString()}</div>
          <div class="text-xs">${c.bossUid === uid ? '👑 사장' : '👷 직원'}</div>
        </div>
      </div>`).join('');

  // 식사 체크
  checkMealStatus();
}

function checkMealStatus() {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user) return;
  const today = new Date().toDateString();
  const mealEl = document.getElementById('meal-status');
  const mealCard = document.getElementById('meal-card');
  if (user.lastMeal === today) {
    mealEl.textContent = '✅ 오늘 식사 완료!';
    mealCard.style.borderColor = '#00ff8840';
  } else {
    mealEl.textContent = '⚠️ 아직 오늘 식사를 안 했어요!';
    mealCard.style.borderColor = '#ff336640';
  }
}

// ===== EXCHANGE =====
function renderExchange() {
  const list = document.getElementById('exchange-list');
  if (!list) return;
  const companies = Object.values(allCompanies).filter(c => !c.isSystem);
  if (!companies.length) { list.innerHTML = '<div class="text-sm">코인 없음</div>'; return; }
  list.innerHTML = companies.map(c => {
    const hist = c.priceHistory || [];
    const prev = hist[hist.length - 2] || c.coinPrice;
    const change = prev ? ((c.coinPrice - prev) / prev * 100).toFixed(1) : 0;
    const changeClass = change >= 0 ? 'up' : 'down';
    return `
      <div class="exchange-item">
        <div>
          <div class="exchange-coin">${c.coinName}</div>
          <div class="text-xs">${c.name}</div>
        </div>
        <div class="exchange-price">₩${(c.coinPrice || 100).toLocaleString()}</div>
        <div>
          <div class="exchange-change ${changeClass}">${change >= 0 ? '+' : ''}${change}%</div>
          <div class="exchange-btns">
            <button class="btn btn-sm btn-blue" onclick="buyCoin('${c.id}')">매수</button>
            <button class="btn btn-sm btn-red" onclick="sellCoin('${c.id}')">매도</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

window.filterExchange = () => {
  const q = document.getElementById('exchange-search').value.toLowerCase();
  document.querySelectorAll('.exchange-item').forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

window.buyCoin = (cid) => {
  const c = allCompanies[cid];
  if (!c) return;
  showModal(`${c.coinName} 매수`, `
    <div class="stat-row"><span class="stat-label">현재가</span><span class="stat-val green">₩${c.coinPrice.toLocaleString()}</span></div>
    <div class="form-group mt8"><label>수량</label><input type="number" id="buy-coin-qty" value="1" min="1"></div>
  `, [
    { text: '매수', cls: 'btn', action: async () => {
      const qty = parseInt(document.getElementById('buy-coin-qty').value);
      const uid = auth.currentUser.uid;
      const user = allUsers[uid];
      const cost = qty * c.coinPrice;
      if ((user.cash || 0) < cost) { showToast('💸 잔고 부족!'); return; }
      await update(ref(db, `users/${uid}`), {
        cash: (user.cash || 0) - cost,
        [`holdings_${cid}`]: (user[`holdings_${cid}`] || 0) + qty
      });
      await update(ref(db, `companies/${cid}`), { holdings: (c.holdings || 0) + qty });
      showToast(`✅ ${c.coinName} ${qty}개 매수!`);
      closeModal();
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
};

window.sellCoin = (cid) => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const holdings = user?.[`holdings_${cid}`] || 0;
  const c = allCompanies[cid];
  if (!c || holdings === 0) { showToast('보유 코인 없음'); return; }
  showModal(`${c.coinName} 매도`, `
    <div class="stat-row"><span class="stat-label">보유량</span><span class="stat-val">${holdings}</span></div>
    <div class="form-group mt8"><label>수량</label><input type="number" id="sell-coin-qty" value="1" min="1" max="${holdings}"></div>
  `, [
    { text: '매도', cls: 'btn btn-red', action: async () => {
      const qty = Math.min(parseInt(document.getElementById('sell-coin-qty').value), holdings);
      const gain = qty * c.coinPrice;
      await update(ref(db, `users/${uid}`), {
        cash: (user.cash || 0) + gain,
        [`holdings_${cid}`]: holdings - qty
      });
      await update(ref(db, `companies/${cid}`), { holdings: Math.max(0, (c.holdings || 0) - qty) });
      showToast(`✅ ${c.coinName} ${qty}개 매도! +₩${gain.toLocaleString()}`);
      closeModal();
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
};

// ===== JOBS =====
function renderJobs() {
  const list = document.getElementById('job-list');
  if (!list) return;
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const myCompanyIds = user?.companies || [];
  const companies = Object.entries(allCompanies).filter(([k, v]) => !v.isSystem && v.bossUid !== uid && !myCompanyIds.includes(k));
  list.innerHTML = companies.length === 0 ? '<div class="text-sm">취업 가능한 회사 없음</div>' : '';
  companies.forEach(([cid, c]) => {
    const alreadyApplied = c.applications?.[uid];
    list.innerHTML += `
      <div class="job-item">
        <div class="job-item-header">
          <div><div class="job-company">${c.name}</div><div class="job-sector">${c.sector} · 월급 ₩${(c.salary || MIN_WAGE).toLocaleString()}</div></div>
          <div class="job-btns">
            ${alreadyApplied
              ? `<span class="badge badge-yellow">${alreadyApplied === 'pending' ? '대기중' : alreadyApplied === 'accepted' ? '수락됨' : '보류'}</span>`
              : (myCompanyIds.length >= 5
                ? '<span class="badge badge-red">한도초과</span>'
                : `<button class="btn btn-sm" onclick="applyJob('${cid}')">지원하기</button>`
              )
            }
          </div>
        </div>
        <div class="stat-row"><span class="stat-label">코인가</span><span class="stat-val green">₩${(c.coinPrice||100).toLocaleString()}</span></div>
        <div class="stat-row"><span class="stat-label">직원</span><span class="stat-val">${Object.keys(c.employees||{}).length}명</span></div>
      </div>`;
  });
}

window.filterJobs = () => {
  const q = document.getElementById('job-search').value.toLowerCase();
  document.querySelectorAll('.job-item').forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

window.applyJob = async (cid) => {
  const uid = auth.currentUser?.uid;
  await update(ref(db, `companies/${cid}/applications`), { [uid]: 'pending' });
  showToast('📤 입사 지원 완료!');
  renderJobs();
};

// ===== LEADERBOARD =====
let currentLbType = 'cash';
window.switchLeaderboard = (type) => {
  currentLbType = type;
  document.querySelectorAll('#page-leaderboard .tab').forEach((t, i) => {
    t.classList.toggle('active', ['cash','total','company'][i] === type);
  });
  renderLeaderboard(type);
};

function renderLeaderboard(type) {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;
  let entries = [];
  if (type === 'cash' || type === 'total') {
    entries = Object.entries(allUsers)
      .filter(([k, v]) => v.nick)
      .map(([uid, user]) => {
        let total = user.cash || 0;
        if (type === 'total') {
          (user.companies || []).forEach(cid => {
            const c = allCompanies[cid];
            if (c) total += (user[`holdings_${cid}`] || 0) * (c.coinPrice || 100);
          });
        }
        return { name: user.nick, value: total };
      })
      .sort((a, b) => b.value - a.value);
  } else {
    entries = Object.values(allCompanies)
      .filter(c => !c.isSystem)
      .map(c => ({ name: `${c.name} (${c.coinName})`, value: c.coinPrice || 100 }))
      .sort((a, b) => b.value - a.value);
  }

  const rankClass = ['gold', 'silver', 'bronze'];
  list.innerHTML = entries.slice(0, 20).map((e, i) => `
    <div class="lb-item">
      <div class="lb-rank ${rankClass[i] || ''}">${i + 1}</div>
      <div class="lb-info"><div class="lb-name">${e.name}</div></div>
      <div class="lb-val">₩${e.value.toLocaleString()}</div>
    </div>`).join('');
}

// ===== MARKET =====
window.switchMarket = (tab) => {
  ['shop','used','inventory','b2b'].forEach(t => {
    document.getElementById('market-' + t).style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#page-market .tab').forEach((t, i) => {
    t.classList.toggle('active', ['shop','used','inventory','b2b'][i] === tab);
  });
  if (tab === 'shop') renderMarketShop();
  if (tab === 'used') renderUsedMarket();
  if (tab === 'inventory') renderInventory();
  if (tab === 'b2b') renderB2B();
};

function renderMarketShop() {
  const list = document.getElementById('market-list');
  if (!list) return;
  // 기본 식품 아이템 + 회사 상품
  const defaultItems = [
    { id: 'food_rice', name: '🍚 밥', company: '기본마트', price: 5000, type: 'food' },
    { id: 'food_ramen', name: '🍜 라면', company: '기본마트', price: 3000, type: 'food' },
    { id: 'food_bread', name: '🍞 빵', company: '기본마트', price: 4000, type: 'food' },
    { id: 'food_pizza', name: '🍕 피자', company: '기본마트', price: 15000, type: 'food' },
    { id: 'food_burger', name: '🍔 버거', company: '기본마트', price: 8000, type: 'food' },
  ];
  // 회사 판매 물건 추가
  const companyItems = Object.entries(allItems).map(([iid, item]) => ({ id: iid, ...item }));
  const allItemList = [...defaultItems, ...companyItems];
  list.innerHTML = allItemList.map(item => `
    <div class="market-item">
      <div class="market-item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-company">${item.company}</div>
      </div>
      <div class="market-item-right">
        <div class="market-item-price">₩${item.price.toLocaleString()}</div>
        <button class="btn btn-sm" onclick="buyItem('${item.id}', '${item.name}', ${item.price}, '${item.type || 'goods'}')">구매</button>
      </div>
    </div>`).join('');
}

window.filterMarket = () => {
  const q = document.getElementById('market-search').value.toLowerCase();
  document.querySelectorAll('.market-item').forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

window.buyItem = async (id, name, price, type) => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if ((user?.cash || 0) < price) { showToast('💸 잔고 부족!'); return; }
  const inv = user.inventory || {};
  inv[id] = { name, price, type, qty: (inv[id]?.qty || 0) + 1 };
  await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - price, inventory: inv });

  // 식사 처리
  if (type === 'food') {
    const today = new Date().toDateString();
    await update(ref(db, `users/${uid}`), { lastMeal: today });
    showToast(`🍽️ ${name} 구매 & 식사 완료!`);
    checkMealStatus();
  } else {
    showToast(`✅ ${name} 구매 완료! 인벤토리에 추가됨`);
  }
};

function renderInventory() {
  const list = document.getElementById('inventory-list');
  if (!list) return;
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const inv = user?.inventory || {};
  const items = Object.entries(inv).filter(([k, v]) => v.qty > 0);
  list.innerHTML = items.length === 0 ? '<div class="text-sm">인벤토리 비어 있음</div>' : '';
  items.forEach(([id, item]) => {
    list.innerHTML += `
      <div class="inv-item">
        <div><div class="inv-name">${item.name}</div><div class="inv-qty">x${item.qty}</div></div>
        <div class="inv-btns">
          ${item.type === 'food' ? `<button class="btn btn-sm btn-yellow" onclick="eatItem('${id}')">먹기</button>` : ''}
          <button class="btn btn-sm btn-outline" onclick="sellUsedItem('${id}')">판매</button>
        </div>
      </div>`;
  });
}

window.eatItem = async (id) => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const inv = { ...user.inventory };
  if (!inv[id] || inv[id].qty <= 0) return;
  inv[id].qty--;
  const today = new Date().toDateString();
  await update(ref(db, `users/${uid}`), { inventory: inv, lastMeal: today });
  showToast('🍽️ 식사 완료!');
  checkMealStatus();
  renderInventory();
};

function renderUsedMarket() {
  const list = document.getElementById('used-list');
  if (!list) return;
  const items = Object.entries(usedMarket);
  list.innerHTML = items.length === 0 ? '<div class="text-sm">중고 물건 없음</div>' : '';
  items.forEach(([lid, item]) => {
    const isMine = item.sellerUid === auth.currentUser?.uid;
    list.innerHTML += `
      <div class="market-item">
        <div class="market-item-info">
          <div class="item-name">${item.name} ${item.isCoin ? '<span class="badge badge-blue">코인</span>' : ''}</div>
          <div class="item-company">판매자: ${item.sellerName}</div>
        </div>
        <div class="market-item-right">
          <div class="market-item-price">₩${item.price.toLocaleString()}</div>
          ${isMine
            ? `<button class="btn btn-sm btn-red" onclick="removeUsedItem('${lid}')">취소</button>`
            : `<button class="btn btn-sm" onclick="buyUsedItem('${lid}')">구매</button>`
          }
        </div>
      </div>`;
  });
}

window.buyUsedItem = async (lid) => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const item = usedMarket[lid];
  if (!item) return;
  if ((user?.cash || 0) < item.price) { showToast('💸 잔고 부족!'); return; }
  const seller = allUsers[item.sellerUid];
  await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - item.price });
  await update(ref(db, `users/${item.sellerUid}`), { cash: (seller?.cash || 0) + item.price });
  if (item.isCoin) {
    await update(ref(db, `users/${uid}`), { [`holdings_${item.coinId}`]: (user[`holdings_${item.coinId}`] || 0) + item.qty });
  } else {
    const inv = { ...(user.inventory || {}) };
    inv[item.itemId] = { name: item.name, price: item.price, type: item.type, qty: (inv[item.itemId]?.qty || 0) + item.qty };
    await update(ref(db, `users/${uid}`), { inventory: inv });
  }
  await remove(ref(db, `usedMarket/${lid}`));
  showToast(`✅ ${item.name} 구매 완료!`);
};

window.removeUsedItem = async (lid) => {
  await remove(ref(db, `usedMarket/${lid}`));
  showToast('취소됨');
};

window.sellUsedItem = (id) => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const item = user?.inventory?.[id];
  if (!item) return;
  showModal('중고 판매', `
    <div class="stat-row"><span class="stat-label">물건</span><span class="stat-val">${item.name}</span></div>
    <div class="form-group mt8"><label>가격</label><input type="number" id="used-price" value="${item.price}"></div>
  `, [
    { text: '판매 등록', cls: 'btn', action: async () => {
      const price = parseInt(document.getElementById('used-price').value);
      await push(ref(db, 'usedMarket'), {
        sellerUid: uid, sellerName: user.nick || user.email,
        itemId: id, name: item.name, price, qty: 1, type: item.type, isCoin: false
      });
      const inv = { ...user.inventory };
      inv[id].qty--;
      await update(ref(db, `users/${uid}`), { inventory: inv });
      showToast('📦 중고 등록 완료!');
      closeModal();
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
};

window.showSellUsedModal = () => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  showModal('중고 판매 등록', `
    <p class="text-sm">인벤토리 탭에서 물건을 선택해 판매하거나,<br>코인을 직접 판매할 수 있어요.</p>
  `, [{ text: '닫기', cls: 'btn btn-outline', action: closeModal }]);
};

function renderB2B() {
  const list = document.getElementById('b2b-list');
  if (!list) return;
  const b2bItems = Object.entries(allItems).filter(([k, v]) => v.isB2B);
  list.innerHTML = b2bItems.length === 0 ? '<div class="text-sm">기업간 거래 상품 없음</div>' : '';
  b2bItems.forEach(([iid, item]) => {
    list.innerHTML += `
      <div class="market-item">
        <div class="market-item-info"><div class="item-name">${item.name}</div><div class="item-company">${item.company}</div></div>
        <div class="market-item-right"><div class="market-item-price">₩${item.price.toLocaleString()}/개</div>
        <button class="btn btn-sm btn-purple" onclick="buyB2B('${iid}')">기업구매</button></div>
      </div>`;
  });
}

window.buyB2B = async (iid) => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const item = allItems[iid];
  if (!item) return;
  if ((user?.cash || 0) < item.price) { showToast('💸 잔고 부족!'); return; }
  const inv = { ...(user.inventory || {}) };
  inv[iid] = { name: item.name, price: item.price, type: 'material', qty: (inv[iid]?.qty || 0) + 1 };
  await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - item.price, inventory: inv });
  showToast(`✅ ${item.name} 구매 완료!`);
};

// ===== MYPAGE =====
function renderMypage() {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user) return;
  document.getElementById('my-nick').value = user.nick || '';
  document.getElementById('my-email').value = user.email || auth.currentUser?.email || '';
  document.getElementById('my-cash').value = '₩' + (user.cash || 0).toLocaleString();
  let total = user.cash || 0;
  (user.companies || []).forEach(cid => {
    const c = allCompanies[cid];
    if (c) total += (user[`holdings_${cid}`] || 0) * (c.coinPrice || 100);
  });
  document.getElementById('my-total').value = '₩' + total.toLocaleString();
  document.getElementById('my-house').value = user.house ? `${user.house}평` : '없음';
  document.getElementById('my-party-status').textContent = user.party ? `현재 소속: ${user.party}` : '정당 미소속';
}

window.showBuyHouseModal = () => {
  showModal('🏠 집 구매', `
    <p class="text-sm">1억당 10평 구매 가능</p>
    <div class="form-group mt8"><label>구매 평수 (10평 단위)</label>
    <input type="number" id="house-size" value="10" min="10" step="10"></div>
    <div class="stat-row"><span class="stat-label">비용</span><span class="stat-val yellow" id="house-cost">₩100,000,000</span></div>
    <script>document.getElementById('house-size').oninput=()=>{const s=parseInt(document.getElementById('house-size').value)||10;document.getElementById('house-cost').textContent='₩'+(s/10*100000000).toLocaleString();}<\/script>
  `, [
    { text: '구매', cls: 'btn', action: async () => {
      const size = parseInt(document.getElementById('house-size').value);
      const cost = (size / 10) * 100000000;
      const uid = auth.currentUser?.uid;
      const user = allUsers[uid];
      if ((user?.cash || 0) < cost) { showToast('💸 잔고 부족!'); return; }
      await update(ref(db, `users/${uid}`), { cash: (user.cash || 0) - cost, house: (user.house || 0) + size });
      showToast(`🏠 ${size}평 구매 완료!`);
      closeModal();
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
};

window.joinParty = async () => {
  const uid = auth.currentUser?.uid;
  const party = document.getElementById('party-select').value;
  if (!party) return;
  await update(ref(db, `users/${uid}`), { party });
  showToast(`🏛️ ${party} 가입 완료!`);
  document.getElementById('my-party-status').textContent = `현재 소속: ${party}`;
};

// ===== PROMOS =====
function renderPromos() {
  const homeCard = document.getElementById('page-home');
  if (!homeCard) return;
  let promoBanner = document.getElementById('promo-banners');
  if (!promoBanner) {
    promoBanner = document.createElement('div');
    promoBanner.id = 'promo-banners';
    homeCard.querySelector('.page-scroll').insertBefore(promoBanner, homeCard.querySelector('.card'));
  }
  const now = Date.now();
  const activePromos = promos.filter(p => p.expiresAt > now);
  promoBanner.innerHTML = activePromos.map(p => `
    <div class="promo-banner">
      <div class="promo-company">📣 ${p.companyName}</div>
      <div class="promo-msg">${p.message || '지금 방문하세요!'}</div>
    </div>`).join('');
}

// ===== TICKER =====
function updateTicker() {
  const companies = Object.values(allCompanies).filter(c => !c.isSystem);
  const text = companies.map(c => `${c.coinName}: ₩${(c.coinPrice || 100).toLocaleString()}`).join('   ·   ');
  document.getElementById('ticker-inner').textContent = text || '시장 데이터 로딩중...';
}

// ===== MINING UI =====
function updateMiningUI() {
  if (!miningActive) return;
  const gpu = Math.min(100, 60 + Math.random() * 30);
  const cpu = Math.min(100, 40 + Math.random() * 40);
  const gpuBar = document.getElementById('gpu-bar');
  const cpuBar = document.getElementById('cpu-bar');
  if (gpuBar) { gpuBar.style.width = gpu + '%'; document.getElementById('gpu-pct').textContent = gpu.toFixed(0) + '%'; }
  if (cpuBar) { cpuBar.style.width = cpu + '%'; document.getElementById('cpu-pct').textContent = cpu.toFixed(0) + '%'; }
}

export { renderHome, renderJobs, renderLeaderboard, renderMarketShop, renderUsedMarket, renderInventory, renderB2B, renderMypage, renderExchange, updateTicker };