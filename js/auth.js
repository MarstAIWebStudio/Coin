// js/auth.js
import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// 전역 상태
export let currentUser = null;
export let myProfile = null;

// ===== AUTH TAB =====
window.switchAuthTab = (tab) => {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0) === (tab === 'login'))
  );
  document.getElementById('tab-login').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('tab-signup').style.display = tab === 'signup' ? '' : 'none';
};

// ===== LOGIN =====
window.doLogin = async () => {
  const e = document.getElementById('login-email').value;
  const p = document.getElementById('login-pw').value;
  try {
    await signInWithEmailAndPassword(auth, e, p);
  } catch (err) {
    document.getElementById('login-msg').textContent = '로그인 실패: ' + err.message;
  }
};

// ===== SIGNUP =====
window.doSignup = async () => {
  const e = document.getElementById('su-email').value;
  const n = document.getElementById('su-nick').value.trim();
  const p = document.getElementById('su-pw').value;
  if (!n) { document.getElementById('signup-msg').textContent = '닉네임을 입력하세요'; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, e, p);
    await updateProfile(cred.user, { displayName: n });
    await set(ref(db, `users/${cred.user.uid}`), {
      nick: n, email: e,
      cash: 500000, // 초기 자금
      house: 0,
      inventory: {},
      companies: [],
      party: null,
      lastMeal: null,
      unemployedSince: Date.now()
    });
  } catch (err) {
    document.getElementById('signup-msg').textContent = '가입 실패: ' + err.message;
  }
};

// ===== LOGOUT =====
window.doLogout = async () => { await signOut(auth); };

// ===== SETUP =====
window.showCompanySetup = () => { showScreen('company-setup'); };
window.startAsUnemployed = async () => {
  await set(ref(db, `users/${currentUser.uid}/unemployedSince`), Date.now());
  window.initApp && window.initApp();
  showScreen('app');
};

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  if (!user) { showScreen('auth'); return; }
  currentUser = user;

  const snap = await get(ref(db, `users/${user.uid}`));
  if (!snap.exists()) { showScreen('auth'); return; }

  myProfile = snap.val();
  document.getElementById('topbar-nick').textContent = user.displayName || user.email;

  // 회사 있으면 바로 앱으로
  const hasCompany = myProfile.companies && myProfile.companies.length > 0;
  if (hasCompany || myProfile.unemployedSince) {
    showScreen('app');
    window.initApp && window.initApp();
  } else {
    showScreen('setup');
  }

  // 실시간 프로필 구독
  onValue(ref(db, `users/${user.uid}`), snap => {
    myProfile = snap.val();
    window.updateTopbar && window.updateTopbar();
  });
});

// ===== SHOW SCREEN =====
window.showScreen = (s) => {
  const screens = ['auth', 'setup', 'company-setup', 'app'];
  screens.forEach(id => {
    const el = document.getElementById(id + '-screen');
    if (!el) return;
    el.style.display = 'none';
  });
  const target = document.getElementById(s + '-screen');
  if (target) {
    target.style.display = s === 'setup' || s === 'company-setup' ? 'flex' : '';
    if (s === 'app') target.style.display = 'block';
    if (s === 'auth') target.style.display = 'flex';
  }
};