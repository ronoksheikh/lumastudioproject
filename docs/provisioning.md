# Student accounts from lumademy.com (provisioning API)

Public sign-up is **off** by default (`SIGNUP_ENABLED=0`): `/signup` sends people to the login page, which tells
them to enrol at lumademy.com. When a student buys the course, lumademy.com's **backend** (never the browser)
calls Luma Studio and gets their login to e-mail them.

Set `PROVISION_API_KEY` on the Studio (e.g. `openssl rand -hex 32`) and the same value on lumademy.com.
Without it the API answers 404.

## Create an account

```
POST https://studio.lumademy.com/api/provision/users
Authorization: Bearer <PROVISION_API_KEY>
Content-Type: application/json

{ "email": "student@example.com" }
```

| Case | Status | Body |
|---|---|---|
| new email | 201 | `{ "email", "password": "k7mq-x4tz-9hwe", "created": true, "loginUrl" }` |
| account already exists | 200 | `{ "email", "password": null, "created": false, "loginUrl" }` |
| existing + `"resetPassword": true` | 200 | `{ "email", "password": "<new>", "created": false, "loginUrl" }` — signs them out everywhere |
| wrong/missing key | 401 | |

Calling it twice for the same email is safe (the second call doesn't change the password). Use
`resetPassword: true` for a "resend my Studio login" button. Students can change their password later in
Settings → Account.

## Refunds

```
POST /api/provision/users/revoke    { "email": "student@example.com" }   → { "email", "revoked": true }
POST /api/provision/users/restore   { "email": "student@example.com" }   → { "email", "restored": true }
```
Revoke suspends the account (signed out, can't log in; projects are kept). Restore undoes it.

## Example (Node, on the lumademy.com backend)

```js
const res = await fetch(`${process.env.LUMA_STUDIO_URL}/api/provision/users`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.LUMA_STUDIO_PROVISION_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email: order.email }),
});
const { password, loginUrl, created } = await res.json();
// e-mail the student (Resend): loginUrl, their email, and the password when one came back
```
