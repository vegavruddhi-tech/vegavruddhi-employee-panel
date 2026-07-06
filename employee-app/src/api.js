export const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : (process.env.REACT_APP_API_URL || '');
