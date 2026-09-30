# Foodos

Foodos is a food delivery platform prototype with three mobile-oriented portals and one desktop admin portal:

- Customer App
- Delivery Partner App
- Restaurant Partner App
- Admin Dashboard

The current implementation is a frontend prototype using React, Vite, local mock data, and browser navigation. The backend folder is scaffolded but does not yet provide API, database, authentication, payment, or realtime functionality.

## Requirements Document

### Product Goal

Provide a single food delivery platform where customers can order food, restaurants can manage orders and menus, delivery partners can complete deliveries, and administrators can monitor and manage the platform.

### User Roles

| Role | Main responsibilities |
|---|---|
| Customer | Browse restaurants, search menus, build a cart, select payment, track orders, manage profile |
| Delivery Partner | Go online, accept delivery requests, navigate to pickup and customer, update delivery status, view earnings |
| Restaurant Partner | Accept orders, manage order status, manage menu items, view restaurant performance |
| Administrator | Manage orders, restaurants, delivery partners, customers, payments, offers, support, settings, and logs |

### Customer App Requirements

- Splash and brand screen
- Phone login and OTP prototype
- Home page with location, search, categories, offers, and restaurants
- Restaurant page with restaurant information and menu categories
- Menu item details with add-ons and quantity selection
- Cart with item quantities, coupon code, fees, discount, and total
- Payment method selection for UPI, cards, wallet, and cash on delivery
- Order tracking timeline: Confirmed, Preparing, Picked Up, On the Way, Delivered
- Rider details and map placeholder
- Orders list with clickable order details
- Favourites list
- Profile with saved addresses, payments, support, and logout

### Delivery Partner App Requirements

- Splash and login screens
- Dashboard with online/offline status
- Today's earnings, trips, hours, rating, and incentive progress
- New delivery request with pickup/drop details, distance, earnings, countdown, accept, and reject
- Delivery flow: accepted, pickup, navigation, arrived, delivered
- Earnings screen with daily, weekly, and monthly views
- Earnings history chart and breakdown
- Profile menu with vehicle, documents, payouts, support, settings, and logout

### Restaurant Partner App Requirements

- Splash and login screens
- Dashboard with accepting-orders toggle
- Today's revenue and order summary
- Orders grouped by New, Preparing, and Ready
- Order details with items, customer, total, accept, and reject actions
- Add menu item form with photo placeholder, name, category, price, description, and availability
- Restaurant profile and management menu

### Admin Dashboard Requirements

- Full-width desktop web layout
- Sidebar navigation
- Dashboard overview with KPIs, order chart, order status breakdown, and recent orders
- Orders management with status filters
- Restaurant management
- Delivery partner management
- Customer management
- Analytics and reports
- Payments and settlements
- Offers and promotions
- Support tickets
- Settings and system activity logs

## Current Routes

The Vite frontend serves all portals from one development server:

| URL | Portal |
|---|---|
| `http://localhost:5173/` | Customer App |
| `http://localhost:5173/delivery` | Delivery Partner App |
| `http://localhost:5173/restaurant` | Restaurant Partner App |
| `http://localhost:5173/admin` | Admin Dashboard |

The Customer, Delivery Partner, and Restaurant Partner portals use a mobile-sized preview. The Admin Dashboard uses the full browser width.

## Technology Requirements

### Required

- Node.js 18 or newer
- npm
- Windows PowerShell, Git Bash, WSL, macOS Terminal, or Linux shell
- A modern browser

### Optional

- Python 3.11 and ReportLab for regenerating the investor plan PDF
- Git for version control
- VS Code for development

### Python Virtual Environment

The root `requirements.txt` contains the Python packages used by the project tools. Create and activate the local environment, then install the requirements:

```powershell
cd C:\food
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

On Bash, WSL, macOS, or Linux:

```bash
cd /path/to/food
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

The frontend is React and its dependencies are defined in `frontend/package.json`. The backend is Python (FastAPI); its dependencies are in `backend/requirements.txt` and install into `backend/.venv`. The root `requirements.txt` is only for the investor PDF generator.

## Project Structure

```text
food/
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── AppRouter.jsx
│       ├── index.css
│       ├── assets/
│       ├── components/
│       └── apps/
│           ├── customer/
│           ├── delivery-partner/
│           ├── restaurant-partner/
│           └── admin/
├── backend/
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── components/
│   │   └── routers/
│   ├── db/
│   │   ├── migrations/
│   │   ├── migrate.py
│   │   └── create_admin.py
│   └── tests/
├── db-start.ps1
├── db-stop.ps1
├── start.ps1
├── stop.ps1
├── start.sh
├── stop.sh
├── Foodos_60Day_Plan.pdf
└── generate_plan_pdf.py
```

## Run on Windows PowerShell

Open PowerShell in the project root:

```powershell
cd C:\food
```

Start the frontend in the background:

```powershell
.\start.ps1
```

The script installs frontend dependencies when needed, starts Vite, writes the process ID to `.frontend.pid`, writes logs to `frontend.log`, and prints the URL.

Open one of these URLs:

```text
http://localhost:5173/
http://localhost:5173/delivery
http://localhost:5173/restaurant
http://localhost:5173/admin
```

Stop the frontend:

```powershell
.\stop.ps1
```

If PowerShell blocks the script because of execution policy:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
powershell -ExecutionPolicy Bypass -File .\stop.ps1
```

## Run with Bash, Git Bash, WSL, macOS, or Linux

From the project root:

```bash
cd /path/to/food
bash start.sh
```

Stop the frontend:

```bash
bash stop.sh
```

The shell scripts require Bash, Node.js, npm, and curl. On Windows, use `start.ps1` unless Git Bash or WSL is installed.

## Run Directly Without Scripts

```powershell
cd C:\food\frontend
npm install
npm run dev -- --port 5173
```

The frontend package also supports:

```powershell
npm run build
npm run preview
```

## Backend Roadmap

The backend is being built phase by phase so the platform grows in a controlled way. Phase 2 foundation is now started with an Express app shell, environment loading, database config stub, shared middleware, and route modules.

### Phase 2: Backend Foundation

- [x] API framework and application configuration
- [x] PostgreSQL schema and migrations (36 tables across `backend/db/migrations/`)
- [x] OTP authentication, JWT sessions, and role-based access
- [ ] Customer, restaurant, delivery partner, and admin API endpoints

#### Database setup

The backend needs PostgreSQL. Amazon RDS for PostgreSQL runs the same engine, so
development uses the matching major version and no code changes are needed to
move to RDS later.

On this machine PostgreSQL 17.6 is already installed from the official binaries,
deliberately outside the repository so it is never committed:

| Path | Contents |
|---|---|
| `C:\foodos\pg\pgsql` | PostgreSQL program files |
| `C:\foodos\pgdata` | The database itself, and `server.log` |

It runs on `127.0.0.1:5432` and accepts connections from this machine only. It is
not registered as a Windows service, so it does not start automatically after a
reboot:

```powershell
.\db-start.ps1
.\db-stop.ps1
```

Then configure and migrate. Copy `backend/.env.example` to `backend/.env` and set
`DATABASE_URL`, `JWT_ACCESS_SECRET` and `OTP_PEPPER` (`backend/.env` is git-ignored
and already exists on this machine):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m db.migrate
```

To set up on another machine, install PostgreSQL 17 by any means, create an empty
`foodos` database, point `DATABASE_URL` at it, and run the migration command.

Migrations are applied once each and recorded in a `schema_migrations` table.
Edit an applied migration and the runner refuses to continue, so changes are
made by adding a new file rather than rewriting history.

Create the first admin for the dashboard (there is no admin sign-up screen):

```powershell
python -m db.create_admin admin@foodos.in "a strong password" "Your Name"
```

Run the API:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 4000
```

`--host 0.0.0.0` lets a phone on the same Wi-Fi reach the API. Without it the
server answers only on this machine. The apps work out the API address from the
page they were served from, so no extra configuration is needed; set
`VITE_API_BASE_URL` in `frontend/.env` only when the API lives elsewhere.

Interactive API documentation is generated from the code at
`http://localhost:4000/docs`.

#### Authentication

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

Access tokens are JWTs valid for 15 minutes and sent as
`Authorization: Bearer <token>`. Refresh tokens are opaque, last 30 days, and
rotate on every use; only hashes are stored. Replaying an already-rotated refresh
token is treated as a theft and ends every session in that family.

Only a hash of each OTP is stored. A code expires in 5 minutes, allows 5 attempts,
and a number can request at most 5 codes an hour with a 30-second gap between them.

While `SMS_PROVIDER=console`, the code is printed to the backend terminal, and
`EXPOSE_OTP_IN_RESPONSE=true` also returns it as `devCode` in the response so the
apps work before an SMS gateway is connected. Both are ignored in production.

New delivery partners and restaurant owners are created with `pending` status.
They can sign in, but an admin has to approve them before they go live.

#### Tests

```powershell
cd backend
python -m pytest
```

The suite creates a throwaway `foodos_test` database on the local server, applies
the real migrations and drops it afterwards, so constraints behave exactly as in
production. PostgreSQL must be running.

### Phase 3: Orders and Payments

- Cart, address, coupon, and checkout APIs
- Razorpay integration and webhook handling
- Payment verification, failure handling, and retry flow
- Wallet, refund, commission, and settlement logic

### Phase 4: Delivery, Maps, and Realtime

- Delivery assignment logic
- WebSocket-based order updates
- Google Maps, GPS, route, ETA, and live location features
- Delivery-zone validation and order tracking synchronization

### Phase 5: Notifications, Security, and Operations

- Firebase push notifications
- SMS and email notifications
- Validation, error handling, logging, and rate limits
- HTTPS, environment variables, secret protection, and backups

### Phase 6: Admin Reporting and Scale

- Analytics APIs and reporting endpoints
- Customer, restaurant, and delivery partner management APIs
- Support, GST, invoices, and operational dashboards
- Load, monitoring, and deployment readiness

### Backend Smoke Check

The backend root can be started for a smoke check:

```powershell
cd C:\food\backend
npm run dev
```

The current backend code is a scaffold for the phase-wise buildout, not the final production server.

## Testing Status

Current testing is frontend smoke testing and diagnostics of the React files. Automated tests have not yet been added.

The testing phase should include:

- Component tests for forms, tabs, cards, and navigation
- API unit tests for services and validation
- Integration tests using a test database
- End-to-end tests for customer order flow
- Partner order acceptance and delivery flow tests
- Payment sandbox and webhook tests
- WebSocket and location update tests
- Responsive browser testing
- Load and performance tests
- User acceptance testing for all four portals

## External Services Planned

These services are required for a production version, but are not connected to the current prototype:

- PostgreSQL: users, restaurants, menus, orders, payments, and earnings
- Redis: carts, sessions, queues, and realtime location state
- Razorpay: UPI, card, wallet, refunds, and payment webhooks
- SMS provider such as MSG91 or Twilio: OTP and delivery updates
- Firebase Cloud Messaging: push notifications
- Google Maps Platform: maps, routes, distance, and ETA
- S3 or Cloudinary: image storage and delivery
- Sentry or equivalent: error monitoring
- Domain, HTTPS, staging, production hosting, and CI/CD

## Development Workflow

1. Start the frontend with `start.ps1` on Windows or `start.sh` in Bash.
2. Choose the portal from its route.
3. Complete and review the frontend flow using mock data.
4. Build the backend contracts and database schema.
5. Replace mock data with API calls one domain at a time.
6. Add authentication and role protection.
7. Integrate payments, notifications, maps, and realtime tracking.
8. Add automated tests and run integration/UAT checks.
9. Deploy staging, verify production configuration, then deploy production.

## Important Prototype Limitations

The customer app is no longer a prototype. Login, browsing, menus, offers,
favourites, cart pricing, checkout, order history and tracking all run against
the API and PostgreSQL. Orders survive a refresh because they live in the
database.

What remains simulated:

- The OTP is shown on screen instead of sent by SMS, and social sign-in is
  disabled until a provider is configured.
- Cash on delivery is the only payment method. Card, UPI and wallet are shown but
  disabled until the payment provider is connected, and no real payment is
  charged.
- Order status stops at `confirmed`: the restaurant and delivery partner apps
  that would advance it are not built yet, so tracking polls a status nothing
  moves.
- Delivery partner, restaurant partner and admin portals still run on local mock
  data.
- The map is a visual placeholder; no GPS or live tracking is connected.
- No push notifications.

## Investor Documents

`Foodos_60Day_Plan.pdf` contains the two-person 60-day delivery plan and the cost/tooling estimate for services such as hosting, database, Razorpay, SMS, Maps, storage, monitoring, and Claude Standard subscriptions.

To regenerate it after editing `generate_plan_pdf.py`:

```powershell
C:/Users/2000112447/AppData/Local/Programs/Python/Python311/python.exe .\generate_plan_pdf.py
```
