import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import logo from "./assets/CPW_Apple_DeepGold_Large.png";

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const SUPABASE_URL = "https://sijlcyodgwdovauqcikj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7b_OXz7BAZN1--StKqOSfg_ElbHo5OA";
const PROFILE_FILES_BUCKET = "profile-files";

// MS365 SSO: users whose email is in this list get edit (admin) rights.
// Everyone else who signs in is view-only. Emails are matched case-insensitively.
const ADMIN_EMAILS = [
  "jfurda@ciderpresswoodworks.com",
  "chris@ciderpresswoodworks.com",
  "dan@ciderpresswoodworks.com",
];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function supabaseFetch(table, params = {}) {
  let query = supabase.from(table).select(params.select || "*");
  if (params.order) {
    const [col, dir] = params.order.split(".");
    query = query.order(col, { ascending: dir !== "desc" });
  }
  if (params.profile_id) {
    query = query.eq("profile_id", params.profile_id.replace("eq.", ""));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function supabasePatch(id, fields) {
  const { error } = await supabase.from("profiles").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

async function fetchProfilePdfs(profileId) {
  const { data, error } = await supabase
    .from("profile_pdfs")
    .select("*")
    .eq("profile_id", profileId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function insertProfilePdf(profileId, pdfUrl, label, sortOrder) {
  const { data, error } = await supabase
    .from("profile_pdfs")
    .insert({ profile_id: profileId, pdf_url: pdfUrl, label, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteProfilePdf(id) {
  const { error } = await supabase.from("profile_pdfs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

async function uploadProfileStorageObject(storagePath, file, contentType) {
  const { error } = await supabase.storage
    .from(PROFILE_FILES_BUCKET)
    .upload(storagePath, file, { upsert: true, contentType });
  if (error) throw new Error(error.message);
  const {
    data: { publicUrl },
  } = supabase.storage.from(PROFILE_FILES_BUCKET).getPublicUrl(storagePath);
  return publicUrl;
}

/** Storage object key: scans/{name}.png (slashes in name stripped for safety). */
function scanStorageObjectPath(profileName) {
  const safe = String(profileName).replace(/[/\\]+/g, "");
  return `scans/${safe}.png`;
}

const CATEGORIES = [
  "Trim",
  "Baseboard",
  "Panel Molding",
  "Cove Molding",
  "Edge Profile",
  "Miscellaneous",
  "Casing",
  "Door Casing",
  "Cope and Stick",
  "Wainscoting",
  "Jointery",
  "Groove/Tounge",
  "Hand Rail",
  "Chair Rail",
  "Crown Molding",
  "Bullnose",
  "Picture Moulding",
];

const TOOL_TYPES = ["Profile Knife", "Router Bit"];
const LOD = ["Simple", "Moderate", "Complex"];

const TAGS = {
  "Shape / Profile": [
    "bead", "ogee", "cove", "bullnose", "ovolo", "astragal", "chamfer",
    "concave", "convex", "flute", "reed", "thumbnail", "roundover",
  ],
  Construction: [
    "cope", "stick", "tongue", "groove", "rabbet", "bevel", "fillet",
    "reveal", "half lap", "ship lap",
  ],
  "Location / Application": [
    "baseboard", "casing", "chair rail", "crown", "base cap", "back band",
    "panel molding", "picture frame", "wainscoting", "handrail", "stair rail",
    "sill", "apron", "plinth", "pilaster",
  ],
  Geometry: [
    "quarter round", "half round", "full round", "symmetrical", "raised",
    "stepped", "multi", "repeat", "tambour",
  ],
  Size: ["small", "medium", "large"],
  Other: [
    "custom", "traditional", "shaker", "door", "window", "edge", "trim",
    "rework", "outsourced",
  ],
};

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
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .nav-logo span { color: var(--accent); }

  .nav-logo-img {
    height: 36px;
    width: auto;
    display: block;
  }

  .nav-search {
    flex: 1;
    position: relative;
  }

  .nav-search input {
    width: 100%;
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: var(--radius);
    color: var(--bg);
    font-family: var(--mono);
    font-size: 12px;
    padding: 8px 12px 8px 36px;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  .nav-search input:focus {
    border-color: var(--accent);
    background: rgba(0, 0, 0, 0.04);
  }

  .nav-search input::placeholder { color: rgba(0, 0, 0, 0.38); }

  .nav-search-icon {
    position: absolute; left: 11px; top: 50%;
    transform: translateY(-50%);
    color: rgba(0, 0, 0, 0.45);
    font-size: 13px; pointer-events: none;
  }

  .nav-slider-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .nav-slider-icon {
    font-size: 10px;
    color: rgba(0, 0, 0, 0.35);
    line-height: 1;
  }

  .nav-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 3px;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.2);
    outline: none;
    cursor: pointer;
  }

  .nav-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .nav-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .nav-count {
    font-family: var(--mono);
    font-size: 11px;
    color: rgba(0, 0, 0, 0.55);
    letter-spacing: 0.06em;
    white-space: nowrap;
    margin-left: auto;
  }

  .nav-logout {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.22);
    color: var(--bg);
    border-radius: var(--radius);
    padding: 5px 10px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color 0.12s, color 0.12s;
  }
  .nav-logout:hover { border-color: var(--accent); color: var(--accent); }

  .nav-add-btn {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: var(--accent);
    border: none;
    border-radius: var(--radius);
    color: var(--bg);
    padding: 5px 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .nav-add-btn:hover { opacity: 0.85; }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 36px 32px;
    width: 100%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .modal-title {
    font-family: var(--display);
    font-size: 18px;
    color: var(--text);
  }
  .modal-field { display: flex; flex-direction: column; gap: 6px; }
  .modal-file-row { display: flex; align-items: center; gap: 10px; }
  .modal-file-btn {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 8px 12px;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .modal-file-btn:hover { border-color: var(--accent); }
  .modal-file-name { font-family: var(--mono); font-size: 11px; color: var(--accent2); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
  .modal-cancel-btn {
    font-family: var(--mono);
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--muted);
    padding: 8px 16px;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .modal-cancel-btn:hover { border-color: var(--text); color: var(--text); }
  .modal-submit-btn { width: auto; margin-top: 0; }

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

  .filter-section {
    width: 100%;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 10px 32px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
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
    touch-action: manipulation;
    min-height: 40px;
  }

  .filter-chip:hover { border-color: var(--accent); color: var(--accent); }
  .filter-chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  .radius-range {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .radius-range-input {
    font-family: var(--mono);
    font-size: 11px;
    width: 64px;
    padding: 4px 8px;
    min-height: 40px;
    border-radius: 2px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }
  .radius-range-input:focus { outline: none; border-color: var(--accent); }
  .radius-range-sep { font-family: var(--mono); font-size: 11px; color: var(--muted); }

  .sort-select {
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 4px 10px;
    min-height: 40px;
    border-radius: 2px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .sort-select:focus { outline: none; border-color: var(--accent); }

  .grid-page { padding: 28px; }

  .grid {
    width: 100%;
    display: grid;
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
    aspect-ratio: 1 / 1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    position: relative;
  }

  .card-pdf-thumb .card-pdf-placeholder {
    position: absolute;
    inset: 0;
    z-index: 1;
    aspect-ratio: unset;
    height: 100%;
  }

  .card-pdf-thumb canvas {
    width: 100% !important;
    height: 100% !important;
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

  .detail-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    width: 100%;
    flex-shrink: 0;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 32px;
  }
  .detail-topbar .detail-back {
    border-bottom: none;
    padding-left: 0;
    padding-right: 0;
  }

  .detail-delete-btn {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: transparent;
    border: 1px solid #7a3030;
    border-radius: var(--radius);
    color: #c07070;
    padding: 5px 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .detail-delete-btn:hover { background: #7a3030; color: #fff; }

  .detail-topbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .detail-archive-btn {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: transparent;
    border: 1px solid #7a6230;
    border-radius: var(--radius);
    color: var(--accent);
    padding: 5px 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .detail-archive-btn:hover { background: #7a6230; color: #fff; }

  .detail-unarchive-btn {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: transparent;
    border: 1px solid #3a5a3a;
    border-radius: var(--radius);
    color: var(--accent2);
    padding: 5px 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .detail-unarchive-btn:hover { background: #3a5a3a; color: #fff; }

  .card-badge-archived {
    font-family: var(--mono);
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 2px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: rgba(245, 158, 11, 0.12);
    color: #d97706;
    border: 1px solid rgba(245, 158, 11, 0.35);
  }

  .pdf-visibility-toggle {
    display: block;
    width: 100%;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-bottom: none;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    padding: 8px 12px;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }
  .pdf-visibility-toggle:hover { color: var(--text); }

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
    max-height: calc(100vh - 56px);
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

  .detail-usage-notes-wrap {
    margin-top: 8px;
  }

  .detail-usage-notes-label {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .detail-usage-notes-wrap .field-value-editable,
  .detail-usage-notes-wrap .field-value-readonly {
    font-family: var(--sans);
    font-size: 13px;
    color: var(--muted);
    line-height: 1.5;
  }

  .detail-usage-notes-wrap .field-value-editable.empty,
  .detail-usage-notes-wrap .field-value-readonly.empty {
    font-style: italic;
    color: var(--border);
  }

  .detail-tags-wrap {
    margin-top: 12px;
    text-align: center;
  }

  .tag-editor {
    position: relative;
  }

  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    justify-content: center;
  }

  .tag-chip {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--text);
    padding: 3px 8px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .tag-chip-remove {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
  }
  .tag-chip-remove:hover { color: #e07070; }

  .tag-add-btn {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 2px;
    color: var(--muted);
    padding: 3px 8px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .tag-add-btn:hover { border-color: var(--accent); color: var(--accent); }

  .tag-picker {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 50;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px;
    width: 380px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  .tag-picker-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 180px;
    overflow-y: auto;
    margin-bottom: 10px;
  }

  .tag-picker-category {
    width: 100%;
    margin-bottom: 8px;
  }

  .tag-picker-cat-label {
    font-family: var(--mono);
    font-size: 8px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 5px;
  }

  .tag-picker-cat-items {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag-picker-option {
    font-family: var(--mono);
    font-size: 10px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--muted);
    padding: 3px 8px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .tag-picker-option:hover { border-color: var(--accent); color: var(--accent); }

  .tag-picker-custom {
    display: flex;
    gap: 6px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }

  .tag-picker-input {
    flex: 1;
    font-family: var(--mono);
    font-size: 11px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 5px 8px;
    outline: none;
  }
  .tag-picker-input:focus { border-color: var(--accent); }

  .tag-picker-add {
    font-family: var(--mono);
    font-size: 10px;
    background: var(--accent);
    border: none;
    border-radius: var(--radius);
    color: #fff;
    padding: 5px 10px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .tag-picker-add:hover { opacity: 0.85; }

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

  .detail-file-btns {
    display: flex;
    flex-direction: row;
    gap: 12px;
  }

  .file-btn-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .detail-file-upload-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .file-upload-error {
    font-family: var(--mono);
    font-size: 10px;
    color: #e07070;
  }

  .file-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 36px;
    line-height: 1.2;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: center;
    text-decoration: none;
    padding: 8px 12px;
    border-radius: var(--radius);
    cursor: pointer;
    box-sizing: border-box;
    background: var(--text);
    border: 1px solid var(--text);
    color: var(--bg);
    transition: opacity 0.15s;
  }
  .file-btn:hover { opacity: 0.85; }
  .file-btn.secondary {
    background: var(--text);
    border: 1px solid var(--text);
    color: var(--bg);
  }
  .file-btn.secondary:hover { opacity: 0.85; }

  .file-upload-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 36px;
    line-height: 1.2;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: center;
    padding: 8px 12px;
    border-radius: var(--radius);
    cursor: pointer;
    box-sizing: border-box;
    appearance: none;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--muted);
    transition: border-color 0.15s, color 0.15s;
  }
  .file-upload-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .file-upload-btn:disabled { opacity: 0.5; cursor: default; }

  .pdf-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 10px 0;
  }

  .pdf-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pdf-empty {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
  }

  .pdf-section-loading {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .pdf-row {
    display: flex;
    gap: 12px;
    align-items: center;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
  }

  .pdf-row-thumb {
    width: 60px;
    height: 60px;
    flex-shrink: 0;
    cursor: pointer;
    overflow: hidden;
    background: #fff;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pdf-row-thumb canvas {
    width: 100% !important;
    height: 100% !important;
    object-fit: contain;
  }

  .pdf-row-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pdf-row-label {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
  }

  .pdf-row-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pdf-action-btn {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--muted);
    padding: 3px 8px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .pdf-action-btn:hover { border-color: var(--accent); color: var(--accent); }
  .pdf-action-btn.danger:hover { border-color: #e07070; color: #e07070; }

  .pdf-upload-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

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
  .group-label-toggle {
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
  }
  .group-label-toggle:hover { color: var(--accent); }

  .group-toggle-icon {
    font-size: 8px;
    color: var(--muted);
    margin-left: 8px;
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

  /* Mobile nav */
  @media (max-width: 767px) {
    .nav { height: auto; flex-wrap: wrap; gap: 8px; padding: 10px 14px; align-items: center; }
    .nav-logo { order: 1; flex: 1; font-size: 13px; }
    .nav-logout { order: 2; white-space: nowrap; }
    .nav-count { order: 3; width: 100%; font-size: 11px; }
    .nav-add-btn { order: 4; width: 100%; }
    .nav-slider-wrap { display: none; }
  }

  /* Mobile filter */
  .mobile-filter-wrap { padding: 8px 14px 0; position: relative; }
  .mobile-filter-top-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mobile-search {
    flex: 1;
    min-width: 0;
  }
  .mobile-filter-wrap .nav-search {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 10px;
  }
  .mobile-filter-wrap .nav-search input {
    background: transparent;
    color: var(--text);
    border: none;
    outline: none;
    font-family: var(--mono);
    font-size: 12px;
    width: 100%;
    padding: 8px 0;
  }
  .mobile-filter-wrap .nav-search-icon {
    color: var(--muted);
  }
  .mobile-filter-btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    padding: 10px 16px;
    border-radius: var(--radius);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    touch-action: manipulation;
    min-height: 44px;
  }
  .mobile-filter-btn.open { border-color: var(--accent); }
  .mobile-filter-dot {
    width: 6px; height: 6px;
    background: var(--accent);
    border-radius: 50%;
  }
  .mobile-filter-drawer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .filter-drawer-section { display: flex; flex-direction: column; gap: 6px; }
  .filter-chips-wrap { display: flex; flex-wrap: wrap; gap: 6px; }

  /* Mobile grid + detail layout + scrolling */
  @media (max-width: 767px) {
    .grid { grid-template-columns: repeat(2, 1fr) !important; }
    .grid-page { padding: 10px; }

    .detail-page {
      overflow-y: auto;
      height: auto;
    }
    .detail-hero {
      min-height: unset !important;
    }

    .detail-top-row {
      gap: 10px;
    }
    .detail-top-aside {
      width: 140px;
      min-width: 140px;
      flex-shrink: 0;
    }
    .detail-scan-small {
      width: 140px;
      height: 140px;
      object-fit: contain;
    }
    .detail-scan-small-placeholder {
      width: 140px;
      height: 140px;
    }
    .detail-badge-row {
      flex-wrap: wrap;
      gap: 3px;
      margin-top: 6px;
    }
    .detail-badge {
      font-size: 7px;
      padding: 1px 4px;
    }
    .file-btn-group {
      flex-direction: column;
    }
    .file-btn {
      font-size: 9px;
      padding: 4px 6px;
      text-align: center;
    }
    .detail-num {
      font-size: 13px;
    }
    .detail-name {
      font-size: 32px;
    }
  }
`;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

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

function LazyPdfThumb({ pdfUrl, thumbSize }) {
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
        <PdfThumb pdfUrl={pdfUrl} wrap={false} targetPx={thumbSize * 2} />
      )}
    </div>
  );
}

function ProfileCard({ profile, onClick, thumbSize }) {
  return (
    <div className="card" onClick={onClick}>
      {profile.pdf_url ? (
        <LazyPdfThumb pdfUrl={profile.pdf_url} thumbSize={thumbSize} />
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
          {profile.archived && <span className="card-badge-archived">Archived</span>}
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

function TagEditor({ value, profileId, isAdmin, onUpdate }) {
  const parseTags = (raw) =>
    (raw || "").split("\n").map((t) => t.trim()).filter(Boolean);

  const [tags, setTags] = useState(() => parseTags(value));
  const [showPicker, setShowPicker] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const pickerRef = useRef(null);

  useEffect(() => {
    setTags(parseTags(value));
  }, [value]);

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const save = async (newTags) => {
    const raw = newTags.join("\n") || null;
    try {
      await supabasePatch(profileId, { tag: raw });
      onUpdate({ tag: raw });
    } catch (err) {
      console.error(err);
    }
  };

  const removeTag = (tag) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    save(next);
  };

  const addTag = (tag) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setTags(next);
    save(next);
  };

  const handleCustomAdd = () => {
    addTag(customInput);
    setCustomInput("");
  };

  const availableTags = Object.fromEntries(
    Object.entries(TAGS).map(([cat, items]) => [cat, items.filter((t) => !tags.includes(t))])
  );

  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            {isAdmin && (
              <button type="button" className="tag-chip-remove" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                ×
              </button>
            )}
          </span>
        ))}
        {isAdmin && (
          <button type="button" className="tag-add-btn" onClick={() => setShowPicker((v) => !v)}>
            + Add
          </button>
        )}
      </div>

      {isAdmin && showPicker && (
        <div className="tag-picker" ref={pickerRef}>
          <div className="tag-picker-list">
            {Object.entries(availableTags).map(([cat, items]) =>
              items.length === 0 ? null : (
                <div key={cat} className="tag-picker-category">
                  <div className="tag-picker-cat-label">{cat}</div>
                  <div className="tag-picker-cat-items">
                    {items.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="tag-picker-option"
                        onClick={() => {
                          addTag(tag);
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
          <div className="tag-picker-custom">
            <input
              className="tag-picker-input"
              placeholder="Custom tag…"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomAdd();
              }}
            />
            <button type="button" className="tag-picker-add" onClick={handleCustomAdd}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldGroup({ group, profile, onFieldUpdate, isAdmin }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="field-group">
      <div className="group-label group-label-toggle" onClick={() => setOpen((o) => !o)}>
        {group.label}
        <span className="group-toggle-icon">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
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
      )}
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
    const objectPath = scanStorageObjectPath(profile.name);
    const contentType =
      file.type === "image/jpeg" || file.type === "image/jpg" ? "image/jpeg" : "image/png";
    try {
      const publicUrl = await uploadProfileStorageObject(objectPath, file, contentType);
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

function DetailFileUpload({ profile, fileType, onUploadComplete }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const isPdf = fileType === "pdf";
  const existingUrl = isPdf ? profile.pdf_url : profile.drawing_url;
  const accept = isPdf ? "application/pdf" : ".dwg";
  const storagePath = isPdf
    ? `pdfs/${parseInt(profile.name, 10)}.pdf`
    : `drawings/${parseInt(profile.name, 10)}.dwg`;
  const dbField = isPdf ? "pdf_url" : "drawing_url";
  const label = isPdf ? "PDF" : "DWG";

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!isPdf && existingUrl) {
      const confirmed = window.confirm(`This profile already has a ${label}. Replace it?`);
      if (!confirmed) return;
    }

    setError(null);
    setUploading(true);
    const contentType = isPdf ? "application/pdf" : "application/octet-stream";

    try {
      const publicUrl = await uploadProfileStorageObject(storagePath, file, contentType);
      await supabasePatch(profile.id, { [dbField]: publicUrl });
      onUploadComplete({ [dbField]: publicUrl });
    } catch (err) {
      console.error(err);
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="detail-file-upload-wrap">
      <input ref={fileRef} type="file" accept={accept} hidden onChange={onFileChange} />
      <button
        type="button"
        className="file-upload-btn"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : `↑ Upload ${label}`}
      </button>
      {error && <div className="file-upload-error">{error}</div>}
    </div>
  );
}

function PdfSection({ profile, isAdmin, onSetPrimary, onSetActivePdf }) {
  const [pdfs, setPdfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchProfilePdfs(profile.id)
      .then((data) => {
        setPdfs(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [open, profile.id]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `pdfs/${profile.id}_${Date.now()}_${safeName}`;
    try {
      const publicUrl = await uploadProfileStorageObject(storagePath, file, "application/pdf");
      const labelFromFile = file.name.replace(/\.pdf$/i, "");
      const row = await insertProfilePdf(profile.id, publicUrl, labelFromFile, pdfs.length);
      setPdfs((prev) => [...prev, row]);
    } catch (err) {
      console.error(err);
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (pdf) => {
    if (!window.confirm(`Delete "${pdf.label || "this PDF"}"?`)) return;
    try {
      await deleteProfilePdf(pdf.id);
      setPdfs((prev) => prev.filter((p) => p.id !== pdf.id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSetPrimary = async (pdf) => {
    if (profile.pdf_url) {
      const alreadySaved = pdfs.some((p) => p.pdf_url === profile.pdf_url);
      if (!alreadySaved) {
        try {
          const urlParts = profile.pdf_url.split("/");
          const rawFilename = decodeURIComponent(urlParts[urlParts.length - 1] || "");
          const label = rawFilename
            ? rawFilename.replace(/\.pdf$/i, "")
            : "Former Primary PDF";

          const row = await insertProfilePdf(profile.id, profile.pdf_url, label, 0);
          setPdfs((prev) => [row, ...prev]);
        } catch (err) {
          console.error("Failed to migrate existing primary PDF:", err);
        }
      }
    }

    await supabasePatch(profile.id, { pdf_url: pdf.pdf_url });
    onSetPrimary(pdf.pdf_url);
  };

  return (
    <div className="field-group">
      <div className="group-label group-label-toggle" onClick={() => setOpen((o) => !o)}>
        PDFs
        <span className="group-toggle-icon">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="pdf-section">
          {loading ? (
            <div className="pdf-section-loading">Loading…</div>
          ) : (
            <div className="pdf-list">
              {!profile.pdf_url && pdfs.length === 0 && (
                <div className="pdf-empty">No PDFs uploaded.</div>
              )}
              {profile.pdf_url && (
                <div className="pdf-row">
                  <div className="pdf-row-thumb" onClick={() => onSetActivePdf(profile.pdf_url)}>
                    <PdfThumb pdfUrl={profile.pdf_url} targetPx={120} wrap={false} />
                  </div>
                  <div className="pdf-row-info">
                    <div className="pdf-row-label">Primary PDF</div>
                    <div className="pdf-row-actions">
                      <button type="button" className="pdf-action-btn" onClick={() => onSetActivePdf(profile.pdf_url)}>
                        View
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {pdfs.map((pdf) => (
                <div key={pdf.id} className="pdf-row">
                  <div className="pdf-row-thumb" onClick={() => onSetActivePdf(pdf.pdf_url)}>
                    <PdfThumb pdfUrl={pdf.pdf_url} targetPx={120} wrap={false} />
                  </div>
                  <div className="pdf-row-info">
                    <div className="pdf-row-label">{pdf.label || "Untitled"}</div>
                    <div className="pdf-row-actions">
                      <button type="button" className="pdf-action-btn" onClick={() => onSetActivePdf(pdf.pdf_url)}>
                        View
                      </button>
                      {isAdmin && (
                        <>
                          <button type="button" className="pdf-action-btn" onClick={() => handleSetPrimary(pdf)}>
                            Set as Primary
                          </button>
                          <button type="button" className="pdf-action-btn danger" onClick={() => handleDelete(pdf)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {isAdmin && (
            <div className="pdf-upload-row">
              <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={handleUpload} />
              <button type="button" className="file-upload-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : "↑ Upload PDF"}
              </button>
              {error && <div className="file-upload-error">{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailPage({ profile, onBack, onProfileUpdate, isAdmin, onArchive, onUnarchive, onDelete, isMobile }) {
  const [activePdfUrl, setActivePdfUrl] = useState(profile.pdf_url);
  const [pdfVisible, setPdfVisible] = useState(!isMobile);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  useEffect(() => {
    setActivePdfUrl(profile.pdf_url);
  }, [profile.id, profile.pdf_url]);

  return (
    <div className="detail-page">
      <div className="detail-topbar">
        <div className="detail-back" onClick={onBack}>← Back to catalog</div>
        <div className="detail-topbar-actions">
          {isAdmin && !profile.archived && (
            <button type="button" className="detail-archive-btn" onClick={() => onArchive(profile)}>
              Archive Profile
            </button>
          )}
          {isAdmin && profile.archived && (
            <>
              <button type="button" className="detail-unarchive-btn" onClick={() => onUnarchive(profile)}>
                Unarchive Profile
              </button>
              <button type="button" className="detail-delete-btn" onClick={() => onDelete(profile)}>
                Delete Permanently
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className="detail-hero"
        style={isMobile ? { display: "flex", flexDirection: "column", minHeight: "unset" } : {}}
      >
        {isMobile && (
          <button
            type="button"
            className="pdf-visibility-toggle"
            onClick={() => setPdfVisible((v) => !v)}
          >
            {pdfVisible ? "▲ Hide PDF" : "▼ Show PDF"}
          </button>
        )}

        {(!isMobile || pdfVisible) && (
          <div
            className="detail-pdf-col"
            style={
              isMobile
                ? {
                    width: "100%",
                    height: "auto",
                    minHeight: "50vh",
                    borderRight: "none",
                    borderBottom: "1px solid var(--border)",
                  }
                : {}
            }
          >
            {activePdfUrl ? (
              <PdfThumb pdfUrl={activePdfUrl} className="detail-pdf-thumb" targetPx={900} fitContainer />
            ) : (
              <div className="detail-pdf-placeholder">No PDF</div>
            )}
          </div>
        )}

        <div
          className="detail-right-col"
          style={isMobile ? { width: "100%", maxHeight: "unset", overflowY: "unset", flex: "1" } : {}}
        >
          <div className="detail-top-row">
            <div className="detail-top-titles">
              <div className="detail-num">Profile #{profile.name}</div>
              <div className="detail-name">{profile.descriptive_name || profile.name}</div>
              <div className="detail-usage-notes-wrap">
                <div className="detail-usage-notes-label">Usage Notes</div>
                <EditableField
                  value={profile.usage_notes}
                  fieldKey="usage_notes"
                  profileId={profile.id}
                  type="text"
                  unit=""
                  options={[]}
                  onUpdate={(patch) => onProfileUpdate(profile.id, patch)}
                  isAdmin={isAdmin}
                />
              </div>
              <div className="detail-tags-wrap">
                <div className="detail-usage-notes-label">Tags</div>
                <TagEditor
                  value={profile.tag}
                  profileId={profile.id}
                  isAdmin={isAdmin}
                  onUpdate={(patch) => onProfileUpdate(profile.id, patch)}
                />
              </div>
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
                <div className="file-btn-group">
                  {isAdmin && (
                    <DetailFileUpload
                      profile={profile}
                      fileType="pdf"
                      onUploadComplete={(patch) => onProfileUpdate(profile.id, patch)}
                    />
                  )}
                  {profile.pdf_url && (
                    <a className="file-btn" href={profile.pdf_url} download>📄 Download PDF</a>
                  )}
                </div>
                <div className="file-btn-group">
                  {isAdmin && (
                    <DetailFileUpload
                      profile={profile}
                      fileType="dwg"
                      onUploadComplete={(patch) => onProfileUpdate(profile.id, patch)}
                    />
                  )}
                  {profile.drawing_url && (
                    <a className="file-btn secondary" href={profile.drawing_url} download>📐 Download DWG</a>
                  )}
                </div>
              </div>
            </div>
          </div>
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
            <PdfSection
              profile={profile}
              isAdmin={isAdmin}
              onSetActivePdf={setActivePdfUrl}
              onSetPrimary={(url) => {
                onProfileUpdate(profile.id, { pdf_url: url });
                setActivePdfUrl(url);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onSignIn }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSignIn();
      // On success the browser redirects to Microsoft; this stays "busy".
    } catch (err) {
      setError(err.message || "Sign-in failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          CPW <span>PROFILE</span> CATALOG
        </div>
        <div className="login-subtitle">Sign in to continue</div>
        {error && <div className="login-error">{error}</div>}
        <button
          className="login-btn"
          type="button"
          onClick={handleSignIn}
          disabled={busy}
        >
          {busy ? "Redirecting…" : "Sign in with Microsoft"}
        </button>
      </div>
    </div>
  );
}

function CreateProfileModal({ onClose, onCreated }) {
  const [category, setCategory] = useState("");
  const [descName, setDescName] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleSubmit = async () => {
    if (!category) {
      setError("Category is required.");
      return;
    }
    if (!descName.trim()) {
      setError("Name is required.");
      return;
    }
    if (!pdfFile) {
      setError("PDF is required.");
      return;
    }
    setError(null);
    setUploading(true);

    try {
      const existing = await supabaseFetch("profiles", { select: "name", order: "name.asc" });
      const nums = existing.map((p) => parseInt(p.name, 10)).filter((n) => !isNaN(n));
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      const paddedName = String(nextNum).padStart(3, "0");

      const pdfPath = `pdfs/${nextNum}.pdf`;
      const pdfUrl = await uploadProfileStorageObject(pdfPath, pdfFile, "application/pdf");

      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert({
          name: paddedName,
          descriptive_name: descName.trim(),
          profile_category: category,
          pdf_url: pdfUrl,
        })
        .select()
        .single();
      if (insertError) throw new Error(insertError.message);
      onCreated(newProfile);
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Add New Profile</div>

        <div className="modal-field">
          <label className="login-label">Category *</label>
          <select
            className="field-select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setError(null);
            }}
          >
            <option value="">— Select —</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label className="login-label">Name *</label>
          <input
            className="login-input"
            type="text"
            placeholder="e.g. Small Cove Molding"
            value={descName}
            onChange={(e) => {
              setDescName(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div className="modal-field">
          <label className="login-label">PDF *</label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              setPdfFile(e.target.files?.[0] || null);
              setError(null);
            }}
          />
          <div className="modal-file-row">
            <button type="button" className="modal-file-btn" onClick={() => fileRef.current?.click()}>
              {pdfFile ? pdfFile.name : "Choose PDF…"}
            </button>
            {pdfFile && <span className="modal-file-name">✓</span>}
          </div>
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="modal-cancel-btn" onClick={onClose} disabled={uploading}>
            Cancel
          </button>
          <button type="button" className="login-btn modal-submit-btn" onClick={handleSubmit} disabled={uploading}>
            {uploading ? "Creating…" : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [missingFilters, setMissingFilters] = useState(new Set());
  const [archivedFilter, setArchivedFilter] = useState(false);
  const [hasRadiusFilter, setHasRadiusFilter] = useState(false);
  const [radiusMin, setRadiusMin] = useState("");
  const [radiusMax, setRadiusMax] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [thumbSlider, setThumbSlider] = useState(0);
  const thumbSize = Math.round(220 * Math.pow(1200 / 220, thumbSlider / 100));

  const isMobile = useIsMobile();

  const isAdmin = !!session?.user?.email &&
    ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(session.user.email.toLowerCase());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email openid profile",
        redirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setProfiles([]);
    setLoading(true);
    setSelected(null);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const handleProfileCreated = (newProfile) => {
    setProfiles((prev) => [...prev, newProfile].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleArchiveProfile = async (profile) => {
    if (!window.confirm(`Archive profile ${profile.name}?`)) return;
    const { error } = await supabase.from("profiles").update({ archived: true }).eq("id", profile.id);
    if (error) {
      alert("Error archiving profile.");
      return;
    }
    setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, archived: true } : p)));
    setSelected(null);
  };

  const handleUnarchiveProfile = async (profile) => {
    if (!window.confirm(`Unarchive profile ${profile.name}?`)) return;
    const { error } = await supabase.from("profiles").update({ archived: false }).eq("id", profile.id);
    if (error) {
      alert("Error unarchiving profile.");
      return;
    }
    setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, archived: false } : p)));
    setSelected(null);
  };

  const handleDeleteProfile = async (profile) => {
    if (!window.confirm(`Permanently delete profile ${profile.name}? This cannot be undone.`)) return;
    const { error } = await supabase.from("profiles").delete().eq("id", profile.id);
    if (error) {
      alert("Error deleting profile.");
      return;
    }
    setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
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
    const minVal = radiusMin.trim() === "" ? null : Number(radiusMin);
    const maxVal = radiusMax.trim() === "" ? null : Number(radiusMax);
    const result = profiles
      .filter((p) => (archivedFilter ? p.archived === true : !p.archived))
      .filter((p) => {
        const matchSearch =
          !search ||
          p.name?.toLowerCase().includes(search.toLowerCase()) ||
          p.descriptive_name?.toLowerCase().includes(search.toLowerCase()) ||
          p.tag?.toLowerCase().includes(search.toLowerCase());
        const matchCat = !categoryFilter || p.profile_category === categoryFilter;
        const matchMissing =
          missingFilters.size === 0 ||
          ((!missingFilters.has("pdf") || !p.pdf_url) &&
            (!missingFilters.has("dwg") || !p.drawing_url) &&
            (!missingFilters.has("scan") || !p.scan_url) &&
            (!missingFilters.has("tags") || !p.tag));
        let matchRadius = true;
        if (hasRadiusFilter) {
          const r = p.primary_radius;
          matchRadius =
            r != null &&
            (minVal == null || Number.isNaN(minVal) || r >= minVal) &&
            (maxVal == null || Number.isNaN(maxVal) || r <= maxVal);
        }
        return matchSearch && matchCat && matchMissing && matchRadius;
      });

    if (sortBy === "radius_asc" || sortBy === "radius_desc") {
      const dir = sortBy === "radius_asc" ? 1 : -1;
      result.sort((a, b) => {
        const ra = a.primary_radius;
        const rb = b.primary_radius;
        // Profiles without a radius always sink to the bottom.
        if (ra == null && rb == null) return a.name.localeCompare(b.name);
        if (ra == null) return 1;
        if (rb == null) return -1;
        if (ra !== rb) return (ra - rb) * dir;
        return a.name.localeCompare(b.name);
      });
    } else {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }
    return result;
  }, [profiles, search, categoryFilter, missingFilters, archivedFilter, hasRadiusFilter, radiusMin, radiusMax, sortBy]);

  const activeCategories = useMemo(() => {
    const cats = new Set(profiles.map((p) => p.profile_category).filter(Boolean));
    return CATEGORIES.filter((c) => cats.has(c));
  }, [profiles]);

  const selectedProfile = selected ? profiles.find((p) => p.id === selected) : null;

  // Read direction: resolve the URL hash (e.g. #/profile/042) to a profile so a
  // shared/pasted link — or the browser back/forward buttons — opens that page.
  useEffect(() => {
    if (profiles.length === 0) return; // wait until data is loaded to resolve links
    const applyHash = () => {
      const m = window.location.hash.match(/^#\/profile\/(.+)$/);
      if (!m) {
        setSelected(null);
        return;
      }
      const key = decodeURIComponent(m[1]);
      const prof = profiles.find((p) => p.name === key) || profiles.find((p) => p.id === key);
      setSelected(prof ? prof.id : null);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [profiles]);

  // Write direction: keep the URL hash mirroring the selected profile so the
  // address bar always points at the exact page the user is looking at.
  useEffect(() => {
    if (profiles.length === 0) return; // don't clobber a deep link before data loads
    const prof = selected ? profiles.find((p) => p.id === selected) : null;
    const desired = prof ? `#/profile/${encodeURIComponent(prof.name)}` : "";
    if (window.location.hash === desired) return;
    if (desired) {
      window.location.hash = desired;
    } else {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [selected, profiles]);

  useEffect(() => {
    if (!session) return;
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
  }, [session]);

  if (authLoading) {
    return (
      <>
        <style>{styles}</style>
        <div className="login-screen">
          <div className="login-box">
            <div className="login-logo">
              CPW <span>PROFILE</span> CATALOG
            </div>
            <div className="login-subtitle">Loading…</div>
          </div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <style>{styles}</style>
        <LoginScreen onSignIn={handleSignIn} />
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <nav className="nav">
        <div className="nav-logo" onClick={handleBack}>
          <img src={logo} alt="CPW Logo" className="nav-logo-img" />
          CPW <span>PROFILE</span> CATALOG
        </div>
        {!isMobile && !selectedProfile && (
          <div className="nav-search">
            <span className="nav-search-icon">⌕</span>
            <input placeholder="Search profiles..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {!isMobile && !selectedProfile && (
          <div className="nav-slider-wrap">
            <span className="nav-slider-icon">▦</span>
            <input
              className="nav-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={thumbSlider}
              onChange={(e) => setThumbSlider(Number(e.target.value))}
              aria-label="Thumbnail size"
            />
            <span className="nav-slider-icon">▪</span>
          </div>
        )}
        <div className="nav-count">
          {selectedProfile ? `#${selectedProfile.name}` : `${filtered.length} profiles`}
        </div>
        {isAdmin && !selectedProfile && (
          <button type="button" className="nav-add-btn" onClick={() => setShowCreateModal(true)}>
            + Add Profile
          </button>
        )}
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
          onArchive={handleArchiveProfile}
          onUnarchive={handleUnarchiveProfile}
          onDelete={handleDeleteProfile}
          isMobile={isMobile}
        />
      ) : (
        <>
          {isMobile ? (
            <div className="mobile-filter-wrap">
              <div className="mobile-filter-top-row">
                <div className="nav-search mobile-search">
                  <span className="nav-search-icon">⌕</span>
                  <input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <button
                  type="button"
                  className={`mobile-filter-btn${filterDrawerOpen ? " open" : ""}`}
                  onClick={() => setFilterDrawerOpen((o) => !o)}
                >
                  ⚙ Filters
                  {(categoryFilter || missingFilters.size > 0 || archivedFilter || hasRadiusFilter) && <span className="mobile-filter-dot" />}
                </button>
              </div>
              {filterDrawerOpen && (
                <div className="mobile-filter-drawer">
                  <div className="filter-drawer-section">
                    <span className="filter-label">Category</span>
                    <div className="filter-chips-wrap">
                      <button
                        type="button"
                        className={`filter-chip${!categoryFilter ? " active" : ""}`}
                        onClick={() => setCategoryFilter(null)}
                      >
                        All
                      </button>
                      {activeCategories.map((cat) => (
                        <button
                          type="button"
                          key={cat}
                          className={`filter-chip${categoryFilter === cat ? " active" : ""}`}
                          onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="filter-drawer-section">
                    <span className="filter-label">Missing</span>
                    <div className="filter-chips-wrap">
                      <button
                        type="button"
                        className={`filter-chip${missingFilters.size === 0 ? " active" : ""}`}
                        onClick={() => setMissingFilters(new Set())}
                      >
                        None
                      </button>
                      {[
                        { key: "pdf", label: "PDF" },
                        { key: "dwg", label: "DWG" },
                        { key: "scan", label: "Scan" },
                        { key: "tags", label: "Tags" },
                      ].map(({ key, label }) => (
                        <button
                          type="button"
                          key={key}
                          className={`filter-chip${missingFilters.has(key) ? " active" : ""}`}
                          onClick={() =>
                            setMissingFilters((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="filter-drawer-section">
                    <span className="filter-label">Status</span>
                    <div className="filter-chips-wrap">
                      <button
                        type="button"
                        className={`filter-chip${archivedFilter ? " active" : ""}`}
                        onClick={() => setArchivedFilter((v) => !v)}
                      >
                        {archivedFilter ? "Archived" : "Active"}
                      </button>
                    </div>
                  </div>
                  <div className="filter-drawer-section">
                    <span className="filter-label">Radius</span>
                    <div className="filter-chips-wrap">
                      <button
                        type="button"
                        className={`filter-chip${hasRadiusFilter ? " active" : ""}`}
                        onClick={() => setHasRadiusFilter((v) => !v)}
                      >
                        Has Radius
                      </button>
                    </div>
                    {hasRadiusFilter && (
                      <div className="radius-range">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          className="radius-range-input"
                          placeholder="Min"
                          value={radiusMin}
                          onChange={(e) => setRadiusMin(e.target.value)}
                        />
                        <span className="radius-range-sep">–</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          className="radius-range-input"
                          placeholder="Max"
                          value={radiusMax}
                          onChange={(e) => setRadiusMax(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                  <div className="filter-drawer-section">
                    <span className="filter-label">Sort</span>
                    <select
                      className="sort-select"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      <option value="name">Name (A–Z)</option>
                      <option value="radius_asc">Radius (low → high)</option>
                      <option value="radius_desc">Radius (high → low)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
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
              <div className="filter-bar">
                <span className="filter-label">Missing</span>
                <button
                  type="button"
                  className={`filter-chip${missingFilters.size === 0 ? " active" : ""}`}
                  onClick={() => setMissingFilters(new Set())}
                >
                  None
                </button>
                {[
                  { key: "pdf", label: "PDF" },
                  { key: "dwg", label: "DWG" },
                  { key: "scan", label: "Scan" },
                  { key: "tags", label: "Tags" },
                ].map(({ key, label }) => (
                  <button
                    type="button"
                    key={key}
                    className={`filter-chip${missingFilters.has(key) ? " active" : ""}`}
                    onClick={() =>
                      setMissingFilters((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="filter-section">
                <span className="filter-label">Status</span>
                <button
                  type="button"
                  className={`filter-chip${archivedFilter ? " active" : ""}`}
                  onClick={() => setArchivedFilter((v) => !v)}
                >
                  {archivedFilter ? "Archived" : "Active"}
                </button>
                <span className="filter-label" style={{ marginLeft: 16 }}>Radius</span>
                <button
                  type="button"
                  className={`filter-chip${hasRadiusFilter ? " active" : ""}`}
                  onClick={() => setHasRadiusFilter((v) => !v)}
                >
                  Has Radius
                </button>
                {hasRadiusFilter && (
                  <span className="radius-range">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="radius-range-input"
                      placeholder="Min"
                      value={radiusMin}
                      onChange={(e) => setRadiusMin(e.target.value)}
                    />
                    <span className="radius-range-sep">–</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="radius-range-input"
                      placeholder="Max"
                      value={radiusMax}
                      onChange={(e) => setRadiusMax(e.target.value)}
                    />
                  </span>
                )}
                <span className="filter-label" style={{ marginLeft: 16 }}>Sort</span>
                <select
                  className="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="name">Name (A–Z)</option>
                  <option value="radius_asc">Radius (low → high)</option>
                  <option value="radius_desc">Radius (high → low)</option>
                </select>
              </div>
            </>
          )}
          <div className="grid-page">
            {loading ? (
              <div className="loading-wrap">Loading profiles...</div>
            ) : (
              <div
                className="grid"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}
              >
                {filtered.length === 0 ? (
                  <div className="empty-grid">No profiles found</div>
                ) : (
                  filtered.map((p) => (
                    <ProfileCard
                      key={p.id}
                      profile={p}
                      onClick={() => { setSelected(p.id); window.scrollTo(0, 0); }}
                      thumbSize={thumbSize}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
      {showCreateModal && (
        <CreateProfileModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleProfileCreated}
        />
      )}
    </>
  );
}
