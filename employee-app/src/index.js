import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

// In development / localhost, clean up any service worker to prevent infinite reload loops
if (isLocalhost && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (let registration of registrations) {
      registration.unregister();
    }
  });
}

// Register service worker for PWA functionality ONLY in production
if (!isLocalhost && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('? PWA Service Worker registered successfully:', registration.scope);
        
        // Check for updates every hour
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('?? New version available! Activating automatically...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('? Service Worker registration failed:', error);
      });

    // Automatically reload the page when the new service worker takes over in production
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
