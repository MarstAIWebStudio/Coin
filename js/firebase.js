// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBjDStORXyndC4DfiQWKkcUTQht2vw1VlM",
  authDomain: "coin-49a29.firebaseapp.com",
  projectId: "coin-49a29",
  storageBucket: "coin-49a29.firebasestorage.app",
  messagingSenderId: "106219083457",
  appId: "1:106219083457:web:50ff6a6ac0c8589d692640",
  databaseURL: "https://coin-49a29-default-rtdb.firebaseio.com"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getDatabase(firebaseApp);