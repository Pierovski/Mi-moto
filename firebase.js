// firebase.js - Sincronización en la nube con Cloud Firestore (Modular SDK)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// 1. REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO EN FIREBASE CONSOLE
const firebaseConfig = {
  apiKey: "AIzaSyBQSNPrIFPuLk0JJrcqdH6gPOsnoJhujrw",
  authDomain: "mi-moto-n160.firebaseapp.com",
  projectId: "mi-moto-n160",
  storageBucket: "mi-moto-n160.firebasestorage.app",
  messagingSenderId: "910405935632",
  appId: "1:910405935632:web:6a09398a86dc3363036095"
};

// ID único del documento en Firestore donde se guardará tu Pulsar N160
const CLOUD_COLLECTION = 'mimoto_unidades';
const CLOUD_DOC_ID = 'pulsar_n160_principal';

let db = null;
let syncTimer = null;

export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes('PEGA_AQUI') &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'tu-proyecto'
  );
}

function getDbInstance() {
  if (!isFirebaseConfigured()) return null;
  if (!db) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

// Sube todo el estado actual a Firestore
export async function pushStateToCloud(stateObj) {
  const database = getDbInstance();
  if (!database) {
    throw new Error('Falta configurar las credenciales en firebase.js');
  }

  const ref = doc(database, CLOUD_COLLECTION, CLOUD_DOC_ID);
  const payload = {
    ...stateObj,
    lastCloudSync: new Date().toISOString()
  };

  await setDoc(ref, payload, { merge: true });
  return payload.lastCloudSync;
}

// Descarga el estado guardado en Firestore
export async function pullStateFromCloud() {
  const database = getDbInstance();
  if (!database) {
    throw new Error('Falta configurar las credenciales en firebase.js');
  }

  const ref = doc(database, CLOUD_COLLECTION, CLOUD_DOC_ID);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }
  return snap.data();
}

// Sincronización automática silenciosa con espera de 1.5s (Debounce) para ahorrar cuota
export function scheduleAutoCloudSync(stateObj, onStatusChange) {
  if (!isFirebaseConfigured() || !navigator.onLine) return;

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
