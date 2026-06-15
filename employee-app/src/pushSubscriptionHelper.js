const PUBLIC_VAPID_KEY = process.env.REACT_APP_PUBLIC_VAPID_KEY || 'BMaBuxmwHuqXDdgHQqht9ULvVJ0-G76Y6EqPB_r0i93t3r_rfClWzy4tTY1cqnbCl43D0KeuV-E2OdKqK44wM7k';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeUserToPush(apiBaseUrl, token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push messaging is not supported in this browser.');
    return;
  }

  try {
    // Wait for the service worker registration to be ready
    const registration = await navigator.serviceWorker.ready;
    
    // Check/Request permission
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    
    if (permission !== 'granted') {
      console.warn('Notification permission was not granted.');
      return;
    }

    // Subscribe to push notifications
    const subscribeOptions = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
    };

    const subscription = await registration.pushManager.subscribe(subscribeOptions);
    console.log('✅ Push Subscription created:', subscription);

    // Send subscription to backend
    const response = await fetch(`${apiBaseUrl}/api/auth/save-push-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ subscription })
    });

    if (response.ok) {
      console.log('✅ Push subscription saved to backend successfully.');
    } else {
      console.error('❌ Failed to save push subscription to backend:', response.statusText);
    }
  } catch (error) {
    console.error('❌ Error during push subscription registration:', error);
  }
}
