// Base URL for API calls — uses env var in production, empty string locally (proxy handles it)
export const API_BASE = process.env.REACT_APP_API_URL || '';
