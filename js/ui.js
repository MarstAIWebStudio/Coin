// js/ui.js

// ===== TOAST =====
window.showToast = (msg, duration = 3000) => {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// ===== MODAL =====
window.showModal = (title, bodyHTML, buttons = []) => {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const btnsEl = document.getElementById('modal-btns');
  btnsEl.innerHTML = '';
  if (buttons.length === 0) {
    const b = document.createElement('button');
    b.className = 'btn btn-outline btn-sm'; b.textContent = '닫기';
    b.onclick = closeModal;
    btnsEl.appendChild(b);
  } else {
    buttons.forEach(({ text, cls, action }) => {
      const b = document.createElement('button');
      b.className = cls || 'btn btn-sm'; b.textContent = text;
      b.onclick = action;
      btnsEl.appendChild(b);
    });
  }
  document.getElementById('modal-overlay').classList.add('show');
};

window.closeModal = () => {
  document.getElementById('modal-overlay').classList.remove('show');
};

// 오버레이 클릭 시 닫기
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});