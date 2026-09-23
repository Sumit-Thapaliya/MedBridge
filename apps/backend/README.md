# MedBridge API (Backend)

Node.js + Express + PostgreSQL (via Prisma) backend for the MedBridge
medicine-exchange platform. Built to mirror the frontend's data shapes so
wiring the two together is straightforward.

## Stack
- Node.js + Express
- PostgreSQL
- Prisma ORM (schema, migrations, type-safe queries)
- JWT auth (`jsonwebtoken` + `bcryptjs`)
- Zod for request validation

## 1. Prerequisites
- Node.js 18+
- A running PostgreSQL instance (local install, or Docker: 
  `docker run --name medbridge-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`)

## 2. Setup
```bash
npm install
cp .env.example .env
# edit .env — at minimum set DATABASE_URL to your real Postgres connection
# string, and JWT_SECRET to a long random value.
```

## 3. Create the database schema
```bash
npm run prisma:migrate
```
This creates the tables described in `prisma/schema.prisma` (hospitals,
users, medicines, exchange requests, notifications, reports, inventory
movements) and generates the Prisma Client.

> If `prisma generate`/`migrate` can't reach the internet (corporate proxy,
> restricted sandbox, etc.) it will fail trying to download its query
> engine binaries — this is a Prisma requirement, not a bug in this code.
> It works normally on a machine with regular internet access.

## 4. Seed demo data
```bash
npm run seed
```
Creates 5 demo hospitals, sample medicines, exchange requests,
notifications, reports, and one login:
```
email:    sarah.johnson@cityhospital.org
password: password123
```

## Roles & permissions

Three roles, one hospital admin per hospital:

| Role | Can do |
|---|---|
| **Admin** | Everything — plus approve/reject pending accounts, create & delete users (Users page) |
| **Inventory Manager** | Add/edit/delete medicines (one-by-one or bulk Excel import) |
| **Staff** | Request stock, view & search inventory |

- **Registration.** A new hospital registers an admin (`POST /auth/register-hospital`).
  Staff & Inventory Managers self-register against an existing hospital
  (`POST /auth/register-member`) and start **PENDING** — they can only sign in after
  the hospital admin approves them (Users page).
- **No duplicate admins.** The Admin role is never self-assignable and never
  assignable by an admin, so a hospital can't accumulate multiple admins.

## Bulk medicine import (Excel/CSV)

`POST /medicines/bulk` (Admin / Inventory Manager) accepts `{ rows: [...] }`.
The spreadsheet must contain these **required headers**:

```
name, category, batch, quantity, unit, expiry
```

Optional headers: `unitPrice`, `status`, `medicineCode`. Header matching is
case-insensitive and tolerates spaces/underscores (e.g. "Unit Price", "Expiry Date").
Missing or unrecognised headers return a 400 with the offending column names.

## 5. Run the server
```bash
npm run dev        # http://localhost:4000, auto-restarts on changes
npm start          # production mode
```

## Project structure
```
prisma/
  schema.prisma      # ⭐ single source of truth for the database shape
  seed.js            # demo data, mirrors the frontend's old mock data
src/
  index.js           # entry point
  app.js             # Express app + route mounting — add new resources here
  config/db.js       # Prisma client singleton
  middleware/
    auth.js          # requireAuth / requireRole
    validate.js       # Zod body validation
    errorHandler.js    # centralized error responses
  routes/            # one file per resource, thin — just wires HTTP verbs
  controllers/        # thin — parses req, calls a service, shapes response
  services/            # business logic + Prisma queries live here
  utils/
    validators/         # Zod schemas per resource
    jwt.js, ApiError.js, asyncHandler.js
```

## Adding a new resource
1. Add a model to `prisma/schema.prisma`, run `npm run prisma:migrate`.
2. Create `services/<name>.service.js` (Prisma queries + business rules).
3. Create `controllers/<name>.controller.js` (thin HTTP layer).
4. Create `routes/<name>.routes.js` and mount it in `src/app.js`.

## API reference

All routes except `/health` and `/api/auth/*` require:
`Authorization: Bearer <token>` (returned from login/register).

Every authenticated request is automatically scoped to the caller's own
hospital (`req.user.hospitalId`) — one hospital can never see or modify
another's private inventory, only the shared exchange-request data that
explicitly involves both.

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register-hospital` | Onboard a new hospital + its first admin |
| POST | `/api/auth/register` | Add a staff account to an existing hospital |
| POST | `/api/auth/login` | Log in, returns `{ token, user }` |
| GET  | `/api/auth/me` | Current user's profile |
| GET  | `/api/hospitals` | List all partner hospitals |
| GET  | `/api/hospitals/:id` | Hospital detail |
| GET  | `/api/medicines` | List this hospital's inventory (`?search=&status=`) |
| GET  | `/api/medicines/meta/expiring-soon` | Medicines expiring soon (`?days=30`) |
| GET  | `/api/medicines/meta/categories` | Category breakdown for the donut chart |
| POST | `/api/medicines` | Add a medicine |
| PATCH | `/api/medicines/:id` | Update a medicine |
| DELETE | `/api/medicines/:id` | Remove a medicine |
| GET  | `/api/exchange-requests` | List requests (`?direction=incoming|outgoing`) |
| POST | `/api/exchange-requests` | Request stock from another hospital |
| PATCH | `/api/exchange-requests/:id/status` | Approve/decline/update status |
| GET  | `/api/notifications` | List notifications |
| PATCH | `/api/notifications/read-all` | Mark all as read |
| PATCH | `/api/notifications/:id/read` | Mark one as read |
| GET  | `/api/reports` | List generated reports |
| POST | `/api/reports` | Create a report record |
| GET  | `/api/dashboard/stats` | Dashboard stat cards |
| GET  | `/api/dashboard/inventory-overview` | 7-day stock in/out for the trend chart |
| GET  | `/api/demand-forecast` | Actual vs. forecast demand (placeholder model — see note below) |
| GET  | `/api/ai/forecast-insight` | AI seam — returns `{ available: false, message }` today |
| GET  | `/api/ai/smart-match` | AI seam — same placeholder shape |
| POST | `/api/ai/assistant` | AI seam — same placeholder shape |

## Connecting the frontend
In the React app's `src/services/api.js` and `aiService.js`, replace the
mock-data function bodies with `fetch` calls to these endpoints (base URL
`http://localhost:4000/api`), storing the JWT from login and sending it
as `Authorization: Bearer <token>` on every request. The response shapes
here were designed to match what those frontend files already expect.

## Note on `/api/demand-forecast`
This currently returns a simple trailing-average projection computed from
real `InventoryMovement` rows — it is **not** a real forecasting model. It
exists so the endpoint and chart work end-to-end today. Swap the
calculation in `src/services/demandForecast.service.js` for a real
model/service later; the response shape (`{ month, actual, forecast }[]`)
can stay the same, matching `/api/ai/forecast-insight` in spirit.
