// built from apps/account/src/clearAreas.ts by agol/build-clear-page.mjs; do not edit
// Clear map for the Drone Imagery Hosting Planner (G29, G32): the Experience Builder app can't run a script, so its
// Refresh button opens the static clear page (apps/clear-page), which runs this file in the browser. Plain TypeScript
// with no imports: agol/build-clear-page.mjs strips the types. Tested in test/planner.test.ts.

// Flight areas layer 0; test/planner.test.ts checks it against agol/planner.items.json
export const FLIGHT_AREAS_URL = "https://services6.arcgis.com/wYBZOirwtHa54pP0/arcgis/rest/services/Drone_Imagery_Planner_Flight_Areas/FeatureServer/0";

// everything on the map that isn't a gray ready-made parcel: drawn areas (no source_id), and ready-made parcels given a How often
export const CLEAR_WHERE = "source_id IS NULL OR flights_per_year IS NULL OR flights_per_year <> 0";
export const CLEAR_FIELDS = ["OBJECTID", "source_id", "flights_per_year", "area_name", "acres"];

                          
                   
                           
                                  
                            
                        
 

                            
                    
                                                           
                
                  
                
 

// ready-made parcels go back to how publishing made them (0 a year, nothing computed); drawn areas are deleted
export function clearPlan(rows           )            {
  const drawn = rows.filter((r) => !r.source_id);
  const parcels = rows.filter((r) => r.source_id && r.flights_per_year !== 0);
  return {
    deletes: drawn.map((r) => r.OBJECTID),
    updates: parcels.map((r) => ({
      attributes: { OBJECTID: r.OBJECTID, flights_per_year: 0, acre_flights_yr: 0, photos_per_flight: null, gb_per_flight: null, gb_per_year: null, tb_5yr: null },
    })),
    drawn: drawn.length,
    parcels: parcels.length,
    acres: Math.round([...drawn, ...parcels].reduce((s, r) => s + (r.acres ?? 0), 0) * 100) / 100,
  };
}

// the planner page to go back to, from #/clear-flight-areas?back=<url>; only the planner's own hosts, never an arbitrary site
export function backUrl(hash        )                {
  const q = hash.indexOf("?");
  if (q < 0) return null;
  return checkBack(new URLSearchParams(hash.slice(q + 1)).get("back"));
}

/** `back` if it is one of the planner's own hosts (https *.arcgis.com, or this PC), else null. */
export function checkBack(back               )                {
  if (!back) return null;
  try {
    const u = new URL(back);
    const ok = (u.protocol === "https:" && /(^|\.)arcgis\.com$/.test(u.hostname)) || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
    return ok ? u.href : null;
  } catch {
    return null;
  }
}

export const isClearRoute = (hash        ) => /^#\/clear-flight-areas(\?|$)/.test(hash);

export function chunks   (xs     , n        )        {
  const out        = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ------------------------------------------------------------------------- the static clear page (G32)
/** PKCE (RFC 7636): a random verifier and its S256 challenge, both base64url without padding. */
export async function pkcePair()                                                   {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
const b64url = (b            ) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** ArcGIS OAuth authorize URL (authorization code + PKCE). A browser already signed in to the org comes straight back. */
export function authorizeUrl(portal        , clientId        , redirectUri        , challenge        , state        )         {
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, expiration: "20" });
  return `${portal.replace(/\/+$/, "")}/sharing/rest/oauth2/authorize?${q}`;
}

/** POSTs a form with f=json and returns the JSON; an ArcGIS error body (HTTP 200) throws. */
                                                                                 
export function formPost(fetchImpl               = fetch)       {
  return async (url, params) => {
    const r = await fetchImpl(url, { method: "POST", body: new URLSearchParams({ f: "json", ...params }) });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || `ArcGIS error ${j.error.code}`);
    return j;
  };
}

/** Every row to clear (CLEAR_WHERE), paged until the service stops saying exceededTransferLimit. */
export async function rowsToClear(post      , layerUrl        , token        )                     {
  const rows            = [];
  for (let offset = 0; ; ) {
    const page = await post(`${layerUrl}/query`, { where: CLEAR_WHERE, outFields: CLEAR_FIELDS.join(","), returnGeometry: "false", orderByFields: "OBJECTID", resultOffset: String(offset), resultRecordCount: "1000", token });
    const got = (page.features ?? []).map((f     ) => f.attributes           );
    rows.push(...got);
    offset += got.length;
    if (!page.exceededTransferLimit || !got.length) return rows;
  }
}

/** Clears the map: deletes drawn areas, sets ready-made parcels back to 0 a year, 500 edits a call. Throws on any failed edit. */
export async function clearAll(post      , layerUrl        , token        , onProgress                         = () => {})                     {
  onProgress("Finding your flight areas…");
  const plan = clearPlan(await rowsToClear(post, layerUrl, token));
  const total = plan.deletes.length + plan.updates.length;
  let done = 0;
  const check = (r     , n        ) => {
    const bad = [...(r.updateResults ?? []), ...(r.deleteResults ?? [])].filter((x     ) => !x.success);
    if (bad.length) throw new Error(`${bad.length} of ${n} edits failed: ${bad[0].error?.description ?? "unknown error"}`);
    done += n;
    onProgress(`Cleared ${done} of ${total} areas…`);
  };
  for (const ids of chunks(plan.deletes, 500)) check(await post(`${layerUrl}/applyEdits`, { deletes: ids.join(","), rollbackOnFailure: "true", token }), ids.length);
  for (const ups of chunks(plan.updates, 500)) check(await post(`${layerUrl}/applyEdits`, { updates: JSON.stringify(ups), rollbackOnFailure: "true", token }), ups.length);
  return plan;
}
