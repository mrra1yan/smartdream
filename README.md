# Smart Dream

A full-stack **ad-view give-and-take platform** built with Next.js 15. Users share Adsterra ad-viewer links, like each other's links (which triggers real ad impressions), and earn reciprocal exposure through a fairness-based feed algorithm. The platform includes a multi-tier role system (User → Admin → Super Admin → Elite), premium monetization features (Boost & Auto-Like), a blog CMS, a referral program, and full bilingual (English / Bengali) internationalization.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Authentication & Authorization](#authentication--authorization)
- [Role System](#role-system)
- [Feed Algorithm](#feed-algorithm)
- [Like System & Ad Views](#like-system--ad-views)
- [Premium Features](#premium-features)
- [Referral System](#referral-system)
- [Level / Rank System](#level--rank-system)
- [Blog System](#blog-system)
- [Internationalization (i18n)](#internationalization-i18n)
- [Admin Dashboard](#admin-dashboard)
- [Super Admin Dashboard](#super-admin-dashboard)
- [Public Pages](#public-pages)
- [API Routes](#api-routes)
- [Middleware](#middleware)
- [Deployment](#deployment)
- [Important Constants](#important-constants)

---

## Tech Stack

| Layer            | Technology                                                        |
| ---------------- | ----------------------------------------------------------------- |
| **Framework**    | [Next.js 15](https://nextjs.org) (App Router, Server Components) |
| **Language**     | TypeScript 5                                                      |
| **Styling**      | Tailwind CSS 4                                                    |
| **Database**     | MySQL 8 (self-hosted, docker-compose)                            |
| **Data access**  | `mysql2` + thin repository layer (`src/lib/repos/*`)             |
| **Cache/Realtime**| Redis 7 (object cache, rate limiting, pub/sub → SSE)            |
| **Auth**         | Custom JWT sessions ([jose](https://github.com/panva/jose))       |
| **Passwords**    | bcryptjs                                                          |
| **Animations**   | Framer Motion                                                     |
| **State**        | Zustand                                                           |
| **Toasts**       | Sonner                                                            |
| **Icons**        | Lucide React                                                      |
| **Theming**      | next-themes (light / dark / system)                               |
| **Validation**   | Zod 4                                                             |
| **Fonts**        | Geist Sans & Geist Mono (via `next/font/google`)                  |
| **Deploy**       | VPS (Node) + docker-compose (MySQL 8 + Redis 7)                |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js App Router                  │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐ │
│  │  (auth)   │ │  (main)  │ │  (admin)  │ │(super-    │ │
│  │  group    │ │  group   │ │  group    │ │ admin)    │ │
│  │          │ │          │ │           │ │  group    │ │
│  │ /login   │ │ /        │ │ /admin    │ │/super-   │ │
│  │ /signup  │ │ /profile │ │ /admin/*  │ │admin/*   │ │
│  │ /admin/  │ │ /links   │ │           │ │           │ │
│  │  login   │ │ /stats   │ └───────────┘ └───────────┘ │
│  │ /super-  │ │ /blog/*  │                             │
│  │  admin/  │ │ /premium │  ┌──────────┐               │
│  │  login   │ │ /boosted │  │ (public) │               │
│  └──────────┘ └──────────┘  │ /faq     │               │
│                              │ /terms   │               │
│                              │ /how-it- │               │
│                              │  works   │               │
│                              └──────────┘               │
├─────────────────────────────────────────────────────────┤
│                    Middleware (JWT)                      │
│          Route guards · Session refresh · RBAC          │
├─────────────────────────────────────────────────────────┤
│                   Server Actions                        │
│  auth · admin · super-admin · like · links · profile    │
│  blog · settings · i18n                                 │
├─────────────────────────────────────────────────────────┤
│                    API Routes                           │
│  /api/feed · /api/boosted-feed · /api/auto-like         │
│  /api/embed-frame · /api/logout · /api/test                │
├─────────────────────────────────────────────────────────┤
│               Drizzle ORM + SQLite / D1                 │
│  profiles · links · likes · blogs · settings            │
└─────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
Smart Dream/
├── src/
│   ├── app/
│   │   ├── (auth)/              # Auth route group (login, signup)
│   │   │   ├── login/
│   │   │   ├── signup/
│   │   │   ├── admin/login/
│   │   │   ├── super-admin/login/
│   │   │   └── layout.tsx       # Auth-specific layout with hero
│   │   ├── (main)/              # User dashboard route group
│   │   │   ├── page.tsx         # Home — blog carousel + stats + feed
│   │   │   ├── profile/
│   │   │   ├── links/
│   │   │   ├── stats/
│   │   │   ├── blog/[slug]/
│   │   │   ├── premium/
│   │   │   ├── boosted/
│   │   │   └── layout.tsx       # Sidebar navigation layout
│   │   ├── (admin)/admin/       # Admin dashboard route group
│   │   │   ├── page.tsx         # Dashboard overview + pending users
│   │   │   ├── users/[id]/      # User detail (read-only stats + controls)
│   │   │   ├── blog/            # Blog CMS
│   │   │   ├── settings/        # Platform settings
│   │   │   └── layout.tsx
│   │   ├── (super-admin)/super-admin/  # Super admin route group
│   │   │   ├── page.tsx         # Enhanced dashboard
│   │   │   ├── admins/          # Admin management
│   │   │   ├── users/           # Full user management
│   │   │   ├── elite/           # Elite user management
│   │   │   ├── audit/           # Audit logs
│   │   │   ├── settings/        # Extended settings
│   │   │   └── layout.tsx
│   │   ├── (public)/            # Public pages (no auth required)
│   │   │   ├── faq/
│   │   │   ├── how-it-works/
│   │   │   ├── terms/
│   │   │   └── layout.tsx
│   │   ├── actions/             # Server Actions
│   │   │   ├── auth.ts          # Login, signup, password change
│   │   │   ├── admin.ts         # User approval, premium activation
│   │   │   ├── super-admin.ts   # Elite, admin promotion/demotion
│   │   │   ├── like.ts          # Like creation + fairness logic
│   │   │   ├── links.ts         # CRUD for user links
│   │   │   ├── profile.ts       # Profile editing
│   │   │   ├── blog.ts          # Blog CRUD
│   │   │   ├── settings.ts      # Settings mutations
│   │   │   └── i18n.ts          # Locale switching
│   │   ├── api/                 # Route Handlers
│   │   │   ├── feed/            # Paginated feed endpoint
│   │   │   ├── boosted-feed/    # Boosted-only feed endpoint
│   │   │   ├── auto-like/       # Auto-like background worker
│   │   │   ├── embed-frame/     # Verification iframe proxy (SSR-safe)
│   │   │   ├── logout/          # Session destruction
│   │   │   └── test/            # Dev-only test endpoint
│   │   ├── globals.css          # Tailwind v4 global styles
│   │   ├── layout.tsx           # Root layout (themes, i18n, toaster)
│   │   ├── template.tsx         # Template wrapper
│   │   └── icon.tsx             # Dynamic favicon
│   ├── components/
│   │   ├── ui/                  # Shared primitives
│   │   │   ├── button.tsx       # CVA-based button component
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── password-input.tsx
│   │   │   ├── confirm-modal.tsx
│   │   │   └── motion-wrapper.tsx
│   │   ├── admin/               # Admin-specific components
│   │   │   ├── pending-users-list.tsx
│   │   │   ├── users-manager-client.tsx
│   │   │   ├── user-controls.tsx
│   │   │   └── settings-form.tsx
│   │   ├── super-admin/         # Super admin components
│   │   │   ├── admins-manager.tsx
│   │   │   ├── create-account-form.tsx
│   │   │   ├── elite-manager.tsx
│   │   │   ├── elite-weight-form.tsx
│   │   │   ├── level-referral-settings-form.tsx
│   │   │   ├── super-user-actions.tsx
│   │   │   └── users-manager.tsx
│   │   ├── app-sidebar.tsx      # Main sidebar navigation
│   │   ├── feed.tsx             # Feed card renderer
│   │   ├── boosted-feed.tsx     # Boosted feed with offer tracker
│   │   ├── autolike-button.tsx  # Auto-like start/stop/pause UI
│   │   ├── ad-container.tsx     # Ad iframe + 4-sec countdown
│   │   ├── blog-carousel.tsx    # Hero blog post carousel
│   │   ├── blog-manager.tsx     # Blog editor (admin)
│   │   ├── links-manager.tsx    # Link CRUD manager
│   │   ├── link-card.tsx        # Individual link display card
│   │   ├── login-form.tsx       # Login form component
│   │   ├── signup-form.tsx      # Signup form component
│   │   ├── edit-profile-form.tsx
│   │   ├── change-password-form.tsx
│   │   ├── premium-card.tsx     # Premium feature showcase
│   │   ├── premium-feature-card.tsx
│   │   ├── premium-status-card.tsx
│   │   ├── stat-card.tsx        # Stats display card
│   │   ├── welcome-banner.tsx   # Home page welcome
│   │   ├── pending-popup.tsx    # "Account pending" modal
│   │   ├── profile-referral-link.tsx
│   │   ├── copyable-id.tsx      # Click-to-copy public ID
│   │   ├── faq-accordion.tsx
│   │   ├── how-it-works-stepper.tsx
│   │   ├── glass-card.tsx       # Glassmorphism card
│   │   ├── page-header.tsx
│   │   ├── form-field.tsx
│   │   ├── auth-field.tsx
│   │   ├── auth-hero.tsx
│   │   ├── i18n-provider.tsx    # I18n React context
│   │   ├── language-toggle.tsx  # Language switcher
│   │   ├── theme-provider.tsx   # next-themes wrapper
│   │   ├── theme-toggle.tsx     # Dark/light mode toggle
│   │   └── delete-confirm-modal.tsx
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts         # Unified DB connection (SQLite / D1)
│   │   │   └── schema.ts        # Drizzle schema definitions
│   │   ├── i18n/
│   │   │   ├── index.ts         # I18n loader + cookie management
│   │   │   ├── types.ts         # Locale type definitions
│   │   │   ├── en.json          # English translations
│   │   │   └── bn.json          # Bengali translations
│   │   ├── auth.ts              # Session helpers (getCurrentUser, requireUser, etc.)
│   │   ├── session.ts           # JWT session read/write
│   │   ├── routes.ts            # Centralised route definitions & RBAC maps
│   │   ├── feed.ts              # Feed algorithm (fairness, sorting, interleaving)
│   │   ├── autolike.ts          # Auto-like status computation
│   │   ├── use-autolike.ts      # Auto-like React hook (Zustand)
│   │   ├── ad-store.ts          # Ad container state management (Zustand)
│   │   ├── admin.ts             # Admin data-access layer
│   │   ├── super-admin.ts       # Super admin data-access layer
│   │   ├── blog.ts              # Blog data-access layer
│   │   ├── settings.ts          # Site settings singleton
│   │   ├── stats.ts             # User stats computation
│   │   ├── level.ts             # User level/rank system
│   │   ├── rate-limit.ts        # In-memory rate limiter
│   │   ├── types.ts             # Shared TypeScript types
│   │   └── utils.ts             # General utility functions (cn, etc.)
│   └── middleware.ts            # Edge middleware (JWT, RBAC, session refresh)
├── data/                        # Local SQLite database (gitignored)
├── drizzle/
│   └── migrations/              # SQL migration files
├── drizzle.config.ts            # Drizzle Kit configuration
├── wrangler.toml                # Cloudflare Workers/Pages config
├── next.config.ts               # Next.js configuration
├── package.json
├── tsconfig.json
└── .env.example                 # Environment variables template
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** (comes with Node.js)

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd "Smart Dream"

# 2. Install dependencies
npm install

# 3. Start MySQL 8 + Redis 7 (Docker)
npm run db:up

# 4. Set up environment variables
cp .env.example .env.local
# Edit .env.local and set your JWT_SECRET (and MySQL/Redis credentials if you
# changed them from the docker-compose defaults)

# 5. Apply database migrations (schema + stored procedures + events)
npm run db:migrate

# 6. Start the development server
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Available Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start development server (hot reload)    |
| `npm run build`   | Create production build                  |
| `npm run start`   | Start production server                  |
| `npm run lint`    | Run ESLint                               |
| `npm run db:up`   | Start MySQL + Redis containers           |
| `npm run db:migrate` | Apply pending migrations (`db/migrations/*.sql`) |
| `npm run db:status`  | List applied/pending migrations      |
| `npm run db:test`    | Run the like-concurrency/quota test |
| `npm run db:seed`    | One-time data migration from the old Supabase |

---

## Environment Variables

Create a `.env.local` file in the project root. See `.env.example` for the template:

| Variable                | Required | Description                                                 |
| ----------------------- | -------- | ----------------------------------------------------------- |
| `JWT_SECRET`            | **Yes** (prod) | Secret key for signing JWT session cookies. In dev, defaults to `dev-secret-change-me`. |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | Yes | MySQL connection (docker-compose defaults in `.env.example`). |
| `REDIS_URL`             | Yes      | Redis connection string (e.g. `redis://127.0.0.1:6379`).     |
| `SESSION_COOKIE_NAME`   | No       | Session cookie name (default `sd_session`).                 |

> **Production (VPS):** Set `JWT_SECRET` and the MySQL/Redis credentials as environment variables on the Node process. `npm run build && npm run start` (or a process manager like PM2/systemd).

---

## Database

### MySQL 8 (docker-compose)

The data layer lives in `src/lib/db.ts` (connection pool) and `src/lib/repos/*` (thin repositories mapping rows 1:1 onto the old Supabase row shapes). The schema + stored procedures + scheduled events are plain numbered `.sql` files in `db/migrations/`, applied by `scripts/migrate.mjs` (tracked in `schema_migrations`).

- **Stored procedures** (`db/migrations/0002_rpcs.sql`) port the old Postgres RPCs: `process_like_commit` (named locks + atomic quota ceilings), `get_eligible_feed_links` (joins the `feed_eligibility_cache` table), `get_my_stats`, `add_links_atomic`, `next_boost_order`, `get_top_likers`, `refresh_feed_eligibility_cache` (EVENT every 120s).
- **Realtime** is Redis pub/sub → SSE (`/api/realtime`, Node runtime).
- **Backups:** `mysqldump` on a cron (e.g. `mysqldump smartdream | gzip > /backups/sd-$(date +%F).sql.gz`). Redis is optional to back up (cache only).

### Schema

#### `profiles`
The core user table. Stores credentials, role, approval status, premium feature state, and referral tracking.

| Column                    | Type     | Description                                              |
| ------------------------- | -------- | -------------------------------------------------------- |
| `id`                      | TEXT PK  | Internal UUID                                            |
| `public_id`               | TEXT UQ  | Human-facing unique ID (used for feature activation)     |
| `first_name`              | TEXT     | User's first name                                        |
| `last_name`               | TEXT     | User's last name                                         |
| `phone`                   | TEXT     | Phone number                                             |
| `email`                   | TEXT UQ  | Login email (unique)                                     |
| `password_hash`           | TEXT     | bcrypt hash                                              |
| `role`                    | ENUM     | `user` \| `admin` \| `super_admin`                       |
| `status`                  | ENUM     | `pending` \| `approved` \| `rejected`                    |
| `is_elite`                | BOOLEAN  | Elite flag (Super Admin only)                            |
| `is_boosted`              | BOOLEAN  | Boosted feature active                                   |
| `boost_order`             | INTEGER  | Boost priority in feed                                   |
| `boost_model`             | ENUM     | `none` \| `no_expiry` \| `time` \| `usage`               |
| `boost_expiry`            | TEXT     | ISO timestamp for time-based boost expiry                |
| `boost_quota` / `boost_used` | INT  | Usage-based boost counters                               |
| `auto_like_enabled`       | BOOLEAN  | Paid auto-like active                                    |
| `auto_like_model`         | ENUM     | Same model variants as boost                             |
| `auto_like_expiry`        | TEXT     | ISO timestamp for time-based auto-like expiry            |
| `auto_like_quota` / `auto_like_used` | INT | Usage-based auto-like counters              |
| `auto_like_paused`        | BOOLEAN  | Whether auto-like is currently paused                    |
| `auto_like_paused_remaining_minutes` | INT | Remaining minutes when paused               |
| `free_autolike_until`     | TEXT     | ISO timestamp for free auto-like from boosted offer      |
| `free_autolike_paused_remaining_minutes` | INT | Free auto-like remaining when paused     |
| `boosted_offer_count`     | INTEGER  | Counter for boosted offer progress                       |
| `referred_by`             | TEXT     | Public ID of the referrer                                |
| `approved_by`             | TEXT     | ID of admin who approved the user                        |
| `created_at`              | TEXT     | ISO timestamp                                            |

**Indexes:** `(role, status)`, `(is_elite)`, `(boost_order)`

#### `links`
Each user can add up to 20 Adsterra ad-viewer links.

| Column       | Type     | Description                        |
| ------------ | -------- | ---------------------------------- |
| `id`         | TEXT PK  | UUID                               |
| `user_id`    | TEXT FK  | References `profiles.id` (CASCADE) |
| `url`        | TEXT     | The ad-viewer URL                  |
| `likes_count`| INTEGER  | Total likes received               |
| `sort_order` | INTEGER  | User-defined display order         |
| `created_at` | TEXT     | ISO timestamp                      |

**Indexes:** `(user_id)`, unique `(user_id, sort_order)`

#### `likes`
Records every like (ad view) event with full attribution.

| Column          | Type     | Description                             |
| --------------- | -------- | --------------------------------------- |
| `id`            | TEXT PK  | UUID                                    |
| `liker_id`      | TEXT FK  | Who gave the like (SET NULL on delete)  |
| `link_id`       | TEXT FK  | Which link was liked (CASCADE)          |
| `receiver_id`   | TEXT FK  | Who owns the link (CASCADE)            |
| `is_anonymous`  | BOOLEAN  | True for elite user likes               |
| `is_boosted_like`| BOOLEAN | True for boosted-page likes             |
| `created_at`    | TEXT     | ISO timestamp                           |

**Indexes:** `(liker_id, created_at)`, `(receiver_id, created_at)`, `(link_id)`

#### `blogs`
Admin-managed blog posts displayed in the hero carousel and blog pages.

| Column        | Type     | Description                        |
| ------------- | -------- | ---------------------------------- |
| `id`          | TEXT PK  | UUID                               |
| `title`       | TEXT     | Post title                         |
| `slug`        | TEXT UQ  | URL slug                           |
| `excerpt`     | TEXT     | Short summary                      |
| `content`     | TEXT     | Full content (markdown/HTML)       |
| `hero_image`  | TEXT     | Base64 or URL for hero image       |
| `published_at`| TEXT     | Publish timestamp                  |
| `created_by`  | TEXT FK  | Admin who created it               |
| `created_at`  | TEXT     | ISO timestamp                      |

#### `settings` (Singleton, `id = "1"`)
Global platform configuration, managed by admins.

| Column                          | Type    | Default | Description                              |
| ------------------------------- | ------- | ------- | ---------------------------------------- |
| `whatsapp_number`               | TEXT    | `""`    | WhatsApp contact shown across the site   |
| `active_like_count`             | INT     | `20`    | Likes needed in rolling window to be "active" |
| `active_window_hours`           | INT     | `24`    | Rolling window size in hours             |
| `elite_weight`                  | INT     | `10`    | Elite user priority boost (in hours)     |
| `offer_likes_required`          | INT     | `10`    | Boosted likes needed for free auto-like  |
| `offer_autolike_minutes`        | INT     | `30`    | Free auto-like duration from offer       |
| `offer_active`                  | BOOL    | `true`  | Whether the boosted offer is enabled     |
| `boost_price_*`                 | REAL    | `null`  | Pricing for each boost variation         |
| `autolike_price_*`              | REAL    | `null`  | Pricing for each auto-like variation     |
| `referral_reward_referrer_minutes` | INT  | `60`    | Free auto-like minutes for referrer      |
| `referral_reward_referee_minutes`  | INT  | `30`    | Free auto-like minutes for referee       |
| `level[1-4]_name`              | TEXT    | Bronze/Silver/Gold/Platinum | Level tier names    |
| `level[1-4]_threshold`         | INT     | 0/100/500/2000 | Like thresholds for each level |

---

## Authentication & Authorization

### Session Management
- **JWT-based sessions** stored in `httpOnly`, `secure`, `SameSite=lax` cookies.
- Tokens are signed with **HS256** using the `JWT_SECRET`.
- Sessions automatically **refresh on every request** (sliding window, 7-day max age).
- Verification happens in Edge Middleware for zero-latency route protection.

### Password Security
- Passwords are hashed with **bcryptjs** before storage.
- Password strength is enforced at signup (double confirmation required).

### Rate Limiting
- In-memory IP-based rate limiter: **5 attempts per 5-minute window** per action.
- Applied to login and signup to prevent brute-force attacks.

---

## Role System

The platform has a **4-tier role hierarchy**, with strict access separation:

```
Super Admin (hidden)
    ├── Can do everything Admin can
    ├── Create/manage Elite users (hidden accounts)
    ├── Promote/demote Admins
    ├── Configure elite weight, levels, referral rewards
    └── Completely invisible to Admins
        │
        ▼
    Admin
    ├── Approve/reject pending users
    ├── Manage users (view, remove, password reset)
    ├── Activate/deactivate premium features
    ├── Manage blog posts
    ├── Configure platform settings
    ├── CANNOT see Elite users or Super Admin
    └── CANNOT own links
        │
        ▼
    User (standard)
    ├── Add up to 20 links
    ├── Like others' links (triggers ad views)
    ├── View feed, stats, blog, premium page
    ├── Use auto-like (if activated)
    └── Participate in boosted offer
        │
        ▼
    Elite User (hidden, Super Admin exclusive)
    ├── Bypasses active/deficit checks
    ├── Links appear at top of normal feed
    ├── Likes are anonymous (counted for receiver)
    ├── Never shows "boosted" label
    ├── Hidden from all user counts
    └── Never appears in Admin's view
```

### Separate Login Routes

| Role         | Login Route            |
| ------------ | ---------------------- |
| User         | `/login`               |
| Admin        | `/admin/login`         |
| Super Admin  | `/super-admin/login`   |

> A user **cannot** log in through another role's login route, even with correct credentials.

### Account Approval Flow
1. User signs up → account goes to `pending` status.
2. User sees a popup: *"Contact admin to approve your account"* with a WhatsApp button.
3. Admin manually reviews and approves/rejects from the dashboard.
4. Only `approved` users can access the platform.

---

## Feed Algorithm

The feed algorithm (`src/lib/feed.ts`) is the core business logic. It determines which links appear in a user's feed and in what order.

### Step-by-step Process

1. **Cooldown Filter:** Links the viewer liked within the last **8 hours** are excluded.

2. **Eligible User Selection:** For each non-viewer, approved user:
   - **Elite users** → Always eligible (bypass all checks).
   - **Boosted users** → Always eligible.
   - **New users** (account < 24h old AND < `activeLikeCount` total received likes) → Eligible (grace period).
   - **Regular users** → Must have given ≥ `activeLikeCount` likes in the rolling `activeWindowHours` window.

3. **Fairness Engine (Deficit Tracking):**
   - If a user has given `N` likes in the last 24h:
     - **Given 0 likes** → No exposure at all.
     - **Received < 90% of given** → Full exposure (high priority).
     - **Received 90%–100% of given** → Probability-based slowdown (linear interpolation from 100% to 0%).
     - **Received ≥ 100% of given** → Complete shutoff (no feed exposure).

4. **Link Fetching:** All links from eligible users are fetched, then cooldown-filtered.

5. **Sorting & Interleaving:**
   - **Boosted links** → Sorted by `boost_order` ASC, then `created_at` DESC. Placed first.
   - **Elite links** → Sorted by `created_at` DESC. Placed after boosted, before regular.
   - **Regular links** → Round-robin interleaved by user to ensure fair distribution. No single user's 20 links appear consecutively.
   - Slowdown users are de-prioritized within the regular pool.

6. **Pagination:** Results are paginated with `offset` and `limit` (default 50).

### Boosted Feed (`/boosted`)
A separate feed showing only boosted users' links (excluding Elite). Features an **offer system**: like `X` boosted links → earn `Y` minutes of free auto-like.

---

## Like System & Ad Views

### How Liking Works
1. User clicks "Like" on a feed link.
2. An **ad container** opens at the bottom of the screen with a **4-second countdown**.
3. After 4 seconds, the ad view is registered and the like is recorded.
4. Free users: 1 concurrent ad container. Rapid clicks: up to **4 concurrent** ad containers.
5. While 4 containers are active, no new likes can be given.

### Cooldown
After liking a link, that specific link **disappears from the viewer's feed for 8 hours**.

### Like Attribution
Each like records:
- Who liked (`liker_id`)
- Which link (`link_id`)
- Who owns the link (`receiver_id`)
- Whether it was anonymous (Elite) or boosted-page

---

## Premium Features

### Boost
- Boosted user's links appear **at the top** of everyone's feed with a "Boosted" label.
- Admin sets the `boost_order` for priority among multiple boosted users.
- **Pricing models:** No expiry, 1 week, 1 month, 3 months, 6 months, 1 year, usage-based.
- Payment is **offline** (WhatsApp → Admin manually activates).

### Auto-Like
- Automated liking: the system scrolls through the feed and auto-likes links.
- Respects the **4-second ad view** requirement per like.
- Uses **4 concurrent** ad containers for parallel processing (4 ads in 4 seconds).
- Can be **paused/resumed** with remaining time preserved.
- Same pricing models as Boost.

### Boosted Offer (Free Auto-Like Promotion)
- Available on the `/boosted` page.
- Like **X** boosted users' links → Earn **Y** minutes of free auto-like.
- X and Y are admin-configurable.
- Progress is tracked per user.
- Boosted likes are tracked **separately** (don't count toward regular stats).

---

## Referral System

- Each user has a unique referral link (based on their `public_id`).
- When a new user signs up with a referral code:
  - **Referrer** receives `referral_reward_referrer_minutes` (default: 60) of free auto-like.
  - **Referee** receives `referral_reward_referee_minutes` (default: 30) of free auto-like.
- Rewards are granted automatically upon the referee's account approval.
- Reward durations are admin-configurable from settings.

---

## Level / Rank System

Users earn levels based on their **total given likes** (lifetime). The level system is purely cosmetic and provides visual flair on the profile.

| Default Level | Default Threshold | Icon    | Color Theme |
| ------------- | ----------------- | ------- | ----------- |
| Bronze        | 0                 | Star    | Amber       |
| Silver        | 100               | Medal   | Zinc        |
| Gold          | 500               | Trophy  | Yellow      |
| Platinum      | 2,000             | Diamond | Cyan        |

- Level names and thresholds are **fully customizable** from the Super Admin settings panel.
- Each level has a themed progress bar showing advancement toward the next tier.

---

## Blog System

- Admins can create, edit, and delete blog posts from `/admin/blog`.
- Posts have a **title**, **slug** (auto-generated, URL-friendly), **excerpt**, **content**, and optional **hero image** (uploaded as base64).
- Published posts appear in the **hero carousel** on the home page and are browsable at `/blog` and `/blog/[slug]`.
- Blog content is **not translated** (i18n applies only to UI chrome).

---

## Internationalization (i18n)

### Supported Languages

| Code | Language |
| ---- | -------- |
| `en` | English (default) |
| `bn` | Bengali  |

### Implementation
- Translation files: `src/lib/i18n/en.json` (~21KB) and `src/lib/i18n/bn.json` (~45KB).
- Language preference stored in a cookie (`locale`).
- `I18nProvider` (React Context) makes translations available to all components.
- The root layout reads the locale server-side and sets `<html lang="...">`.
- Users can switch language from the sidebar via the `LanguageToggle` component.
- All UI text (navigation, buttons, labels, messages, form placeholders, error messages) is fully translated.

---

## Admin Dashboard

**Route:** `/admin` (requires `role = admin` or `super_admin`)

### Features
| Page                | Path                  | Description                                       |
| ------------------- | --------------------- | ------------------------------------------------- |
| Dashboard           | `/admin`              | User stats overview + pending user list            |
| Users               | `/admin/users`        | Full user list with search, filter, sort           |
| User Detail         | `/admin/users/[id]`   | Read-only user profile, stats, links + controls   |
| Blog                | `/admin/blog`         | Blog post CRUD editor                             |
| Settings            | `/admin/settings`     | WhatsApp number, active threshold, pricing, offers |

### Admin Capabilities
- ✅ Approve / reject pending users
- ✅ View any user's details, stats, and links (read-only)
- ✅ Remove users
- ✅ Reset user passwords
- ✅ Activate/deactivate Boost and Auto-Like (with model selection)
- ✅ Manage blog posts
- ✅ Configure platform settings and pricing

### Admin Restrictions
- ❌ Cannot see Elite users
- ❌ Cannot see Super Admin accounts
- ❌ Cannot own links or participate in the feed
- ❌ Cannot edit/delete user links

---

## Super Admin Dashboard

**Route:** `/super-admin` (requires `role = super_admin`)

### Additional Features (beyond Admin)
| Page              | Path                        | Description                              |
| ----------------- | --------------------------- | ---------------------------------------- |
| Dashboard         | `/super-admin`              | Enhanced overview with all metrics       |
| Users             | `/super-admin/users`        | Full user management with promotion      |
| Admins            | `/super-admin/admins`       | Create, promote, demote admin accounts   |
| Elite             | `/super-admin/elite`        | Create and manage hidden Elite accounts  |
| Settings          | `/super-admin/settings`     | Level config, referral rewards, elite weight |
| Audit             | `/super-admin/audit`        | System audit logs                        |

### Super Admin Exclusive Capabilities
- ✅ Create Elite user accounts (no signup — login only)
- ✅ View all Elite user data
- ✅ Create new Admin accounts
- ✅ Promote regular users to Admin
- ✅ Demote Admins back to users
- ✅ Configure elite weight (feed priority multiplier)
- ✅ Configure level names and thresholds
- ✅ Configure referral reward amounts

### Invisibility
- Super Admin and Elite user existence is **completely hidden** from Admins and regular users.
- No mention in FAQ, How It Works, or any public-facing page.
- Elite users are excluded from all user counts displayed to Admins.

---

## Public Pages

These pages are accessible **without authentication** and are linked from the signup page:

| Page         | Route           | Description                                            |
| ------------ | --------------- | ------------------------------------------------------ |
| How It Works | `/how-it-works` | Step-by-step platform guide (no mention of Elite/Super Admin) |
| Terms        | `/terms`        | Terms and conditions                                   |
| FAQ          | `/faq`          | Frequently asked questions (no mention of Elite/Super Admin) |

---

## API Routes

| Endpoint            | Method | Auth     | Description                               |
| ------------------- | ------ | -------- | ----------------------------------------- |
| `/api/feed`         | GET    | Required | Paginated feed with fairness algorithm    |
| `/api/boosted-feed` | GET    | Required | Boosted-only feed with offer progress     |
| `/api/auto-like`    | POST   | Required | Trigger auto-like background process      |
| `/api/embed-frame`  | GET    | Required | Proxy for verification iframe content    |
| `/api/logout`       | GET    | Any      | Clear session cookie and redirect         |
| `/api/test`         | GET    | Dev only | Development testing endpoint              |

---

## Middleware

The Edge middleware (`src/middleware.ts`) runs on **every request** (except static assets) and handles:

1. **Session Verification:** Validates the JWT from the `session` cookie.
2. **Auth Page Redirect:** Logged-in, approved users accessing login/signup are redirected to their role's home page.
3. **Protected Route Guard:** Unauthenticated users accessing protected routes are redirected to `/login` with a `redirect` query parameter.
4. **Role-Based Access Control (RBAC):**
   - Users cannot access `/admin/*` or `/super-admin/*`.
   - Admins cannot access `/super-admin/*` or user-only pages (`/`, `/links`, etc.).
   - Super Admins cannot access user-only pages (redirected to `/super-admin`).
5. **Session Refresh:** On every request, the session cookie is re-signed with a fresh expiration (sliding window).

### Matcher
```
/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)
```
Excludes static files, images, and Next.js internal routes.

---

## Deployment

### Local Development
```bash
npm run db:up        # MySQL 8 + Redis 7 containers
npm run db:migrate   # schema + stored procedures + events
npm run dev
```

### VPS (Production, Docker)
```bash
# 1. Ship the code and install deps
npm install
npm run build

# 2. Start MySQL + Redis (docker-compose.yml) and set env vars
#    (JWT_SECRET, MYSQL_*, REDIS_URL — see .env.example)
npm run db:up
npm run db:migrate

# 3. Run the Node server behind nginx/pm2/systemd
npm run start
```

**nginx notes:**
- The SSE endpoint (`/api/realtime`) must not be buffered:
  `location /api/realtime { proxy_buffering off; proxy_read_timeout 3600s; proxy_http_version 1.1; proxy_set_header Connection ""; }`
- Set `client_max_body_size` to match `next.config.ts`'s 10 MB server-actions limit.

**Backups:** daily `mysqldump smartdream | gzip` (schema + data). Redis is a cache — no backup needed.

---

## Important Constants

These are defined in `src/lib/types.ts` and used throughout the application:

| Constant              | Value | Description                                    |
| --------------------- | ----- | ---------------------------------------------- |
| `MAX_LINKS_PER_USER`  | 20    | Maximum ad-viewer links per user               |
| `AD_VIEW_SECONDS`     | 4     | Minimum seconds an ad must be viewed           |
| `MAX_CONCURRENT_ADS`  | 4     | Maximum simultaneous ad containers             |
| `LINK_COOLDOWN_HOURS` | 8     | Hours before a liked link reappears in feed    |

### Session Constants (Middleware)
| Constant   | Value     | Description                |
| ---------- | --------- | -------------------------- |
| `MAX_AGE`  | 7 days    | Session cookie max age     |
| `COOKIE`   | `session` | Cookie name for JWT        |

### Rate Limit Constants
| Constant       | Value       | Description                  |
| -------------- | ----------- | ---------------------------- |
| `MAX_ATTEMPTS` | 5           | Max attempts per window      |
| `WINDOW_MS`    | 5 minutes   | Rate limit window duration   |

---

## License

This is a private project. All rights reserved.
