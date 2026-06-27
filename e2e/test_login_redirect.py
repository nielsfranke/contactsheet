# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Regression coverage for the Safari re-login bug, through a real browser + real stack.

Two fixes work together (see commits 60e64cb / e88b153):
  1. /login redirects an already-authenticated admin straight to the dashboard — Safari often
     reopens the bookmarked …/login URL directly, which previously forced a needless re-login.
  2. The admin shell trusts the httponly cookie, not the localStorage flag — WebKit's ITP evicts
     localStorage while the cookie survives, so gating on the flag bounced admins to /login.
"""

ADMIN_USER = "e2e_admin"
ADMIN_PASS = "e2e-supersecret-123"
FLAG_KEY = "cs_admin_authenticated"


def test_login_redirects_when_already_authenticated(page, frontend_url, context):
    # Setup wizard → create the admin account (real browser form).
    page.goto(f"{frontend_url}/setup")
    page.fill("#username", ADMIN_USER)
    page.fill("#password", ADMIN_PASS)
    page.fill("#confirm", ADMIN_PASS)
    page.click("button[type=submit]")
    page.wait_for_url("**/login", timeout=30_000)

    # Logged-out admin actually sees the form (the checking gate resolves to "show form").
    page.locator("#username").wait_for(state="visible", timeout=30_000)

    page.fill("#username", ADMIN_USER)
    page.fill("#password", ADMIN_PASS)
    page.check("input[type=checkbox]")  # "Remember me"
    page.click("button[type=submit]")
    page.wait_for_url("**/admin/galleries", timeout=30_000)

    # Fix 1: opening /login directly with a valid session redirects to the dashboard, no form.
    page.goto(f"{frontend_url}/login")
    page.wait_for_url("**/admin/galleries", timeout=30_000)

    # Fix 2: even with the localStorage hint gone (as WebKit's ITP would do), the cookie alone
    # keeps the session — both /login and /admin resolve to the dashboard, not the login form.
    page.evaluate(f"localStorage.removeItem('{FLAG_KEY}')")
    page.goto(f"{frontend_url}/login")
    page.wait_for_url("**/admin/galleries", timeout=30_000)

    page.evaluate(f"localStorage.removeItem('{FLAG_KEY}')")
    page.goto(f"{frontend_url}/admin/galleries")
    page.wait_for_url("**/admin/galleries", timeout=30_000)
    # The admin shell only renders its sidebar once the cookie validates (checked === true) — waiting
    # for it proves we stayed in, not flashed before a bounce to /login.
    page.locator('a[href="/admin/settings"]').first.wait_for(timeout=30_000)
    # The hint is re-armed after the cookie validates, so it survives the next ITP-free visit.
    assert page.evaluate(f"localStorage.getItem('{FLAG_KEY}')") == "1"

    # Sanity: a brand-new browser context (no cookie) must still get the login form, not a redirect.
    fresh = context.browser.new_context()
    try:
        p = fresh.new_page()
        p.goto(f"{frontend_url}/login")
        p.locator("#username").wait_for(state="visible", timeout=30_000)
        assert "/admin" not in p.url
    finally:
        fresh.close()
