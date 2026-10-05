export const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : (process.env.REACT_APP_API_URL || '');

export function isValidToken(token) {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) return false;
  try {
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    if (!payload || typeof payload !== 'object') return false;
    if (payload.exp && typeof payload.exp === 'number') {
      if (Date.now() >= payload.exp * 1000) return false;
    }
    if (!payload.email && !payload.id && !payload._id && !payload.sub && !payload.role) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}
