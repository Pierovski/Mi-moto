// firebase.js - Sistema Multiusuario con Firebase Auth + Cloud Firestore
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBQSNPrIFPuLk0JJrcqdH6gPOsnoJhujrw",
  authDomain: "mi-moto-n160.firebaseapp.com",
  projectId: "mi-moto-n160",
  storageBucket: "mi-moto-n160.firebasestorage.app",
  messagingSenderId: "910405935632",
  appId: "1:910405935632:web:6a09398a86dc3363036095"
};

const USERS_COLLECTION = 'mimoto_usuarios';

let app = null;
let db = null;
let auth = null;
let currentUser = null;
let syncTimer = null;

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

function initFirebaseServices() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  }
  return { db, auth };
}

export function getCurrentUser() {
  return currentUser;
}

// Escucha en tiempo real si el motero inició o cerró sesión
export function subscribeToAuthChanges(callback) {
  const { auth: authInstance } = initFirebaseServices();
  onAuthStateChanged(authInstance, (user) => {
    currentUser = user || null;
    if (callback) callback(currentUser);
  });
}

// Iniciar sesión con Correo y Contraseña
export async function loginPilot(email, password) {
  const { auth: authInstance } = initFirebaseServices();
  const cred = await signInWithEmailAndPassword(authInstance, email.trim(), password);
  return cred.user;
}

// Registrar un nuevo motero en el club
export async function registerPilot(email, password) {
  const { auth: authInstance } = initFirebaseServices();
  const cred = await createUserWithEmailAndPassword(authInstance, email.trim(), password);
  return cred.user;
}

// Cerrar sesión
export async function logoutPilot() {
  const { auth: authInstance } = initFirebaseServices();
  await signOut(authInstance);
}

// Sube el estado únicamente a la bóveda privada del usuario autenticado (UID)
export async function pushStateToCloud(stateObj) {
  const { db: database } = initFirebaseServices();
  if (!currentUser) {
    throw new Error('Debes iniciar sesión para respaldar en la nube.');
  }

  const ref = doc(database, USERS_COLLECTION, currentUser.uid);
  const payload = {
    ...stateObj,
    ownerEmail: currentUser.email || '',
    lastCloudSync: new Date().toISOString()
  };

  await setDoc(ref, payload, { merge: true });
  return payload.lastCloudSync;
}

// Descarga el estado únicamente de la bóveda privada del usuario autenticado (UID)
export async function pullStateFromCloud() {
  const { db: database } = initFirebaseServices();
  if (!currentUser) {
    throw new Error('Debes iniciar sesión para descargar tu respaldo.');
  }

  const ref = doc(database, USERS_COLLECTION, currentUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }
  return snap.data();
}

// Auto-guardado silencioso solo si el motero tiene sesión activa
export function scheduleAutoCloudSync(stateObj, onStatusChange) {
  if (!isFirebaseConfigured() || !navigator.onLine || !currentUser) return;

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      if (onStatusChange) onStatusChange('syncing');
      await pushStateToCloud(stateObj);
      if (onStatusChange) onStatusChange('ok');
    } catch (err) {
      console.warn('Auto-sync diferido:', err.message);
      if (onStatusChange) onStatusChange('error');
    }
  }, 1500);
}
