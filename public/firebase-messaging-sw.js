importScripts("https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyC_lhTevsT8w4LewsmiJq8pgYsV4uoAHWU",
  authDomain: "daylock-2818b.firebaseapp.com",
  projectId: "daylock-2818b",
  storageBucket: "daylock-2818b.firebasestorage.app",
  messagingSenderId: "367551063143",
  appId: "1:367551063143:web:2a6146c8dc3459432a60c2"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "DAYLOCK";
  const options = {
    body: payload.notification?.body || "Your reminder is ready.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.data?.tag || "daylock-reminder",
    data: { url: payload.data?.url || "/" }
  };
  self.registration.showNotification(title, options);
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) if ("focus" in client) { client.navigate(target); return client.focus(); }
    return clients.openWindow(target);
  }));
});
