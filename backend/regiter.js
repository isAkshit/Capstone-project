import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBXOkUfLNOsrvZBx0YYB8snHnH22OIzLx8",
  authDomain: "login-9f793.firebaseapp.com",
  projectId: "login-9f793",
  storageBucket: "login-9f793.firebasestorage.app",
  messagingSenderId: "1084587611055",
  appId: "1:1084587611055:web:d1017d99d094536d45155a",
  measurementId: "G-GJ3850QPL9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const submit = document.getElementById("loginBtn");

// Google Sign-In
const googleProvider = new GoogleAuthProvider();

// Expose to login.html (button onclick="handleGoogleLogin()")
window.handleGoogleLogin = async () => {
  // signInWithPopup requires the OAuth provider to be enabled in Firebase console
  try {
    const result = await signInWithPopup(auth, googleProvider);
    // You can store / read result.user here
    window.location.href = "homepage/index.html";
  } catch (err) {
    console.error("Google sign-in failed:", err);
    alert(err?.message || "Google sign-in failed");
  }
};
// Optional: only prompt for accounts linked to your domain
// googleProvider.setCustomParameters({ hd: "yourcompany.com" });

if (submit) {
  submit.addEventListener("click", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {

      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = userCredential.user;

      window.location.href = "homepage/index.html";

    } catch (error) {

      console.error(error);

      alert(error.message);
    }
  });
}
