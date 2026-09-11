// Firebase v12 modular SDK, loaded straight from Google's CDN as native ES modules
// -- no build step / bundler needed, works with this project's plain-HTML setup.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

// Public web config -- safe to expose client-side, this is how every Firebase
// web app ships. Real security comes from Firebase Security Rules + this
// project's App Check / reCAPTCHA setup, not from hiding these values.
const firebaseConfig = {
  apiKey: "AIzaSyDSI_08fNbC7yBmKaDSSMSXKIqi2t0wW7w",
  authDomain: "jharkhandsamadhansetu.firebaseapp.com",
  projectId: "jharkhandsamadhansetu",
  storageBucket: "jharkhandsamadhansetu.firebasestorage.app",
  messagingSenderId: "815662045190",
  appId: "1:815662045190:web:e09f191f8556f9bd1ecb87",
};
// Analytics deliberately left out: it's not needed for auth, and pulling in
// tracking on a government login page is a call this project shouldn't make
// silently. Add it back deliberately later if you actually want it.

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let recaptchaVerifier = null;
let activeConfirmation = null; // holds the confirmationResult between "send OTP" and "verify OTP"

/**
 * Renders the invisible reCAPTCHA Firebase needs before it will send an SMS.
 * Call this once, after the page's DOM (and the #recaptcha-container div) exists.
 */
export function setupRecaptcha(containerId) {
  if (recaptchaVerifier) return recaptchaVerifier;
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  return recaptchaVerifier;
}

/**
 * Sends a real SMS OTP to a 10-digit Indian mobile number (no country code).
 * Returns nothing on success; throws a bilingual, user-facing Error on failure.
 */
export async function sendOtp(tenDigitNumber) {
  if (!/^[6-9]\d{9}$/.test(tenDigitNumber)) {
    throw new Error("कृपया मान्य 10 अंकों का मोबाइल नंबर दर्ज करें / Enter a valid 10-digit mobile number");
  }
  const verifier = setupRecaptcha("recaptcha-container");
  const phoneNumber = `+91${tenDigitNumber}`;

  try {
    activeConfirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  } catch (err) {
    activeConfirmation = null;
    throw new Error(mapFirebaseError(err));
  }
}

/**
 * Confirms the 6-digit code the citizen typed in. Resolves with the
 * Firebase user object ({ uid, phoneNumber, ... }) on success.
 */
export async function verifyOtp(code) {
  if (!activeConfirmation) {
    throw new Error("पहले OTP भेजें / Send an OTP first");
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error("कृपया 6 अंकों का ओटीपी दर्ज करें / Please enter a valid 6-digit OTP");
  }
  try {
    const result = await activeConfirmation.confirm(code);
    activeConfirmation = null;
    return result.user;
  } catch (err) {
    throw new Error(mapFirebaseError(err));
  }
}

function mapFirebaseError(err) {
  const code = err && err.code;
  const known = {
    "auth/billing-not-enabled": "OTP सेवा अभी सक्रिय नहीं है (Blaze plan आवश्यक) / OTP service isn't enabled yet (requires Firebase Blaze plan)",
    "auth/invalid-phone-number": "अमान्य मोबाइल नंबर / Invalid mobile number",
    "auth/too-many-requests": "बहुत अधिक प्रयास, कृपया बाद में पुनः प्रयास करें / Too many attempts, please try again later",
    "auth/invalid-verification-code": "गलत OTP, कृपया पुनः जांचें / Incorrect OTP, please check and try again",
    "auth/code-expired": "OTP समय सीमा समाप्त, नया OTP भेजें / OTP expired, request a new one",
    "auth/quota-exceeded": "आज की SMS सीमा पूरी हो गई / Today's SMS quota has been used up",
  };
  return known[code] || `कुछ गलत हुआ, कृपया पुनः प्रयास करें / Something went wrong, please try again (${code || "unknown error"})`;
}

// Exposed for the inline onclick/onsubmit handlers already in login.html.
window.__firebaseAuth = { sendOtp, verifyOtp };
