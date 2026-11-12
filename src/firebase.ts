import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'

// Firebase's web config identifies this project. It is not a service-account key.
// Secure access through Authentication and Firestore Security Rules, not by hiding this config.
const firebaseConfig = {
  apiKey: 'AIzaSyC_lhTevsT8w4LewsmiJq8pgYsV4uoAHWU',
  authDomain: 'daylock-2818b.firebaseapp.com',
  projectId: 'daylock-2818b',
  storageBucket: 'daylock-2818b.firebasestorage.app',
  messagingSenderId: '367551063143',
  appId: '1:367551063143:web:2a6146c8dc3459432a60c2',
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence)

export const vapidPublicKey = 'BGt9MBYqoQv2iquy9iZaNlyBnT80D4jyeMOGTh_AbxUFzZ5r13DDYYTho647JTc__--m7CbG02FWZ05Zk8CgfN8'
export async function getDaylockMessaging() {
  if (!(await isSupported())) return null
  return getMessaging(app)
}
