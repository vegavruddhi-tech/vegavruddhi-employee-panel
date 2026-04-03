import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Navbar({ emp }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const logout = (e) => {
    e.preventDefault();
    localStorage.clear();
    navigate('/');
  };

  const initials = emp?.newJoinerName
    ? emp.newJoinerName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <nav className="navbar">
      <div className="nav-logo">
        <a href="/dashboard" onClick={e => { e.preventDefault(); navigate('/dashboard'); }}>
          <img src="https://res.cloudinary.com/dhhcykoqa/image/upload/v1775158486/logo-full_ueklky.png" alt="Vegavruddhi Pvt. Ltd." />
        </a>
      </div>
      <div className="nav-right">
        <div className="nav-profile" ref={ref} onClick={(e) => { if (e.target.closest('a')) return; setOpen(p => !p); }}>
          <div className="nav-avatar">
            {emp?.image
  ? <img src={emp.image} />
              : initials}
          </div>
          <div className="nav-info">
            <div className="name">{emp?.newJoinerName || 'Loading...'}</div>
            <div className="status-badge">{emp?.status || 'Active'}</div>
          </div>
          <span className="nav-chevron">▾</span>
          <div className={`dropdown-menu${open ? ' open' : ''}`}>
            <div className="dropdown-header">
              <div className="dh-name">{emp?.newJoinerName || '–'}</div>
              <div className="dh-email">{emp?.email || '–'}</div>
            </div>
            <a href="/dashboard" onClick={e => { e.preventDefault(); navigate('/dashboard'); }}>🏠&nbsp; Dashboard</a>
            <a href="/profile"   onClick={e => { e.preventDefault(); navigate('/profile'); }}>👤&nbsp; My Profile</a>
            <a href="#logout" className="logout" onClick={logout}>🚪&nbsp; Logout</a>
          </div>
        </div>
      </div>
    </nav>
  );
}
