// FLAT ORDER — Firebase yapılandırması
// Bu dosya nadiren değişir; güncellemelerde genelde sadece app.js taşınır.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB0ueT4_i49iWnGE2gUv2dfh3UdNSLZzL4",
  authDomain: "flat-order.firebaseapp.com",
  projectId: "flat-order",
  storageBucket: "flat-order.firebasestorage.app",
  messagingSenderId: "420750510371",
  appId: "1:420750510371:web:ed32519ed7a0c20fe9e496"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Panel yetkisi: bu mailler + Firestore'da adminApproved=true olan üyeler
export const ADMIN_EMAILS = ["doguhansezgin@gmail.com", "55onurberber@gmail.com"];
