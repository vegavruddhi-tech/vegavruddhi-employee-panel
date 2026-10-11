import React from 'react';

const ITEMS = Array(6).fill(null);

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-track">
        {ITEMS.map((_, i) => (
          <div className="footer-item" key={i}>
            <img src="/logo-full.png" alt="Synchronous Build Digital" className="footer-logo" />
            <span className="footer-text">Synchronous Build Digital</span>
            <span className="footer-dot">·</span>
            <span className="footer-tagline">Digital &amp; Technology Solutions</span>
          </div>
        ))}
      </div>
    </footer>
  );
}
