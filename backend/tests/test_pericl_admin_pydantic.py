"""Iteration 4 backend tests — Roles, admin endpoints, Pydantic scores validation."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SA_TOKEN = "sa_sess_test_001"
USER_TOKEN = "test_sess_1777379746360"
USER_ID = "test-user-pericl-1777377818066"
SA_USER_ID = "user_superalwar01"


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -------- /auth/me role exposure --------
class TestAuthMe:
    def test_super_admin_role(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(SA_TOKEN))
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "super_admin"
        assert d["email"].lower() == "alwargiridhar@gmail.com"

    def test_regular_user_role(self):
        # First ensure user is demoted back to "user"
        requests.put(
            f"{BASE_URL}/api/admin/users/{USER_ID}/role",
            headers=_h(SA_TOKEN),
            json={"role": "user"},
        )
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(USER_TOKEN))
        assert r.status_code == 200
        assert r.json()["role"] == "user"


# -------- /api/admin/users + /api/admin/stats --------
class TestAdminEndpoints:
    def test_admin_users_super_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_h(SA_TOKEN))
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        assert len(users) >= 2
        for u in users:
            assert "role" in u and "storage_mode" in u and "last_seen_at" in u

    def test_admin_users_regular_403(self):
        # ensure user role
        requests.put(f"{BASE_URL}/api/admin/users/{USER_ID}/role",
                     headers=_h(SA_TOKEN), json={"role": "user"})
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_h(USER_TOKEN))
        assert r.status_code == 403

    def test_admin_stats_super_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/stats", headers=_h(SA_TOKEN))
        assert r.status_code == 200
        d = r.json()
        for k in ("total_users", "admins", "cloud_users", "active_7d"):
            assert k in d and isinstance(d[k], int)

    def test_admin_stats_regular_403(self):
        r = requests.get(f"{BASE_URL}/api/admin/stats", headers=_h(USER_TOKEN))
        assert r.status_code == 403


# -------- Role updates + authority rules --------
class TestRoleUpdates:
    def test_promote_user_to_admin_then_demote(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/users/{USER_ID}/role",
            headers=_h(SA_TOKEN), json={"role": "admin"},
        )
        assert r.status_code == 200
        assert r.json()["role"] == "admin"
        # Verify via /auth/me (no re-auth needed)
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(USER_TOKEN))
        assert me.json()["role"] == "admin"
        # Now user can list admin users
        adm = requests.get(f"{BASE_URL}/api/admin/users", headers=_h(USER_TOKEN))
        assert adm.status_code == 200
        # Demote back
        r2 = requests.put(
            f"{BASE_URL}/api/admin/users/{USER_ID}/role",
            headers=_h(SA_TOKEN), json={"role": "user"},
        )
        assert r2.status_code == 200
        assert r2.json()["role"] == "user"

    def test_regular_admin_cannot_grant_admin(self):
        # Promote user to admin first
        requests.put(f"{BASE_URL}/api/admin/users/{USER_ID}/role",
                     headers=_h(SA_TOKEN), json={"role": "admin"})
        try:
            # As regular admin, attempt to promote SA_USER (already super_admin) — try touching it
            r = requests.put(
                f"{BASE_URL}/api/admin/users/{SA_USER_ID}/role",
                headers=_h(USER_TOKEN), json={"role": "admin"},
            )
            assert r.status_code == 403

            # Cannot grant admin/super_admin to anyone (target=self via SA token target=other user)
            # Create the scenario: admin trying to promote another non-existent user should also fail role rule
            # Use SA user: target is super_admin → blocked
        finally:
            requests.put(f"{BASE_URL}/api/admin/users/{USER_ID}/role",
                         headers=_h(SA_TOKEN), json={"role": "user"})

    def test_super_admin_cannot_be_demoted(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/users/{SA_USER_ID}/role",
            headers=_h(SA_TOKEN), json={"role": "user"},
        )
        assert r.status_code == 403

    def test_invalid_role(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/users/{USER_ID}/role",
            headers=_h(SA_TOKEN), json={"role": "wizard"},
        )
        assert r.status_code == 400


# -------- DELETE user --------
class TestDeleteUser:
    def test_regular_admin_cannot_delete(self):
        # Promote test user to admin
        requests.put(f"{BASE_URL}/api/admin/users/{USER_ID}/role",
                     headers=_h(SA_TOKEN), json={"role": "admin"})
        try:
            r = requests.delete(
                f"{BASE_URL}/api/admin/users/{SA_USER_ID}",
                headers=_h(USER_TOKEN),
            )
            assert r.status_code == 403
        finally:
            requests.put(f"{BASE_URL}/api/admin/users/{USER_ID}/role",
                         headers=_h(SA_TOKEN), json={"role": "user"})

    def test_cannot_delete_super_admin(self):
        r = requests.delete(
            f"{BASE_URL}/api/admin/users/{SA_USER_ID}",
            headers=_h(SA_TOKEN),
        )
        assert r.status_code == 403

    def test_super_admin_can_delete_user_cascade(self):
        # Create a throwaway user via direct mongo? Instead, use the API -- no create user endpoint exists.
        # Insert via /auth/process-session is not testable here. So we'll create via mongosh.
        import subprocess
        tmp_uid = "TEST_throwaway_user_iter4"
        tmp_session = "TEST_throwaway_sess_iter4"
        cmd = f'''db.users.insertOne({{user_id:"{tmp_uid}",email:"throwaway@test.local",name:"Throw Away",role:"user",created_at:new Date().toISOString()}});
db.user_sessions.insertOne({{user_id:"{tmp_uid}",session_token:"{tmp_session}",expires_at:new Date(Date.now()+86400000).toISOString(),created_at:new Date().toISOString()}});
db.journal_items.insertOne({{id:"itm1",user_id:"{tmp_uid}",type:"text",title:"x",created_at:new Date().toISOString()}});
db.ai_messages.insertOne({{id:"m1",user_id:"{tmp_uid}",role:"user",content:"hi",created_at:new Date().toISOString()}});'''
        subprocess.run(["mongosh", "test_database", "--quiet", "--eval", cmd],
                       capture_output=True, timeout=15)
        # Now delete via API
        r = requests.delete(
            f"{BASE_URL}/api/admin/users/{tmp_uid}",
            headers=_h(SA_TOKEN),
        )
        assert r.status_code == 200
        # Verify cascade
        check_cmd = f'print(db.users.countDocuments({{user_id:"{tmp_uid}"}}) + "|" + db.journal_items.countDocuments({{user_id:"{tmp_uid}"}}) + "|" + db.ai_messages.countDocuments({{user_id:"{tmp_uid}"}}) + "|" + db.user_sessions.countDocuments({{user_id:"{tmp_uid}"}}));'
        out = subprocess.run(["mongosh", "test_database", "--quiet", "--eval", check_cmd],
                             capture_output=True, timeout=15, text=True)
        assert "0|0|0|0" in out.stdout, f"Cascade failed: {out.stdout}"


# -------- Pydantic scores validation --------
class TestPydanticScores:
    def test_invalid_scores_400(self):
        r = requests.post(
            f"{BASE_URL}/api/personality/assess",
            headers=_h(USER_TOKEN),
            json={"scores": {"E": -1, "I": "abc"}},
        )
        assert r.status_code == 400
        d = r.json()
        assert "Invalid scores" in (d.get("detail") or "")

    def test_empty_scores_defaults_to_zero(self):
        r = requests.post(
            f"{BASE_URL}/api/personality/assess",
            headers=_h(USER_TOKEN),
            json={"scores": {}},
        )
        # Could be 200 (success with defaults) — hits LLM
        assert r.status_code == 200
        d = r.json()
        assert "personality_type" in d
        for k in "EISNTFJP":
            assert d["scores"][k] == 0

    def test_personality_analyze_invalid_scores(self):
        r = requests.post(
            f"{BASE_URL}/api/ai/personality-analyze",
            headers=_h(USER_TOKEN),
            json={"scores": {"E": "bad"}},
        )
        assert r.status_code == 400


# -------- Existing endpoints regression --------
class TestRegression:
    def test_text_note(self):
        r = requests.post(f"{BASE_URL}/api/notes/text", headers=_h(USER_TOKEN),
                          json={"text": "TEST_iter4 note"})
        assert r.status_code == 200
        assert "note" in r.json()

    def test_timeline(self):
        r = requests.get(f"{BASE_URL}/api/timeline", headers=_h(USER_TOKEN))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_profile(self):
        r = requests.get(f"{BASE_URL}/api/profile", headers=_h(USER_TOKEN))
        assert r.status_code == 200

    def test_categorize(self):
        r = requests.post(f"{BASE_URL}/api/ai/categorize", headers=_h(USER_TOKEN),
                          json={"text": "I am happy today"})
        assert r.status_code == 200
        assert "mood" in r.json()
