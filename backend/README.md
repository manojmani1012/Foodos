# Foodos Backend (FastAPI)

The Foodos API: authentication, orders, payments and delivery for the customer,
restaurant partner, delivery partner and admin apps.

Python 3.11 · FastAPI · PostgreSQL 17 (asyncpg)

## Setup

PostgreSQL must be running. From the repository root:

```powershell
.\db-start.ps1
```

Then, in this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_ACCESS_SECRET` and
`OTP_PEPPER`. Apply the schema:

```powershell
python -m db.migrate
```

Migrations are applied once each and recorded in `schema_migrations`. Editing an
applied migration makes the runner refuse to continue, so changes are made by
adding a new file rather than rewriting history.

Create the first admin (there is no admin sign-up screen):

```powershell
python -m db.create_admin admin@foodos.in "a strong password" "Your Name"
```

## Run

```powershell
uvicorn app.main:app --reload --port 4000
```

| URL | What |
|---|---|
| `http://localhost:4000/health` | Liveness check |
| `http://localhost:4000/health/deep` | Includes a database ping |
| `http://localhost:4000/docs` | Interactive API documentation |
| `http://localhost:4000/redoc` | Reference API documentation |

## Authentication

Customer, restaurant and delivery partner apps sign in with a phone number and a
4-digit OTP. The admin dashboard uses email and password. Signing in with a phone
number can never grant admin access.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/auth/otp/request` | Send a login code to a phone number |
| POST | `/api/v1/auth/otp/verify` | Exchange the code for a session |
| POST | `/api/v1/auth/admin/login` | Admin email and password sign-in |
| POST | `/api/v1/auth/refresh` | Exchange a refresh token for a new pair |
| POST | `/api/v1/auth/logout` | End the session |
| GET | `/api/v1/auth/me` | The signed-in user (requires an access token) |

Access tokens are JWTs valid for 15 minutes, sent as `Authorization: Bearer
<token>`. Refresh tokens are opaque, last 30 days, and rotate on every use; only
hashes are stored. Replaying an already-rotated refresh token is treated as a
theft and ends every session in that family.

Only a hash of each OTP is stored, bound to its phone number. A code expires in 5
minutes, allows 5 attempts, and a number can request at most 5 codes an hour with
a 30-second gap between them.

While `SMS_PROVIDER=console` the code is printed to the terminal, and
`EXPOSE_OTP_IN_RESPONSE=true` also returns it as `devCode`, so the apps work
before an SMS gateway is connected. Both are ignored in production.

New delivery partners and restaurant owners are created with `pending` status.
They can sign in, but an admin has to approve them before they go live.

### Mobile clients: refresh in one flight

Because refresh tokens rotate and replay ends the session, a client must never
run two refreshes at once. When several requests get a 401 together they have to
share a single refresh, or the second one presents an already-rotated token and
the user is signed out.

## Browsing: restaurants and menus

Open to anyone, so the apps are useful before signing in. When a valid token is
sent, each restaurant is marked with `isFavourite`; an expired token is treated
as "not signed in" rather than an error, so a stale session never blocks the menu.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/customer/restaurants` | List active restaurants |
| GET | `/api/v1/customer/restaurants/{id}` | One restaurant with its whole menu |
| GET | `/api/v1/customer/cuisines` | Cuisine chips, built from live data |
| GET | `/api/v1/customer/offers` | Currently valid platform offers |
| GET | `/api/v1/customer/favourites` | The customer's saved restaurants |
| PUT | `/api/v1/customer/favourites/{id}` | Save a restaurant |
| DELETE | `/api/v1/customer/favourites/{id}` | Remove one |

Listing accepts `city`, `search` (name or cuisine), `cuisine`, `vegOnly`, `limit`
(max 50) and `offset`. Favourites require a customer session; a delivery partner
token is refused.

Only `active` restaurants are visible. Pending, suspended and rejected ones are
reachable only through the admin APIs. A deleted menu item disappears, while a
sold-out one stays with `isAvailable: false` so the app can grey it out.

The detail endpoint returns the restaurant, every category, every item and every
add-on in a single response, because mobile networks punish extra round trips.

All money is paise: `24900` is ₹249. Delivery fee is a flat placeholder until
delivery zones arrive; the cart API will become the authority on price.

## Cart and orders

The server is the authority on price. Requests carry menu item ids, add-on ids
and quantities — never amounts. Every price is read fresh from the database, so a
tampered request cannot change what is charged. The app's own total is for
display only.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/customer/cart/quote` | Price a cart without placing it |
| POST | `/api/v1/customer/orders` | Place an order |
| GET | `/api/v1/customer/orders` | The customer's orders |
| GET | `/api/v1/customer/orders/{id}` | One order with its status timeline |
| POST | `/api/v1/customer/orders/{id}/cancel` | Cancel, before the kitchen starts |
| GET/POST/DELETE | `/api/v1/customer/addresses` | Saved delivery addresses |

Pricing is subtotal + delivery + packaging + 5% GST + tip − discount. The orders
table enforces that same arithmetic, so a total that does not add up is rejected
by the database, not just by the code.

A cart must come from one restaurant, every dish must be available, the
restaurant must be open, and an add-on only counts for the dish it belongs to.

### Coupons

Checked against the offer's validity window, minimum order, restaurant scope,
per-user limit, total usage limit and first-order-only rule. An invalid code does
not fail the quote: the cart still prices and the coupon explains itself
("Add ₹400 more to use this code"), so the app can show the reason. Placing an
order with a code that does not apply is refused outright.

Because offers carry per-user limits, applying one needs a signed-in customer.
A signed-out quote prices normally and reports "Sign in to use this code".

### Retrying checkout

A double-tap on "Place Order", or a retry after the connection dropped, must not
create a second order. The client sends an `idempotencyKey` it generates per
checkout attempt; a repeat of the same key returns the original order.

### Payment

Cash on delivery only for now. Card, UPI and wallet are refused with
`payment_method_unavailable` until the payment provider is connected, so the
whole loop works without waiting on Razorpay KYC.

### Snapshots

Order lines store the dish name, price and add-ons as they were at checkout, and
the delivery address is copied onto the order. A later menu edit, price change or
deleted address never rewrites an order that already exists.

## Restaurant partner app

Every route is scoped to the restaurant the signed-in owner owns. No endpoint
takes a restaurant id from the client, so an owner cannot reach another
restaurant's orders or menu. One owner, one restaurant for now; multi-outlet
brands need a restaurant id per request, which is a later change.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/restaurant/me` | The owner's restaurant |
| PATCH | `/api/v1/restaurant/settings` | The accepting-orders toggle |
| GET | `/api/v1/restaurant/dashboard` | Today's figures and queue counts |
| GET | `/api/v1/restaurant/orders?queue=new\|preparing\|ready` | The order queues |
| GET | `/api/v1/restaurant/orders/{id}` | One order with customer and items |
| POST | `/api/v1/restaurant/orders/{id}/accept` | Start cooking |
| POST | `/api/v1/restaurant/orders/{id}/reject` | Refuse, with a reason |
| POST | `/api/v1/restaurant/orders/{id}/ready` | Ready for pickup |
| GET | `/api/v1/restaurant/menu` | Categories, items and add-ons |
| POST | `/api/v1/restaurant/menu/categories` | Add a category |
| POST | `/api/v1/restaurant/menu/items` | Add a dish |
| PATCH | `/api/v1/restaurant/menu/items/{id}` | Change price, availability, anything |
| DELETE | `/api/v1/restaurant/menu/items/{id}` | Take a dish off the menu |

### The order lifecycle

```text
customer places   -> confirmed
restaurant accepts -> preparing
restaurant ready   -> ready
delivery partner   -> picked_up -> on_the_way -> delivered
```

Each stage is checked: a dish cannot be marked ready before it is accepted, an
order cannot be accepted twice, and an order the customer already cancelled
cannot be accepted at all. The row is locked for the transaction, so two taps on
Accept cannot both succeed. Rejecting cancels the order and records
`cancelled_by = 'restaurant'`.

The customer's own cancel window closes as soon as the restaurant accepts.

### Revenue

The dashboard counts only delivered orders as revenue. Anything still cooking
could still be cancelled, so it is reported separately as `inProgressPaise`.
"Today" is the calendar day, not a rolling 24 hours, so the figure matches what
the owner counts at closing.

### Menu changes

A dish is never hard-deleted: removal stamps `deleted_at`, so it leaves the menu
while past orders that reference it still read correctly. Turning availability
off keeps the dish visible to customers but greyed out, and refuses it at
checkout. `PATCH` changes only the fields sent, so a price edit leaves the name
alone.

## Development data

```powershell
python -m db.seed           # restaurants, menus and offers from the mockups
python -m db.seed --reset   # wipe the catalogue and rebuild it
```

Seeding refuses to run when `NODE_ENV=production`.

## Tests

```powershell
python -m pytest
```

The suite creates a throwaway `foodos_test` database on the local server, applies
the real migrations and drops it afterwards, so constraints behave exactly as in
production. PostgreSQL must be running.

## Layout

```text
backend/
├── app/
│   ├── main.py             FastAPI app, error handlers, health checks
│   ├── config.py           Settings from the environment
│   ├── database.py         asyncpg pool, query and transaction helpers
│   ├── errors.py           AppError and its constructors
│   ├── components/
│   │   ├── auth/           OTP, tokens, passwords, phone, service
│   │   └── notifications/  SMS providers
│   └── routers/            HTTP routes per domain
├── db/
│   ├── migrations/         Numbered SQL files
│   ├── migrate.py          Migration runner
│   └── create_admin.py     First admin account
└── tests/
```
