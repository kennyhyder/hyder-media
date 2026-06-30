#!/usr/bin/env python3
"""
gsc-submit-sitemaps.py [sitemap-index-url] — submit every child sitemap in an
index to Google Search Console via the API.

Why: GSC's UI only lets you submit one sitemap at a time; a sharded index with
hundreds of children is impractical by hand, and submitting just the index
sometimes reports "0 pages" until children are individually registered.

Scope: submitting requires the read-WRITE scope
`https://www.googleapis.com/auth/webmasters` (the GSC-loop token is readonly).
First run opens a browser for a one-time consent (loopback flow) and caches a
write refresh token as GSC_WRITE_REFRESH_TOKEN in grid/.env.local — subsequent
runs are fully non-interactive. Reusable for every property.

Reads GSC_CLIENT_ID / GSC_CLIENT_SECRET / GSC_SITE_URL from grid/.env.local.
"""
import json, os, re, sys, threading, urllib.parse, urllib.request, urllib.error, webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, "grid", ".env.local")
PORT = 8723
REDIRECT = f"http://localhost:{PORT}/"
WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters"
INDEX_URL = sys.argv[1] if len(sys.argv) > 1 else "https://gridcensus.com/sitemap-index.xml"


def load_env():
    env = {}
    for line in open(ENV_PATH):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'")
    return env


def save_env_var(key, val):
    lines = open(ENV_PATH).read().splitlines()
    out, found = [], False
    for ln in lines:
        if ln.startswith(key + "="):
            out.append(f"{key}={val}"); found = True
        else:
            out.append(ln)
    if not found:
        out.append(f"{key}={val}")
    open(ENV_PATH, "w").write("\n".join(out) + "\n")


def token_from_refresh(env, refresh):
    data = urllib.parse.urlencode({
        "client_id": env["GSC_CLIENT_ID"], "client_secret": env["GSC_CLIENT_SECRET"],
        "refresh_token": refresh, "grant_type": "refresh_token"}).encode()
    return json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data=data))["access_token"]


def has_write_scope(access_token):
    try:
        info = json.load(urllib.request.urlopen(
            f"https://oauth2.googleapis.com/tokeninfo?access_token={access_token}"))
        return WRITE_SCOPE in info.get("scope", "").split()
    except Exception:
        return False


def interactive_consent(env):
    code_box = {}

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.urlparse(self.path).query
            code_box["code"] = urllib.parse.parse_qs(q).get("code", [None])[0]
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
            self.wfile.write(b"<h2>GSC write access granted. You can close this tab.</h2>")
        def log_message(self, *a): pass

    srv = HTTPServer(("localhost", PORT), H)
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": env["GSC_CLIENT_ID"], "redirect_uri": REDIRECT, "response_type": "code",
        "scope": WRITE_SCOPE, "access_type": "offline", "prompt": "consent"})
    print("\nOpening Google consent in your browser for one-time GSC write access…")
    print("If it doesn't open, paste this URL:\n" + auth_url + "\n")
    webbrowser.open(auth_url)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    print("Waiting for you to approve…")
    import time
    for _ in range(300):
        if code_box.get("code"): break
        time.sleep(1)
    srv.server_close()
    code = code_box.get("code")
    if not code:
        print("✗ No authorization received (timed out). Re-run and approve in the browser."); sys.exit(1)
    data = urllib.parse.urlencode({
        "client_id": env["GSC_CLIENT_ID"], "client_secret": env["GSC_CLIENT_SECRET"],
        "code": code, "grant_type": "authorization_code", "redirect_uri": REDIRECT}).encode()
    tok = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data=data))
    if tok.get("refresh_token"):
        save_env_var("GSC_WRITE_REFRESH_TOKEN", tok["refresh_token"])
        print("✓ Cached GSC_WRITE_REFRESH_TOKEN (future runs need no browser).")
    return tok["access_token"]


def get_write_token(env):
    rt = env.get("GSC_WRITE_REFRESH_TOKEN")
    if rt:
        try:
            at = token_from_refresh(env, rt)
            if has_write_scope(at):
                print("✓ Using cached write token (no browser needed)."); return at
        except Exception:
            pass
    return interactive_consent(env)


def child_sitemaps(index_url):
    xml = urllib.request.urlopen(index_url).read().decode()
    return re.findall(r"<loc>\s*(.*?)\s*</loc>", xml)


def submit(site_url, sitemap_url, access_token):
    site_enc = urllib.parse.quote(site_url, safe="")
    feed_enc = urllib.parse.quote(sitemap_url, safe="")
    url = f"https://www.googleapis.com/webmasters/v3/sites/{site_enc}/sitemaps/{feed_enc}"
    req = urllib.request.Request(url, method="PUT", headers={"Authorization": f"Bearer {access_token}"})
    try:
        urllib.request.urlopen(req)
        return True, ""
    except urllib.error.HTTPError as e:
        return False, f"{e.code} {e.read().decode()[:120]}"


def main():
    env = load_env()
    site = env.get("GSC_SITE_URL", "sc-domain:gridcensus.com")
    print(f"Property: {site}\nIndex:    {INDEX_URL}")
    children = child_sitemaps(INDEX_URL)
    targets = [INDEX_URL] + children  # (re)submit the index too
    print(f"Submitting {len(targets)} sitemaps ({len(children)} children + index)…\n")
    at = get_write_token(env)
    ok, fail = 0, 0
    for i, sm in enumerate(targets, 1):
        good, err = submit(site, sm, at)
        if good:
            ok += 1
        else:
            fail += 1
            print(f"  ✗ {sm} → {err}")
        if i % 25 == 0 or i == len(targets):
            print(f"  …{i}/{len(targets)} (ok={ok} fail={fail})")
    print(f"\nDone. Submitted OK: {ok}/{len(targets)}; failed: {fail}.")
    print("GSC takes minutes-to-hours to crawl them; check Sitemaps report tomorrow for 'Success' + discovered URLs.")


if __name__ == "__main__":
    main()
