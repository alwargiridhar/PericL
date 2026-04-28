# PericL — Test Credentials

Auth: Emergent Managed Google Auth (no app-managed passwords).

## Active test sessions

### Regular user (role=user)
- user_id: `test-user-pericl-1777377818066`
- email: `alwar@test.local`
- name: `Alwar Test`
- session_token: `test_sess_1777379746360`
- role: `user`

### Super admin
- user_id: `user_superalwar01`
- email: `alwargiridhar@gmail.com`
- name: `Giridhar Alwar`
- session_token: `sa_sess_test_001`
- role: `super_admin`

## Cookie injection (Playwright)
- name: `session_token`
- domain: `pericl-staging.preview.emergentagent.com`
- path: `/`, httpOnly: true, secure: true, sameSite: None

## Backend curl (Authorization Bearer fallback)
```
curl -H "Authorization: Bearer test_sess_1777379746360" $URL/api/auth/me
curl -H "Authorization: Bearer sa_sess_test_001" $URL/api/admin/users
```

## Refresh sessions if expired
```
mongosh test_database --quiet --eval '
db.user_sessions.deleteMany({session_token: /test_sess_|sa_sess_/});

// regular user
var u = db.users.findOne({email:"alwar@test.local"});
if (!u) {
  db.users.insertOne({user_id:"test-user-pericl-1777377818066",email:"alwar@test.local",name:"Alwar Test",picture:"https://api.dicebear.com/7.x/notionists/svg?seed=Alwar",role:"user",created_at:new Date().toISOString()});
}
db.user_sessions.insertOne({user_id:"test-user-pericl-1777377818066",session_token:"test_sess_1777379746360",expires_at:new Date(Date.now()+7*24*3600*1000).toISOString(),created_at:new Date().toISOString()});

// super admin
var sa = db.users.findOne({email:"alwargiridhar@gmail.com"});
if (!sa) {
  db.users.insertOne({user_id:"user_superalwar01",email:"alwargiridhar@gmail.com",name:"Giridhar Alwar",picture:"https://api.dicebear.com/7.x/notionists/svg?seed=Giridhar",role:"super_admin",created_at:new Date().toISOString()});
} else {
  db.users.updateOne({email:"alwargiridhar@gmail.com"},{$set:{role:"super_admin"}});
}
db.user_sessions.insertOne({user_id:"user_superalwar01",session_token:"sa_sess_test_001",expires_at:new Date(Date.now()+7*24*3600*1000).toISOString(),created_at:new Date().toISOString()});
print("Done");
'
```
