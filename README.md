# Jewelry Billing — Mobile App (Expo)

Expo SDK 57 + expo-router + TypeScript, wired to Supabase Auth. Blue/gold/
white theme throughout — no dark mode. Verified with real Metro bundle
exports (typecheck + full Android bundle: 1,438 modules) before packaging.

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your Supabase project URL + anon key (EXPO_PUBLIC_ prefix!)
npx expo start
```

Scan the QR code with **Expo Go** on your phone. Sign in with your admin
account — you'll land on the Dashboard with a 5-tab bottom nav.

## Why `app/` and `src/` are separate

- **`app/`** — file-based routing. Every file here IS a screen; its path
  in the folder becomes its URL. This is a hard requirement of expo-router,
  not a style choice.
- **`src/`** — everything screens import: the theme, reusable UI components,
  Supabase client, auth logic, context. None of this is routable; it's
  shared code.

## File structure

```
jewelry-billing-mobile/
├── app.json / package.json / tsconfig.json
├── .env.example
│
├── app/                              # ROUTES (expo-router)
│   ├── _layout.tsx                    # root: fonts, AuthProvider, route guard
│   ├── login.tsx
│   ├── forgot-password.tsx
│   ├── reset-password.tsx
│   │
│   └── (tabs)/                       # the 5-tab authenticated app
│       ├── _layout.tsx                # Tabs navigator (Dashboard/Customers/Products/Invoices/Settings)
│       ├── index.tsx                   # Dashboard
│       │
│       ├── customers/
│       │   ├── _layout.tsx             # Stack: list → add → details
│       │   ├── index.tsx                # Customer List
│       │   ├── add.tsx                  # Add Customer
│       │   └── [id].tsx                 # Customer Details
│       │
│       ├── products/
│       │   ├── _layout.tsx
│       │   ├── index.tsx                # Product List
│       │   ├── add.tsx                  # Add Product
│       │   └── [id].tsx                 # Product Details
│       │
│       ├── invoices/
│       │   ├── _layout.tsx
│       │   ├── index.tsx                # Invoice List
│       │   ├── new.tsx                  # New Invoice
│       │   └── [id].tsx                 # Invoice Details
│       │
│       └── settings/
│           ├── _layout.tsx
│           ├── index.tsx                # Settings menu (links to all of below)
│           ├── company.tsx
│           ├── metals.tsx
│           ├── purity.tsx
│           ├── categories.tsx
│           ├── gold-rates.tsx
│           ├── making-charges.tsx
│           ├── value-added-charges.tsx
│           ├── tax.tsx
│           └── invoice-settings.tsx
│
└── src/                              # SHARED CODE (not routes)
    ├── theme/
    │   ├── theme.ts                    # colors, spacing, radius, typography — single source of truth
    │   └── index.ts
    │
    ├── components/ui/                 # reusable, theme-driven components
    │   ├── Button.tsx                  # primary / gold / outline / ghost variants
    │   ├── Card.tsx
    │   ├── Input.tsx
    │   ├── Badge.tsx                    # status pills (paid/unpaid/etc.)
    │   ├── SummaryCard.tsx              # dashboard stat tiles
    │   ├── ScreenHeader.tsx
    │   ├── ComingSoon.tsx               # placeholder for unbuilt screens
    │   └── index.ts                     # barrel export
    │
    ├── lib/
    │   ├── supabaseClient.ts
    │   └── auth.ts
    │
    └── context/
        └── AuthContext.tsx
```

## Theme

Every color in the app comes from `src/theme/theme.ts` — nothing is
hardcoded in a screen. Palette:

- **Primary (blue)** `#123B7A` — headers, primary buttons, active tab, icons
- **Gold** `#C9A227` — accents, key numbers (gold rates, totals), highlights
- **White/neutrals** — `background` `#F5F7FB`, `surface` (cards) `#FFFFFF`,
  text in navy shades, never pure black

To retheme anything, change `src/theme/theme.ts` — every screen and
component picks it up automatically.

## Current state

- ✅ Auth: login, forgot/reset password, session persistence, role-aware guard
- ✅ Navigation: all 5 tabs + every screen from the spec's nav tree exists
  and routes correctly
- 🚧 Screens beyond Dashboard/Settings-menu are `<ComingSoon>` placeholders —
  structure is in place, ready for real Supabase-backed logic next

## Adding real logic to a screen

Example — Customer List:

```tsx
// app/(tabs)/customers/index.tsx
import { supabase } from '../../../src/lib/supabaseClient';
// fetch: supabase.from('customers').select('*').is('deleted_at', null)
```

RLS policies from the database schema already restrict what each role can
see/do — no extra client-side permission logic needed for basic CRUD.
