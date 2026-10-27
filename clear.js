// The planner's Refresh button lands here (G32): sign in (silent when the browser already has an ArcGIS Online
// session), clear every flight area, go back to the planner page, which then opens fresh with an empty map and list.
// Logic lives in clearAreas.js (built from apps/account/src/clearAreas.ts); this file is only the page glue.
import { PORTAL, CLIENT_ID, AREAS_URL, DEFAULT_BACK } from "./config.js";
import { pkcePair, authorizeUrl, formPost, clearAll, checkBack } from "./clearAreas.js";

const KEY = "planner-clear";
const status = document.getElementById("status");
const say = (text) => { status.textContent = text; };
const redirectUri = location.origin + location.pathname;

function showBack(back) {
  const p = document.getElementById("back");
  p.querySelector("a").href = back;
  p.hidden = false;
}

async function start() {
  const q = new URLSearchParams(location.search);
  if (q.has("error")) throw new Error(q.get("error_description") || q.get("error"));

  if (!q.has("code")) {
    const back = checkBack(q.get("back")) ?? DEFAULT_BACK;
    const { verifier, challenge } = await pkcePair();
    const state = crypto.randomUUID();
    sessionStorage.setItem(KEY, JSON.stringify({ verifier, state, back }));
    location.replace(authorizeUrl(PORTAL, CLIENT_ID, redirectUri, challenge, state));
    return;
  }

  const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
  sessionStorage.removeItem(KEY);
  history.replaceState(null, "", redirectUri);
  if (!saved || saved.state !== q.get("state")) throw new Error("the sign-in came back without the request this page sent. Press Refresh in the planner again.");
  showBack(saved.back);

  const post = formPost();
  const { access_token } = await post(`${PORTAL}/sharing/rest/oauth2/token`, {
    client_id: CLIENT_ID, grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri, code_verifier: saved.verifier,
  });
  const plan = await clearAll(post, AREAS_URL, access_token, say);
  const n = plan.drawn + plan.parcels;
  say(n ? `Cleared ${n} flight area${n === 1 ? "" : "s"}. Going back to the planner…` : "The map was already clear. Going back to the planner…");
  location.replace(saved.back);
}

start().catch((e) => {
  document.getElementById("main").classList.add("done");
  status.classList.add("error");
  say(`Could not clear the map: ${e.message}`);
  if (!document.getElementById("back").hidden) return;
  const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
  showBack(saved?.back ?? checkBack(new URLSearchParams(location.search).get("back")) ?? DEFAULT_BACK);
});
