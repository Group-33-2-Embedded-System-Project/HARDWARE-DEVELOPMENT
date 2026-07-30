# Smart Coop software

This folder implements the architecture in `app_architecture.md`:

- `backend/` is the Express + MQTT + Socket.io bridge. It persists alerts in SQLite and exposes authenticated command APIs.
- `frontend/` is the React PWA dashboard. It uses the backend only; MQTT credentials never enter the browser.

## Run locally

1. Copy `backend/.env.example` to `backend/.env`, configure its MQTT connection and change the default admin password.
2. Run `npm install` in both `backend` and `frontend`.
3. Start the backend with `npm run dev` inside `backend`.
4. Copy `frontend/.env.example` to `frontend/.env`, then run `npm run dev` inside `frontend`.

The initial credentials are controlled by `ADMIN_USERNAME` and `ADMIN_PASSWORD` on the backend. The first startup creates that account. For Web Push, generate VAPID keys with `npx web-push generate-vapid-keys` and put them in the backend environment.

## MQTT simulation

With the backend connected to Mosquitto, publish a test alert:

```sh
mosquitto_pub -h YOUR_BROKER -u coop_device -P PASSWORD -t coop/alert/predator -m 1
```

The dashboard should show its alert banner and the event should appear in history.
