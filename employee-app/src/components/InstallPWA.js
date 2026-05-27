import React, { useState, useEffect } from 'react';

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Listen for the beforeinstallprompt event
    const handler = (e) => {
      console.log('[PWA] beforeinstallprompt event fired');
      e.preventDefault();
      setDeferredPrompt(e);
      
      // Show install prompt after 3 seconds (give user time to see the page)
      setTimeout(() => {
        setShowInstallPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Listen for successful installation
    window.addEventListener('appinstalled', () => {
      console.log('[PWA] App installed successfully');
      setIsInstalled(true);
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      console.log('[PWA] No deferred prompt available');
      return;
    }

    console.log('[PWA] Showing install prompt');
    deferredPrompt.prompt();

    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] User choice:', outcome);

    if (outcome === 'accepted') {
      console.log('[PWA] User accepted the install prompt');
      setShowInstallPrompt(false);
    } else {
      console.log('[PWA] User dismissed the install prompt');
    }

    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowInstallPrompt(false);
    // Show again after 24 hours
    localStorage.setItem('pwa-dismissed', Date.now().toString());
  };

  // Don't show if already installed or no prompt available
  if (isInstalled || !showInstallPrompt) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9998,
          animation: 'fadeIn 0.3s ease',
        }}
      />

      {/* Install Popup */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '90%',
          width: 400,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          zIndex: 9999,
          animation: 'slideUp 0.4s ease',
          overflow: 'hidden',
        }}
      >
        {/* Header with gradient */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1a4731 0%, #40916c 100%)',
            padding: '20px',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 8 }}>📱</div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Install Vegavruddhi App
          </h3>
          <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.9 }}>
            Get quick access from your home screen
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a4731', marginBottom: 2 }}>
                  Faster Access
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  Launch instantly from your home screen
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>📴</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a4731', marginBottom: 2 }}>
                  Works Offline
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  Access key features without internet
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a4731', marginBottom: 2 }}>
                  Stay Updated
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  Get notifications for important updates
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleDismiss}
              style={{
                flex: 1,
                padding: '12px',
                background: '#f5f5f5',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                color: '#666',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.target.style.background = '#e0e0e0')}
              onMouseLeave={(e) => (e.target.style.background = '#f5f5f5')}
            >
              Later
            </button>
            <button
              onClick={handleInstall}
              style={{
                flex: 2,
                padding: '12px',
                background: 'linear-gradient(135deg, #1a4731 0%, #40916c 100%)',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                color: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 12px rgba(26, 71, 49, 0.3)',
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 6px 16px rgba(26, 71, 49, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 12px rgba(26, 71, 49, 0.3)';
              }}
            >
              Install Now
            </button>
          </div>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
