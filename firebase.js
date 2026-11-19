// firebase.js - Sistema Multiusuario Blindado con Firebase Auth + Cloud Firestore (v5.0)
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
  sendPasswordResetEmail,
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

export function getFriendlyAuthError(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'La contraseña ingresada es incorrecta.',
    'auth/user-not-found': 'No existe una cuenta registrada con ese correo.',
    'auth/email-already-in-use': 'Ese correo ya está registrado. Inicia sesión o recupera tu clave.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/invalid-email': 'El formato del correo electrónico no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
    'auth/network-request-failed': 'Sin conexión a internet. Verifica tu señal móvil o Wi-Fi.',
    'auth/user-disabled': 'Esta cuenta ha sido deshabilitada.',
    'permission-denied': 'Permiso denegado en Firestore. Revisa las reglas de seguridad.'
  };
  return map[code] || err?.message || 'Error de conexión con la nube.';
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

// Enviar correo oficial de recuperación de contraseña
export async function resetPilotPassword(email) {
  const { auth: authInstance } = initFirebaseServices();
  await sendPasswordResetEmail(authInstance, email.trim());
  return true;
}

// Cerrar sesión
export async function logoutPilot() {
  const { auth: authInstance } = initFirebaseServices();
  await signOut(authInstance);
}

// Consulta metadatos ligeros del respaldo actual en la nube
export async function getCloudBackupMeta() {
  const { db: database } = initFirebaseServices();
  if (!currentUser) return null;

  const ref = doc(database, USERS_COLLECTION, currentUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { exists: false, currentKm: 0, logsCount: 0, fuelLogsCount: 0, lastCloudSync: null };
  }
  const d = snap.data() || {};
  return {
    exists: true,
    currentKm: Number(d.currentKm) || 0,
    logsCount: Array.isArray(d.logs) ? d.logs.length : 0,
    fuelLogsCount: Array.isArray(d.fuelLogs) ? d.fuelLogs.length : 0,
    lastCloudSync: d.lastCloudSync || null
  };
}

// Sube el estado limpio (SIN imágenes Base64 pesadas) y con protección anti-sobrescritura
export async function pushStateToCloud(stateObj, options = {}) {
  const { forceOverwrite = false } = options;
  const { db: database } = initFirebaseServices();
  if (!currentUser) {
    throw new Error('Debes iniciar sesión para respaldar en la nube.');
  }

  const ref = doc(database, USERS_COLLECTION, currentUser.uid);

  // Protección anti-sobrescritura: evita pisar un respaldo real con un celular nuevo en 0 km
  if (!forceOverwrite) {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const cloud = snap.data() || {};
      const cloudKm = Number(cloud.currentKm) || 0;
      const localKm = Number(stateObj?.currentKm) || 0;
      const cloudRecords = (Array.isArray(cloud.logs) ? cloud.logs.length : 0) + (Array.isArray(cloud.fuelLogs) ? cloud.fuelLogs.length : 0);
      const localRecords = (Array.isArray(stateObj?.logs) ? stateObj.logs.length : 0) + (Array.isArray(stateObj?.fuelLogs) ? stateObj.fuelLogs.length : 0);

      const isLowerKm = cloudKm > localKm;
      const isEmptyOverPopulated = localRecords === 0 && cloudRecords > 0;

      if (isLowerKm || isEmptyOverPopulated) {
        const conflictErr = new Error('La nube tiene un respaldo más completo o con mayor kilometraje.');
        conflictErr.code = 'CLOUD_CONFLICT_HIGHER_DATA';
        conflictErr.cloudMeta = {
          currentKm: cloudKm,
          logsCount: Array.isArray(cloud.logs) ? cloud.logs.length : 0,
          fuelLogsCount: Array.isArray(cloud.fuelLogs) ? cloud.fuelLogs.length : 0,
          lastCloudSync: cloud.lastCloudSync || null
        };
        throw conflictErr;
      }
    }
  }

  // Excluir imágenes Base64 del documento Firestore (límite 1 MiB y ahorro de datos móviles)
  const sanitized = { ...stateObj };
  delete sanitized.logoBase64;
  delete sanitized.bikePhotoBase64;

  const payload = {
    ...sanitized,
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
