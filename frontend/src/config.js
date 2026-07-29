// Point at the local backend by default (mock JSON store, no Atlas needed).
// Override per-environment in frontend/.env -> VITE_API_URL=https://your-server
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// Admin dashboard gate. Change these in frontend/.env.
// NOTE: Vite inlines env vars into the bundle, so this is a light gate for a
// demo, not real auth — anyone can read it from the shipped JS.
export const ADMIN_USER = import.meta.env.VITE_ADMIN_USER || "admin";
export const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASS || "Tradotsav@2026";
