// The frontend and API are deployed as separate Render services, so a built
// site has to call the API by its full URL. Locally, Vite serves the frontend
// on its own port and the API runs on 5000.
// Set VITE_API_URL to override either (e.g. a staging backend).
const DEFAULT_API_URL = import.meta.env.PROD
  ? "https://dashboard-68wk.onrender.com"
  : "http://localhost:5000";

export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

// Admin dashboard gate. Change these in frontend/.env.
// NOTE: Vite inlines env vars into the bundle, so this is a light gate for a
// demo, not real auth — anyone can read it from the shipped JS.
export const ADMIN_USER = import.meta.env.VITE_ADMIN_USER || "admin";
export const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASS || "Tradotsav@2026";
