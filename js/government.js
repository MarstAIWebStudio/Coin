// js/government.js
import { auth, db } from './firebase.js';
import { ref, set, get, update, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { allUsers, allCompanies, MIN_WAGE } from './app.js';

let govState = {};
let electionActive = false;
let currentPresident = null;
let currentMinWage = MIN_WAGE;

// ===== 구독 =====
onValue(ref(db, 'government'), snap => {
  govState = snap.val() || {};
  electionActive = govState.electionActive || false;
  currentPresident = govState.president || null;
  currentMinWage = govState.minWage || MIN_WAGE;

  updateElectionNotice();
  renderGovContent();
});

function updateElectionNotice() {
  const notice = document.getElementById('election-notice');
  if (notice) notice.style.display = electionActive ? '' : 'none';
}

// ===== 정부 탭 전환 =====
window.switchGovTab = (tab) => {
  ['meeting','election','president','wage'].forEach(t => {
    const el = document.getElementById('gov-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#page-government .tab').forEach((t, i) => {
    t.classList.toggle('active', ['meeting','election','president','wage'][i] === tab);
  });
  if (tab === 'meeting') renderMeeting();
  if (tab === 'election') renderElection();
  if (tab === 'president') renderPresidentPanel();
  if (tab === 'wage') renderWagePanel();
};

function renderGovContent() {
  renderMeeting();
  renderElection();
  renderPresidentPanel();
  renderWagePanel();
}

// ===== 회의 =====
function renderMeeting() {
  const log = document.getElementById('meeting-log');
  if (!log) return;
  const messages = govState.meeting || {};
  const msgs = Object.values(messages).sort((a, b) => a.time - b.time).slice(-20);
  log.innerHTML = msgs.length === 0
    ? '<div class="text-sm">아직 발언 없음</div>'
    : msgs.map(m => `
        <div class="event-item neutral" style="margin-bottom:8px;padding:10px;background:var(--surface2);border-radius:8px;border-left:3px solid var(--blue)">
          <span style="font-weight:700;color:var(--blue)">${m.nick}</span>
          <span class="badge badge-purple" style="margin-left:4px">${m.party}</span>
          <div style="margin-top:4px;font-size:13px">${m.text}</div>
          <div class="text-xs" style="margin-top:4px">${new Date(m.time).toLocaleTimeString('ko-KR')}</div>
        </div>`).join('');
  log.scrollTop = log.scrollHeight;
}

window.sendMeetingMessage = async () => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user?.party) { showToast('❌ 정당에 가입해야 발언할 수 있어요!'); return; }
  const input = document.getElementById('meeting-input');
  const text = input.value.trim();
  if (!text) return;
  const mid = push(ref(db, 'government/meeting')).key;
  await set(ref(db, `government/meeting/${mid}`), {
    uid, nick: user.nick, party: user.party, text, time: Date.now()
  });
  input.value = '';
};

// ===== 선거 =====
function renderElection() {
  const el = document.getElementById('election-content');
  if (!el) return;
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const candidates = govState.candidates || {};
  const votes = govState.votes || {};
  const myVote = votes[uid];

  if (!electionActive) {
    el.innerHTML = `
      <div class="text-sm" style="margin-bottom:16px">다음 선거까지 대기중</div>
      ${user?.party ? `<button class="btn btn-blue" onclick="runForElection()">🗳️ 후보 등록</button>` : '<div class="text-sm">정당 가입 후 후보 등록 가능</div>'}
    `;
    return;
  }

  const candidateList = Object.entries(candidates);
  el.innerHTML = `
    <div class="badge badge-yellow" style="margin-bottom:12px">🗳️ 선거 진행중!</div>
    <div style="margin-bottom:16px">
      ${candidateList.length === 0
        ? '<div class="text-sm">등록된 후보 없음</div>'
        : candidateList.map(([cuid, cand]) => {
            const voteCount = Object.values(votes).filter(v => v === cuid).length;
            return `
              <div class="list-item" style="margin-bottom:8px">
                <div>
                  <div class="list-item-name">${cand.nick}</div>
                  <div class="list-item-sub">${cand.party} · 공약: ${cand.pledge || '없음'}</div>
                </div>
                <div style="text-align:right">
                  <div class="stat-val">${voteCount}표</div>
                  ${!myVote ? `<button class="btn btn-sm btn-blue" onclick="voteFor('${cuid}')">투표</button>` : ''}
                </div>
              </div>`;
          }).join('')
      }
    </div>
    ${myVote ? `<div class="badge badge-green">✅ 투표 완료</div>` : ''}
    ${user?.party && !candidates[uid] ? `<button class="btn btn-outline btn-sm mt8" onclick="runForElection()">후보 등록</button>` : ''}
  `;
}

window.runForElection = () => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user?.party) { showToast('정당 가입 필요'); return; }
  showModal('🗳️ 후보 등록', `
    <div class="form-group"><label>공약</label><input type="text" id="pledge-input" placeholder="예: 최저임금 인상 추진"></div>
  `, [
    { text: '등록', cls: 'btn', action: async () => {
      const pledge = document.getElementById('pledge-input').value.trim();
      await update(ref(db, `government/candidates/${uid}`), { uid, nick: user.nick, party: user.party, pledge });
      showToast('🗳️ 후보 등록 완료!');
      closeModal();
      renderElection();
    }},
    { text: '취소', cls: 'btn btn-outline', action: closeModal }
  ]);
};

window.voteFor = async (candidateUid) => {
  const uid = auth.currentUser?.uid;
  await update(ref(db, `government/votes`), { [uid]: candidateUid });
  showToast('✅ 투표 완료!');
  renderElection();
};

// 선거 자동 시작/종료 (매월)
function checkElectionCycle() {
  const now = Date.now();
  const lastElection = govState.lastElection || 0;
  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

  if (now - lastElection >= ONE_MONTH && !electionActive) {
    startElection();
  }
}

async function startElection() {
  await update(ref(db, 'government'), { electionActive: true, candidates: {}, votes: {}, electionStart: Date.now() });
  showToast('🗳️ 선거가 시작되었습니다!');
  // 7일 후 자동 종료
  setTimeout(endElection, 7 * 24 * 60 * 60 * 1000);
}

async function endElection() {
  const votes = govState.votes || {};
  const candidates = govState.candidates || {};
  // 득표 집계
  const tally = {};
  Object.values(votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
  const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (winner) {
    const [winnerUid] = winner;
    const winnerInfo = candidates[winnerUid];
    await update(ref(db, 'government'), {
      electionActive: false, president: { uid: winnerUid, ...winnerInfo },
      lastElection: Date.now(), wageVoteActive: true
    });
    showToast(`🎉 ${winnerInfo?.nick}님이 대통령으로 당선!`);
  } else {
    await update(ref(db, 'government'), { electionActive: false, lastElection: Date.now() });
  }
}

setInterval(checkElectionCycle, 60000);

// ===== 대통령 패널 =====
function renderPresidentPanel() {
  const el = document.getElementById('president-content');
  if (!el) return;
  const uid = auth.currentUser?.uid;
  const isPresident = currentPresident?.uid === uid;

  if (!currentPresident) {
    el.innerHTML = '<div class="text-sm">현재 대통령 없음 (선거 후 결정)</div>'; return;
  }

  const impeachVotes = govState.impeachVotes || {};
  const govUsers = Object.entries(allUsers).filter(([k, v]) => v.party);
  const impeachCount = Object.keys(impeachVotes).length;
  const threshold = Math.ceil(govUsers.length * 0.6); // 60% 이상 탄핵
  const canImpeach = govState.impeachUnlocked;

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">👑 현 대통령</div>
      <div class="stat-row"><span class="stat-label">이름</span><span class="stat-val">${currentPresident.nick}</span></div>
      <div class="stat-row"><span class="stat-label">정당</span><span class="stat-val">${currentPresident.party}</span></div>
    </div>

    ${isPresident ? `
      <div class="card">
        <div class="card-title">⚡ 대통령 권한</div>
        <div class="form-group">
          <label>분야 지원/반대</label>
          <select id="pres-sector-select">
            <option value="">분야 선택...</option>
            ${Object.values(allCompanies).filter(c=>!c.isSystem).map(c=>c.sector).filter((v,i,a)=>a.indexOf(v)===i).map(s=>`<option>${s}</option>`).join('')}
          </select>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" onclick="sectorPolicy('support')">✅ 지원</button>
            <button class="btn btn-red btn-sm" onclick="sectorPolicy('oppose')">❌ 반대</button>
          </div>
        </div>
        <div class="form-group">
          <label>회사 압박</label>
          <select id="pres-company-select">
            ${Object.entries(allCompanies).filter(([k,v])=>!v.isSystem).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('')}
          </select>
          <button class="btn btn-red btn-sm" onclick="pressureCompany()">압박 가하기</button>
        </div>
      </div>` : ''}

    ${canImpeach ? `
      <div class="card" style="border-color:var(--red)">
        <div class="card-title" style="color:var(--red)">🚨 탄핵 투표</div>
        <div class="stat-row"><span class="stat-label">현재 탄핵 찬성</span><span class="stat-val red">${impeachCount}/${threshold}명</span></div>
        ${!impeachVotes[uid] && !isPresident
          ? `<button class="btn btn-red" onclick="voteImpeach()">탄핵 찬성 투표</button>`
          : '<div class="badge badge-red">투표 완료</div>'}
      </div>` : ''}
  `;
}

window.sectorPolicy = async (action) => {
  const sector = document.getElementById('pres-sector-select').value;
  if (!sector) { showToast('분야를 선택하세요'); return; }
  // 해당 분야 회사들 코인 가격 영향
  const affected = Object.entries(allCompanies).filter(([k,v]) => v.sector === sector && !v.isSystem);
  for (const [cid, c] of affected) {
    const factor = action === 'support' ? 1.1 : 0.9;
    await update(ref(db, `companies/${cid}`), { coinPrice: Math.floor((c.coinPrice || 100) * factor) });
  }
  await update(ref(db, 'government'), {
    [`policies/${sector}`]: { action, by: currentPresident?.nick, time: Date.now() }
  });
  showToast(`${action === 'support' ? '✅ 지원' : '❌ 반대'} 정책 발표: ${sector}`);
};

window.pressureCompany = async () => {
  const cid = document.getElementById('pres-company-select').value;
  const c = allCompanies[cid];
  if (!c) return;
  // 물가 상승 + 코인 변동
  const newPrice = Math.floor((c.coinPrice || 100) * (0.85 + Math.random() * 0.2));
  await update(ref(db, `companies/${cid}`), { coinPrice: newPrice, pressPressure: true });

  // 압박 횟수 체크 → 탄핵 해금
  const pressCount = (govState.pressCount || 0) + 1;
  await update(ref(db, 'government'), { pressCount });
  if (pressCount >= 5) {
    await update(ref(db, 'government'), { impeachUnlocked: true });
    showToast('🚨 탄핵 투표가 해금되었습니다!');
  }
  showToast(`⚡ ${c.name}에 압박 가함!`);
};

window.voteImpeach = async () => {
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  if (!user?.party) { showToast('정당 가입 필요'); return; }
  await update(ref(db, `government/impeachVotes`), { [uid]: true });

  const govUsers = Object.entries(allUsers).filter(([k, v]) => v.party);
  const threshold = Math.ceil(govUsers.length * 0.6);
  const newCount = (Object.keys(govState.impeachVotes || {})).length + 1;
  if (newCount >= threshold) {
    await update(ref(db, 'government'), {
      president: null, impeachUnlocked: false, impeachVotes: {}, pressCount: 0
    });
    showToast('🚨 대통령이 탄핵되었습니다!');
  }
  renderPresidentPanel();
};

// ===== 최저임금 패널 =====
function renderWagePanel() {
  const el = document.getElementById('wage-content');
  if (!el) return;
  const uid = auth.currentUser?.uid;
  const user = allUsers[uid];
  const isPresident = currentPresident?.uid === uid;
  const wageVoteActive = govState.wageVoteActive;
  const wageProposals = govState.wageProposals || {};
  const myVote = govState.wageVotes?.[uid];

  el.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">현재 최저임금</span>
      <span class="stat-val yellow">₩${currentMinWage.toLocaleString()}/월</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">실업자 지원금</span>
      <span class="stat-val">₩${Math.floor(currentMinWage/2).toLocaleString()}/월</span>
    </div>
    <hr class="divider">

    ${wageVoteActive && !isPresident ? `
      <div class="card-title">💬 최저임금 회의 (대통령 제외)</div>
      <div class="form-group">
        <label>제안 금액</label>
        <input type="number" id="wage-proposal" value="${currentMinWage}" min="1000000" step="100000">
        <button class="btn btn-sm mt8" onclick="submitWageProposal()">제안</button>
      </div>
      <div style="margin-top:12px">
        ${Object.entries(wageProposals).map(([puid, p]) => `
          <div class="list-item" style="margin-bottom:6px">
            <div><div class="list-item-name">${allUsers[puid]?.nick}</div><div class="list-item-sub">${allUsers[puid]?.party}</div></div>
            <div>
              <div class="stat-val yellow">₩${p.amount.toLocaleString()}</div>
              ${!myVote ? `<button class="btn btn-sm btn-blue" onclick="voteWage('${puid}')">지지</button>` : ''}
            </div>
          </div>`).join('')}
      </div>
      ${myVote ? '<div class="badge badge-green">✅ 투표 완료</div>' : ''}
    ` : '<div class="text-sm">선거 후 최저임금 회의가 진행됩니다</div>'}
  `;
}

window.submitWageProposal = async () => {
  const uid = auth.currentUser?.uid;
  const amount = parseInt(document.getElementById('wage-proposal').value);
  if (amount < 1000000) { showToast('최저 ₩1,000,000 이상'); return; }
  await update(ref(db, `government/wageProposals/${uid}`), { amount, time: Date.now() });
  showToast('💬 최저임금 제안 등록!');
};

window.voteWage = async (proposerUid) => {
  const uid = auth.currentUser?.uid;
  await update(ref(db, `government/wageVotes`), { [uid]: proposerUid });

  // 과반수 채택
  const govUsers = Object.entries(allUsers).filter(([k, v]) => v.party && k !== currentPresident?.uid);
  const threshold = Math.ceil(govUsers.length / 2);
  const votes = govState.wageVotes || {};
  const tally = {};
  Object.values(votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
  const winner = Object.entries(tally).find(([k, v]) => v >= threshold);
  if (winner) {
    const newWage = govState.wageProposals?.[winner[0]]?.amount;
    if (newWage) {
      await update(ref(db, 'government'), { minWage: newWage, wageVoteActive: false, wageProposals: {}, wageVotes: {} });
      showToast(`✅ 최저임금 ₩${newWage.toLocaleString()}으로 결정!`);
    }
  }
  renderWagePanel();
};