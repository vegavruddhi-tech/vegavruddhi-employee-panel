import React from 'react';

const ITEMS = Array(6).fill(null);

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-track">
        {ITEMS.map((_, i) => (
          <div className="footer-item" key={i}>
            <img src="https://res.cloudinary.com/dhhcykoqa/image/upload/v1775158486/logo-full_ueklky.png
" alt="" className="footer-logo" />
            <span className="footer-text">Vegavruddhi Pvt. Ltd.</span>
            <span className="footer-dot">·</span>
            <span className="footer-tagline">IT &amp; Business Consultation Services</span>
          </div>
        ))}
      </div>
    </footer>
  );
}
