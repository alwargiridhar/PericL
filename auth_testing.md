# Auth-Gated App Testing Playbook (PericL)

## Step 1: Create Test User & Session
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend tests (use REACT_APP_BACKEND_URL from /app/frontend/.env)
```
curl -X GET "$URL/api/auth/me" -H "Authorization: Bearer $TOKEN"
curl -X GET "$URL/api/timeline" -H "Authorization: Bearer $TOKEN"
curl -X POST "$URL/api/notes/text" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"text":"Remind me to call mom tomorrow at 6pm"}'
```

## Step 3: Browser cookie injection (Playwright)
```
await page.context.add_cookies([{
    "name": "session_token", "value": TOKEN, "domain": HOST,
    "path": "/", "httpOnly": True, "secure": True, "sameSite": "None"
}]);
```

## Checklist
- users have user_id (UUID), session.user_id matches
- Queries always use {"_id": 0} projection
- /api/auth/me returns 200 with user payload
- Timeline loads, recording dock shows
