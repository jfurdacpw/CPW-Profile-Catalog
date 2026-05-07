import { useState, useEffect, useMemo, useCallback, useRef } from "react";

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const SUPABASE_URL = "https://sijlcyodgwdovauqcikj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7b_OXz7BAZN1--StKqOSfg_ElbHo5OA";
const PROFILE_FILES_BUCKET = "profile-files";

const CREDENTIALS = {
  cpw: { password: "cpw2026", role: "viewer" },
  admin: { password: "admin2026", role: "admin" },
};

/** Loads pdf.min.js from CDN once; configures worker. */
let pdfJsLoadPromise = null;
function ensurePdfJs() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no window"));
  }
  if (!pdfJsLoadPromise) {
    pdfJsLoadPromise = new Promise((resolve, reject) => {
      const existing = globalThis.pdfjsLib;
      if (existing?.getDocument) {
        existing.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(existing);
        return;
      }
      const script = document.createElement("script");
      script.src = PDFJS_URL;
      script.async = true;
      script.onload = () => {
        const lib = globalThis.pdfjsLib;
        if (!lib?.getDocument) {
          reject(new Error("pdfjsLib not available"));
          return;
        }
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(lib);
      };
      script.onerror = () => reject(new Error("Failed to load pdf.js"));
      document.head.appendChild(script);
    });
  }
  return pdfJsLoadPromise;
}

async function supabaseFetch(path, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function supabasePatch(id, fields) {
  const path = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/profiles`;
  const url = new URL(path);
  url.searchParams.set("id", `eq.${id}`);
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const body = JSON.stringify(fields);
  const urlStr = url.toString();
  console.log("[supabasePatch] request", {
    url: urlStr,
    headers: { ...headers },
    body,
  });
  const res = await fetch(urlStr, {
    method: "PATCH",
    headers,
    body,
  });
  const responseText = await res.text();
  console.log("[supabasePatch] response", {
    status: res.status,
    ok: res.ok,
    body: responseText || "(empty)",
  });
  if (!res.ok) throw new Error(responseText || `${res.status} ${res.statusText}`);
}

/** Storage object key: scans/{name}.png (slashes in name stripped for safety). */
function scanStorageObjectPath(profileName) {
  const safe = String(profileName).replace(/[/\\]+/g, "");
  return `scans/${safe}.png`;
}

const CATEGORIES = [
  "Trim", "Baseboard", "Panel Molding", "Cove Molding", "Edge Profile",
  "Miscellaneous", "Casing", "Cope and Stick", "Wainscoting",
  "Jointery", "Hand Rail", "Chair Rail",
  "Crown Molding", "Bullnose", "Picture Moulding", "door casing",
  "groove/tounge", "cove molding", "trim", "hand rail", "Miscelaneous",
];

const TOOL_TYPES = ["Profile Knife", "Router Bit"];
const LOD = ["Simple", "Moderate", "Complex"];

const FIELD_GROUPS = [
  {
    label: "Profile Info",
    fields: [
      { key: "profile_category", label: "Category" },
      { key: "tool_type", label: "Tool Type" },
      { key: "level_of_detail", label: "Detail Level" },
      { key: "manufacturer_number", label: "Manufacturer #" },
      { key: "location_in_cnc", label: "Location in CNC" },
      { key: "location_zone", label: "Zone" },
      { key: "location_zone_other", label: "Zone Other" },
      { key: "tag", label: "Tag" },
      { key: "usage_notes", label: "Usage Notes" },
      { key: "martin_sled", label: "Martin Sled" },
    ],
  },
  {
    label: "Dimensions",
    fields: [
      { key: "height", label: "Height", unit: "in" },
      { key: "width", label: "Width", unit: "in" },
      { key: "primary_radius", label: "Primary Radius", unit: "in" },
      { key: "secondary_radius", label: "Secondary Radius", unit: "in" },
      { key: "cutting_diameter", label: "Cutting Ø", unit: "in" },
      { key: "loc", label: "LoC", unit: "in" },
      { key: "shank_diameter", label: "Shank Ø", unit: "in" },
      { key: "oal", label: "OAL", unit: "in" },
      { key: "board_width", label: "Board Width", unit: "in" },
      { key: "board_thickness", label: "Board Thickness", unit: "in" },
    ],
  },
  {
    label: "CNC Settings",
    fields: [
      { key: "cnc_tool_number", label: "Tool #" },
      { key: "cnc_offset_number", label: "Offset #" },
      { key: "cnc_tool_length", label: "Tool Length", unit: "in" },
      { key: "cnc_tool_diameter", label: "Tool Ø", unit: "in" },
      { key: "cnc_spindle_rotation", label: "Spindle Rotation" },
      { key: "cnc_depth_of_cut", label: "Depth of Cut", unit: "in" },
      { key: "cnc_maximum_depth", label: "Max Depth", unit: "in" },
      { key: "cnc_spindle_speed", label: "Spindle Speed", unit: "RPM" },
      { key: "cnc_fixed_feed", label: "Fixed Feed", unit: "ipm" },
      { key: "cnc_fixed_down_feed", label: "Down Feed", unit: "ipm" },
    ],
  },
  {
    label: "Martin Settings",
    fields: [
      { key: "martin_spindle_height", label: "Spindle Height", unit: "mm" },
      { key: "martin_spindle_depth", label: "Spindle Depth", unit: "mm" },
      { key: "martin_feeder_height_background", label: "Feeder Height Bg", unit: "mm" },
    ],
  },
  {
    label: "Micron Settings",
    fields: [
      { key: "micron_tilt", label: "Tilt" },
      { key: "micron_fence", label: "Fence" },
      { key: "micron_cutterhead_height", label: "Cutterhead Height" },
      { key: "micron_tension", label: "Tension" },
      { key: "micron_feed_speed", label: "Feed Speed" },
    ],
  },
];

const NUMERIC_FIELDS = new Set(
  FIELD_GROUPS.flatMap((g) => g.fields.filter((f) => f.unit).map((f) => f.key))
);

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0f0f0e;
    --surface: #171714;
    --surface2: #1e1e1a;
    --border: #2a2a26;
    --accent: #c8a96e;
    --accent2: #8fba8f;
    --text: #e8e4dc;
    --muted: #6b6860;
    --mono: 'DM Mono', monospace;
    --display: 'Playfair Display', serif;
    --sans: 'DM Sans', sans-serif;
    --radius: 4px;
  }

  html, body { width: 100%; margin: 0; padding: 0; }
  #root { width: 100%; }

  body {
    background: var(--bg) !important;
    color: var(--text);
    font-family: var(--sans);
    min-height: 100vh;
  }

  .nav {
    position: sticky; top: 0; z-index: 100;
    width: 100%;
    background: var(--text);
    display: flex; align-items: center;
    gap: 24px; padding: 0 32px;
    height: 56px;
    border-bottom: 3px solid var(--accent);
  }

  .nav-logo {
    font-family: var(--display);
    font-size: 22px;
    color: var(--bg);
    letter-spacing: 0.05em;
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
  }

  .nav-logo span { color: var(--accent); }

  .nav-search {
    flex: 1;
    position: relative;
  }

  .nav-search input {
    width: 100%;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: var(--radius);
    color: #fff;
    font-family: var(--mono);
    font-size: 12px;
    padding: 8px 12px 8px 36px;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  .nav-search input:focus {
    border-color: var(--accent);
    background: rgba(255,255,255,0.12);
  }

  .nav-search input::placeholder { color: rgba(255,255,255,0.35); }

  .nav-search-icon {
    position: absolute; left: 11px; top: 50%;
    transform: translateY(-50%);
    color: rgba(255,255,255,0.4);
    font-size: 13px; pointer-events: none;
  }

  .nav-count {
    font-family: var(--mono);
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    letter-spacing: 0.06em;
    white-space: nowrap;
    margin-left: auto;
  }

  .nav-logout {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.5);
    border-radius: var(--radius);
    padding: 5px 10px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color 0.12s, color 0.12s;
  }
  .nav-logout:hover { border-color: var(--accent); color: var(--accent); }

  .login-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
  }
  .login-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 48px 40px;
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .login-logo {
    font-family: var(--display);
    font-size: 20px;
    color: var(--text);
    letter-spacing: 0.05em;
    text-align: center;
  }
  .login-logo span { color: var(--accent); }
  .login-subtitle {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    text-align: center;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-top: -12px;
  }
  .login-field { display: flex; flex-direction: column; gap: 6px; }
  .login-label {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .login-input {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    padding: 10px 12px;
    outline: none;
    transition: border-color 0.15s;
  }
  .login-input:focus { border-color: var(--accent); }
  .login-error {
    font-family: var(--mono);
    font-size: 11px;
    color: #e07070;
    letter-spacing: 0.04em;
  }
  .login-btn {
    background: var(--accent);
    border: none;
    border-radius: var(--radius);
    color: #fff;
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 12px;
    cursor: pointer;
    margin-top: 4px;
    transition: opacity 0.15s;
  }
  .login-btn:hover { opacity: 0.88; }

  .filter-bar {
    width: 100%;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 10px 32px;
    display: flex; align-items: center;
    gap: 6px; flex-wrap: wrap;
  }

  .filter-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-right: 4px;
    white-space: nowrap;
  }

  .filter-chip {
    font-family: var(--mono);
    font-size: 10px;
    padding: 4px 10px;
    border-radius: 2px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.12s;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .filter-chip:hover { border-color: var(--accent); color: var(--accent); }
  .filter-chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  .grid-page { padding: 28px; }

  .grid {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }

  .card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.1);
    border-color: var(--accent);
  }

  .card-img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    background: var(--surface2);
    display: block;
    padding: 12px;
  }

  .card-placeholder {
    width: 100%;
    aspect-ratio: 1;
    background: var(--surface2);
    display: flex; align-items: center; justify-content: center;
    color: var(--muted);
    font-size: 32px;
  }

  .card-pdf-thumb {
    width: 100%;
    aspect-ratio: 1;
    background: var(--surface2);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .card-pdf-thumb .card-pdf-placeholder {
    position: absolute;
    inset: 0;
    z-index: 1;
    aspect-ratio: unset;
    height: 100%;
  }

  .card-pdf-thumb canvas {
    display: block;
    position: relative;
    z-index: 0;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .card-body {
    padding: 12px 14px;
    border-top: 1px solid var(--border);
  }

  .card-name {
    font-family: var(--display);
    font-size: 22px;
    color: var(--text);
    letter-spacing: 0.03em;
    line-height: 1;
    margin-bottom: 4px;
  }

  .card-meta {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-badges {
    display: flex; gap: 4px; flex-wrap: wrap;
    margin-top: 8px;
  }

  .card-badge {
    font-family: var(--mono);
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 2px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .badge-pdf { background: rgba(200,75,31,0.1); color: var(--accent); border: 1px solid rgba(200,75,31,0.25); }
  .badge-dwg { background: rgba(42,92,138,0.1); color: var(--accent2); border: 1px solid rgba(42,92,138,0.25); }
  .badge-scan { background: rgba(0,0,0,0.05); color: var(--muted); border: 1px solid var(--border); }

  .detail-page {
    height: calc(100vh - 56px);
    min-height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }

  .detail-back {
    display: flex; align-items: center; gap: 8px;
    padding: 16px 32px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    transition: color 0.12s;
  }

  .detail-back:hover { color: var(--accent); }

  .detail-hero {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: minmax(0, 1fr);
    align-items: stretch;
    padding: 0;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    min-height: 100vh;
  }

  .detail-hero > .detail-pdf-col,
  .detail-hero > .detail-right-col {
    min-height: 0;
  }

  .detail-pdf-col {
    width: 100%;
    height: 100%;
    min-height: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
  }

  .detail-pdf-placeholder {
    flex: 1;
    width: 100%;
    min-height: 0;
    height: 100%;
    border: 1px dashed var(--border);
    border-radius: 0;
    background: var(--surface2);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    padding: 8px;
  }

  .detail-right-col {
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }

  .detail-top-row {
    display: flex;
    align-items: stretch;
    gap: 16px;
    margin-bottom: 16px;
  }

  .detail-top-titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
    height: 100%;
  }

  .detail-top-aside {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 320px;
    flex-shrink: 0;
  }

  .detail-scan-col {
    width: 100%;
    flex-shrink: 0;
  }

  .detail-scan-small {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
    display: block;
  }

  .detail-scan-small-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    cursor: pointer;
    border-radius: var(--radius);
  }

  .detail-scan-small-wrap .detail-scan-small {
    width: 100%;
    height: 100%;
  }

  .detail-scan-replace-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
    border-radius: var(--radius);
  }

  .detail-scan-small-wrap:hover .detail-scan-replace-overlay,
  .detail-scan-small-wrap.uploading .detail-scan-replace-overlay {
    opacity: 1;
  }

  .detail-scan-small-placeholder {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface2);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    padding: 8px;
    cursor: pointer;
  }
  .detail-scan-small-placeholder:not([role="button"]) {
    cursor: default;
    pointer-events: none;
  }

  .detail-scan-small-placeholder.has-error {
    color: #c44;
    border-color: rgba(204, 68, 68, 0.45);
  }

  .detail-pdf-thumb {
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: none;
    border-radius: 0;
    background: var(--surface2);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0;
  }

  .detail-pdf-thumb .card-pdf-placeholder {
    position: absolute;
    inset: 0;
    z-index: 1;
    aspect-ratio: unset;
    height: 100%;
  }

  .detail-pdf-thumb canvas {
    width: 100%;
    height: 100%;
    min-height: 500px;
    flex: 1 1 auto;
    object-fit: contain;
  }

  .detail-num {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-align: center;
    margin-top: 0;
    margin-bottom: 8px;
  }

  .detail-name {
    font-family: var(--display);
    font-size: 64px;
    line-height: 0.95;
    color: var(--text);
    text-align: center;
    margin-bottom: 12px;
    letter-spacing: 0.02em;
  }

  .detail-desc {
    font-size: 15px;
    color: var(--muted);
    font-style: italic;
    text-align: center;
    margin-bottom: 20px;
  }

  .detail-badge-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 0;
  }

  .detail-top-aside .detail-badge-row {
    justify-content: flex-start;
  }

  .detail-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 4px 10px;
    border-radius: 2px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .db-category { background: rgba(200,75,31,0.1); color: var(--accent); border: 1px solid rgba(200,75,31,0.3); }
  .db-tool     { background: rgba(42,92,138,0.1); color: var(--accent2); border: 1px solid rgba(42,92,138,0.3); }
  .db-lod      { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }

  .detail-file-btns { display: flex; gap: 12px; flex-wrap: wrap; }

  .file-btn {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    padding: 10px 20px;
    border-radius: var(--radius);
    border: 2px solid var(--text);
    background: var(--text);
    color: var(--bg);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex; align-items: center; gap: 8px;
    transition: all 0.12s;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .file-btn:hover { background: var(--accent); border-color: var(--accent); }
  .file-btn.secondary { background: transparent; color: var(--text); }
  .file-btn.secondary:hover { background: var(--text); color: var(--bg); }

  .detail-fields {
    padding: 40px 0 48px 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }

  .group-label {
    font-family: var(--display);
    font-size: 20px;
    letter-spacing: 0.08em;
    color: var(--text);
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid var(--text);
    text-transform: uppercase;
  }

  .fields-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }

  .field-item { display: flex; flex-direction: column; gap: 2px; }
  .field-item.wide { grid-column: 1 / -1; }

  .field-label {
    font-family: var(--mono);
    font-size: 8px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .field-value { font-family: var(--mono); font-size: 11px; color: var(--text); }
  .field-value.empty { color: var(--border); }

  .field-value-readonly {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
    min-height: 1.25em;
    word-break: break-word;
  }
  .field-value-readonly.empty { color: var(--border); font-style: italic; }

  .field-value-editable {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
    cursor: pointer;
    min-height: 1.25em;
    border-bottom: 1px solid transparent;
    transition: border-color 0.12s, color 0.12s;
    word-break: break-word;
  }
  .field-value-editable:hover { border-bottom-color: var(--border); }
  .field-value-editable.empty { color: var(--border); font-style: italic; }
  .field-value-editable.editing { border-bottom-color: var(--accent); }

  .field-input,
  .field-select {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 6px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
  }
  .field-input:focus,
  .field-select:focus { border-color: var(--accent); }
  .field-select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%236b6860' d='M2 3h6L5 7z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    padding-right: 22px;
  }

  .loading-wrap {
    display: flex; align-items: center; justify-content: center;
    height: calc(100vh - 120px);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .empty-grid {
    grid-column: 1 / -1;
    padding: 80px 0;
    text-align: center;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

function PdfThumb({ pdfUrl, wrap = true, targetPx = 220, className = "card-pdf-thumb", fitContainer = false }) {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    const loadingTaskRef = { current: null };

    const run = async () => {
      setPhase("loading");
      let pdf = null;
      try {
        const pdfjsLib = await ensurePdfJs();
        if (cancelled) return;

        loadingTaskRef.current = pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false });
        pdf = await loadingTaskRef.current.promise;
        if (cancelled) {
          pdf.destroy?.().catch(() => {});
          return;
        }
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const box = targetPx;
        const scale = Math.min(box / base.width, box / base.height);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          pdf.destroy?.().catch(() => {});
          return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          pdf.destroy?.().catch(() => {});
          if (!cancelled) setPhase("error");
          return;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        if (fitContainer) {
          canvas.style.width = "";
          canvas.style.height = "";
        } else {
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
        }

        await page.render({ canvasContext: ctx, viewport }).promise;
        pdf.destroy?.().catch(() => {});

        if (cancelled) return;
        setPhase("ready");
      } catch (e) {
        console.error(e);
        pdf?.destroy?.().catch(() => {});
        const c = canvasRef.current;
        if (c) {
          const ctx = c.getContext("2d");
          ctx?.clearRect(0, 0, c.width, c.height);
          c.width = 0;
          c.height = 0;
          c.removeAttribute("style");
        }
        if (!cancelled) setPhase("error");
      }
    };

    run();
    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy?.();
    };
  }, [pdfUrl, targetPx, fitContainer]);

  const showPlaceholder = phase === "loading" || phase === "error";

  const inner = (
    <>
      {showPlaceholder && (
        <div className="card-placeholder card-pdf-placeholder" aria-hidden>
          ⌗
        </div>
      )}
      <canvas ref={canvasRef} aria-hidden={showPlaceholder} />
    </>
  );

  if (wrap) {
    return <div className={className}>{inner}</div>;
  }
  return inner;
}

function LazyPdfThumb({ pdfUrl }) {
  const wrapRef = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { root: null, rootMargin: "200px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="card-pdf-thumb">
      {!inView ? (
        <div className="card-placeholder" aria-hidden>
          ⌗
        </div>
      ) : (
        <PdfThumb pdfUrl={pdfUrl} wrap={false} />
      )}
    </div>
  );
}

function ProfileCard({ profile, onClick }) {
  return (
    <div className="card" onClick={onClick}>
      {profile.pdf_url ? (
        <LazyPdfThumb pdfUrl={profile.pdf_url} />
      ) : profile.scan_url ? (
        <img className="card-img" src={profile.scan_url} alt={profile.name} loading="lazy" />
      ) : (
        <div className="card-placeholder">⌗</div>
      )}
      <div className="card-body">
        <div className="card-name">{profile.name}</div>
        <div className="card-meta">
          {profile.descriptive_name || profile.profile_category || "—"}
        </div>
        <div className="card-badges">
          {profile.pdf_url && <span className="card-badge badge-pdf">PDF</span>}
          {profile.drawing_url && <span className="card-badge badge-dwg">DWG</span>}
          {profile.scan_url && <span className="card-badge badge-scan">Scan</span>}
        </div>
      </div>
    </div>
  );
}

function parseOutgoingField(type, draft) {
  const t = String(draft ?? "").trim();
  if (type === "number") {
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "select") return t === "" ? null : t;
  return t === "" ? null : t;
}

function valuesMatchForPatch(type, prev, next) {
  const a = prev == null || prev === "" ? null : type === "number" ? Number(prev) : String(prev);
  const b = next == null || next === "" ? null : type === "number" ? Number(next) : String(next);
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

function EditableField({ value, fieldKey, profileId, type, options = [], unit = "", onUpdate, isAdmin }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const controlRef = useRef(null);

  const toDraftString = useCallback(() => {
    if (value == null || value === "") return "";
    return String(value);
  }, [value]);

  useEffect(() => {
    if (!editing) setDraft(toDraftString());
  }, [value, editing, toDraftString]);

  useEffect(() => {
    if (editing && controlRef.current) {
      controlRef.current.focus();
      if (typeof controlRef.current.select === "function") controlRef.current.select();
    }
  }, [editing, type]);

  const save = async () => {
    const next = parseOutgoingField(type, draft);
    if (valuesMatchForPatch(type, value, next)) {
      setEditing(false);
      return;
    }
    try {
      await supabasePatch(profileId, { [fieldKey]: next });
      onUpdate({ [fieldKey]: next });
    } catch (err) {
      console.error(err);
      setDraft(toDraftString());
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(toDraftString());
    setEditing(false);
  };

  const onControlKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const beginEdit = () => {
    setDraft(toDraftString());
    setEditing(true);
  };

  const displayText = () => {
    if (value == null || value === "") return "—";
    return unit ? `${value} ${unit}` : String(value);
  };

  const empty = value == null || value === "";

  if (editing && type === "select") {
    return (
      <select
        ref={controlRef}
        className="field-select"
        value={draft}
        aria-label={fieldKey}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onControlKeyDown}
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (editing) {
    return (
      <input
        ref={controlRef}
        className="field-input"
        type={type === "number" ? "number" : "text"}
        value={draft}
        aria-label={fieldKey}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onControlKeyDown}
      />
    );
  }

  if (!isAdmin) {
    return (
      <div className={`field-value-readonly${empty ? " empty" : ""}`}>
        {displayText()}
      </div>
    );
  }

  return (
    <div
      className={`field-value-editable${empty ? " empty" : ""}`}
      role="button"
      tabIndex={0}
      onClick={beginEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          beginEdit();
        }
      }}
    >
      {displayText()}
    </div>
  );
}

function FieldGroup({ group, profile, onFieldUpdate, isAdmin }) {
  return (
    <div className="field-group">
      <div className="group-label">{group.label}</div>
      <div className="fields-grid">
        {group.fields.map((f) => {
          const val = profile[f.key];
          let type = NUMERIC_FIELDS.has(f.key) ? "number" : "text";
          let options = [];
          if (f.key === "profile_category") {
            type = "select";
            options = CATEGORIES;
          } else if (f.key === "tool_type") {
            type = "select";
            options = TOOL_TYPES;
          } else if (f.key === "level_of_detail") {
            type = "select";
            options = LOD;
          }
          return (
            <div key={f.key} className={`field-item${f.wide ? " wide" : ""}`}>
              <div className="field-label">{f.label}</div>
              <EditableField
                value={val}
                fieldKey={f.key}
                profileId={profile.id}
                type={type}
                options={options}
                unit={f.unit || ""}
                onUpdate={onFieldUpdate}
                isAdmin={isAdmin}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailScanUpload({ profile, onScanUpdate }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const triggerPick = () => {
    if (uploading) return;
    setError(null);
    fileRef.current?.click();
  };

  const onKeyActivate = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      triggerPick();
    }
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    const base = SUPABASE_URL.replace(/\/$/, "");
    const objectPath = scanStorageObjectPath(profile.name);
    const putUrl = `${base}/storage/v1/object/${PROFILE_FILES_BUCKET}/${objectPath}?upsert=true`;
    const contentType =
      file.type === "image/jpeg" || file.type === "image/jpg" ? "image/jpeg" : "image/png";
    try {
      const res = await fetch(putUrl, {
        method: "PUT",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": contentType,
        },
        body: file,
      });
      const errText = await res.text();
      if (!res.ok) throw new Error(errText || `Upload failed (${res.status})`);
      const publicUrl = `${base}/storage/v1/object/public/${PROFILE_FILES_BUCKET}/${objectPath}`;
      await supabasePatch(profile.id, { scan_url: publicUrl });
      onScanUpdate({ scan_url: publicUrl });
    } catch (err) {
      console.error(err);
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/png,image/jpeg"
      hidden
      onChange={onFileChange}
    />
  );

  if (profile.scan_url) {
    return (
      <div
        className={`detail-scan-small-wrap${uploading ? " uploading" : ""}`}
        onClick={triggerPick}
        onKeyDown={onKeyActivate}
        role="button"
        tabIndex={0}
        aria-busy={uploading}
        aria-label="Replace scan image"
      >
        <img className="detail-scan-small" src={profile.scan_url} alt={profile.name} />
        {input}
        <div className="detail-scan-replace-overlay">
          {uploading ? "Uploading..." : "Replace"}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`detail-scan-small-placeholder${uploading ? " uploading" : ""}${error ? " has-error" : ""}`}
      onClick={triggerPick}
      onKeyDown={onKeyActivate}
      role="button"
      tabIndex={0}
      aria-busy={uploading}
      aria-label="Upload scan image"
    >
      {input}
      {uploading ? "Uploading..." : error || "Upload Scan"}
    </div>
  );
}

function DetailPage({ profile, onBack, onProfileUpdate, isAdmin }) {
  return (
    <div className="detail-page">
      <div className="detail-back" onClick={onBack}>← Back to catalog</div>
      <div className="detail-hero">
        <div className="detail-pdf-col">
          {profile.pdf_url ? (
            <PdfThumb pdfUrl={profile.pdf_url} className="detail-pdf-thumb" targetPx={900} fitContainer />
          ) : (
            <div className="detail-pdf-placeholder">No PDF</div>
          )}
        </div>
        <div className="detail-right-col">
          <div className="detail-top-row">
            <div className="detail-top-titles">
              <div className="detail-num">Profile #{profile.name}</div>
              <div className="detail-name">{profile.descriptive_name || profile.name}</div>
            </div>
            <div className="detail-top-aside">
              <div className="detail-scan-col">
                {isAdmin ? (
                  <DetailScanUpload
                    profile={profile}
                    onScanUpdate={(patch) => onProfileUpdate(profile.id, patch)}
                  />
                ) : profile.scan_url ? (
                  <img className="detail-scan-small" src={profile.scan_url} alt={profile.name} />
                ) : (
                  <div className="detail-scan-small-placeholder">No Scan</div>
                )}
              </div>
              <div className="detail-badge-row">
                {profile.profile_category && <span className="detail-badge db-category">{profile.profile_category}</span>}
                {profile.tool_type && <span className="detail-badge db-tool">{profile.tool_type}</span>}
                {profile.level_of_detail && <span className="detail-badge db-lod">{profile.level_of_detail}</span>}
              </div>
              <div className="detail-file-btns">
                {profile.pdf_url && (
                  <a className="file-btn" href={profile.pdf_url} download>📄 Download PDF</a>
                )}
                {profile.drawing_url && (
                  <a className="file-btn secondary" href={profile.drawing_url} download>📐 Download DWG</a>
                )}
              </div>
            </div>
          </div>
          {profile.descriptive_name && <div className="detail-desc">{profile.name}</div>}
          <div className="detail-fields">
            {FIELD_GROUPS.map((g) => (
              <FieldGroup
                key={g.label}
                group={g}
                profile={profile}
                onFieldUpdate={(patch) => onProfileUpdate(profile.id, patch)}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const handleSubmit = () => {
    const cred = CREDENTIALS[username.trim().toLowerCase()];
    if (cred && password === cred.password) {
      onLogin(username.trim().toLowerCase(), cred.role);
    } else {
      setError("Invalid username or password.");
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          CPW <span>PROFILE</span> CATALOG
        </div>
        <div className="login-subtitle">Sign in to continue</div>
        <div className="login-field">
          <label className="login-label">Username</label>
          <input
            className="login-input"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="login-field">
          <label className="login-label">Password</label>
          <input
            className="login-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="button" onClick={handleSubmit}>
          Sign In
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [authRole, setAuthRole] = useState(() => sessionStorage.getItem("cpw_role") || null);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(null);

  const isAdmin = authRole === "admin";

  const handleLogin = (user, role) => {
    sessionStorage.setItem("cpw_role", role);
    sessionStorage.setItem("cpw_user", user);
    setAuthRole(role);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("cpw_role");
    sessionStorage.removeItem("cpw_user");
    setAuthRole(null);
    setProfiles([]);
    setLoading(true);
    setSelected(null);
  };

  const handleBack = useCallback(() => {
    setSelected(null);
    window.scrollTo(0, 0);
  }, []);

  const handleProfileUpdate = useCallback((profileId, patch) => {
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
  }, []);

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      const matchSearch = !search ||
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.descriptive_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.tag?.toLowerCase().includes(search.toLowerCase());
      const matchCat = !categoryFilter || p.profile_category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [profiles, search, categoryFilter]);

  const activeCategories = useMemo(() => {
    const cats = new Set(profiles.map((p) => p.profile_category).filter(Boolean));
    return CATEGORIES.filter((c) => cats.has(c));
  }, [profiles]);

  const selectedProfile = selected ? profiles.find((p) => p.id === selected) : null;

  useEffect(() => {
    if (!authRole) return;
    setLoading(true);
    supabaseFetch("profiles", { select: "*", order: "name.asc" })
      .then((data) => {
        setProfiles(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [authRole]);

  if (!authRole) {
    return (
      <>
        <style>{styles}</style>
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <nav className="nav">
        <div className="nav-logo" onClick={handleBack}>CPW <span>PROFILE</span> CATALOG</div>
        {!selectedProfile && (
          <div className="nav-search">
            <span className="nav-search-icon">⌕</span>
            <input placeholder="Search profiles..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        <div className="nav-count">
          {selectedProfile ? `#${selectedProfile.name}` : `${filtered.length} profiles`}
        </div>
        <button className="nav-logout" type="button" onClick={handleLogout} title="Sign out">
          ↩ Sign Out
        </button>
      </nav>

      {selectedProfile ? (
        <DetailPage
          profile={selectedProfile}
          onBack={handleBack}
          onProfileUpdate={handleProfileUpdate}
          isAdmin={isAdmin}
        />
      ) : (
        <>
          <div className="filter-bar">
            <span className="filter-label">Category</span>
            <button className={`filter-chip${!categoryFilter ? " active" : ""}`} onClick={() => setCategoryFilter(null)}>All</button>
            {activeCategories.map((cat) => (
              <button
                key={cat}
                className={`filter-chip${categoryFilter === cat ? " active" : ""}`}
                onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
              >{cat}</button>
            ))}
          </div>
          <div className="grid-page">
            {loading ? (
              <div className="loading-wrap">Loading profiles...</div>
            ) : (
              <div className="grid">
                {filtered.length === 0 ? (
                  <div className="empty-grid">No profiles found</div>
                ) : (
                  filtered.map((p) => (
                    <ProfileCard key={p.id} profile={p} onClick={() => { setSelected(p.id); window.scrollTo(0, 0); }} />
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
