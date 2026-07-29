// In a production build the backend serves these files, so an empty base means
// same-origin requests (/api/...) and no CORS. In dev, Vite serves the frontend
// on its own port, so point at the local backend.
// Override either with VITE_API_URL when the API lives on a different host.
const DEFAULT_API_URL = import.meta.env.PROD ? "" : "http://localhost:5000";
export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

// Admin dashboard gate. Change these in frontend/.env.
// NOTE: Vite inlines env vars into the bundle, so this is a light gate for a
// demo, not real auth — anyone can read it from the shipped JS.
export const ADMIN_USER = import.meta.env.VITE_ADMIN_USER || "admin";
export const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASS || "Tradotsav@2026";
