# IA-03 slice e · the `role === …` checks to move onto the lens

Generated 7.11 from `origin/main` @ `4c887688` (`grep -rnE "role (===|!==) '<role>'" apps/web/{app,lib}`, tests excluded). Each owning package replaces its lines with a `roleLens` call (`routeAccess`, `canEverOpen`, `ROLE_LENS[role].money`, `linkableFor`) or, server-side, G-07 `can()`. IA-03 edits none of these files.

| File | Line | Check |
|---|---|---|
| `apps/web/app/dashboard/catalog/page.tsx` | 27 | `role === 'manager'` |
| `apps/web/app/dashboard/team/page.tsx` | 14 | `role !== 'manager'` |
| `apps/web/app/dashboard/team/page.tsx` | 23 | `role === 'owner'` |
| `apps/web/app/dashboard/recipes/page.tsx` | 27 | `role === 'manager'` |
| `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx` | 53 | `role === 'manager'` |
| `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx` | 56 | `role !== 'chef'` |
| `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx` | 62 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/orders/[poId]/page.tsx` | 38 | `role === 'manager'` |
| `apps/web/app/dashboard/orders/[poId]/page.tsx` | 39 | `role === 'chef'` |
| `apps/web/app/dashboard/orders/page.tsx` | 45 | `role === 'chef'` |
| `apps/web/app/dashboard/orders/capture/page.tsx` | 25 | `role !== 'chef'` |
| `apps/web/app/dashboard/page.tsx` | 46 | `role === 'receiver'` |
| `apps/web/app/dashboard/page.tsx` | 54 | `role === 'chef'` |
| `apps/web/app/dashboard/receiving/[poId]/page.tsx` | 33 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/receiving/page.tsx` | 52 | `role === 'receiver'` |
| `apps/web/app/dashboard/leaks/report/page.tsx` | 75 | `role !== 'manager'` |
| `apps/web/app/dashboard/leaks/page.tsx` | 42 | `role !== 'owner'` |
| `apps/web/app/dashboard/leaks/page.tsx` | 57 | `role === 'manager'` |
| `apps/web/app/dashboard/settings/page.tsx` | 41 | `role === 'owner'` |
| `apps/web/app/dashboard/settings/page.tsx` | 42 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/settings/page.tsx` | 50 | `role === 'manager'` |
| `apps/web/app/dashboard/integrations/page.tsx` | 26 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/integrations/page.tsx` | 27 | `role === 'manager'` |
| `apps/web/app/dashboard/integrations/page.tsx` | 32 | `role === 'owner'` |
| `apps/web/app/dashboard/inventory/page.tsx` | 21 | `role !== 'chef'` |
| `apps/web/app/dashboard/searchOptions.ts` | 77 | `role === 'chef'` |
| `apps/web/app/dashboard/home/finance.tsx` | 133 | `role === 'owner'` |
| `apps/web/app/dashboard/home/finance.tsx` | 217 | `role === 'manager'` |
| `apps/web/app/dashboard/home/finance.tsx` | 218 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/home/finance.tsx` | 219 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/home/finance.tsx` | 220 | `role === 'manager'` |
| `apps/web/app/dashboard/home/finance.tsx` | 262 | `role === 'manager'` |
| `apps/web/app/dashboard/home/finance.tsx` | 332 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/home/finance.tsx` | 350 | `role === 'owner'` |
| `apps/web/app/dashboard/home/finance.tsx` | 354 | `role === 'bookkeeper'` |
| `apps/web/app/dashboard/home/data.ts` | 23 | `role !== 'bookkeeper'` |
| `apps/web/app/dashboard/products/page.tsx` | 24 | `role === 'manager'` |
| `apps/web/app/dashboard/products/[productId]/page.tsx` | 32 | `role === 'manager'` |
| `apps/web/app/dashboard/suppliers/[id]/tab-catalog.tsx` | 27 | `role === 'manager'` |
| `apps/web/app/dashboard/suppliers/[id]/layout.tsx` | 58 | `role !== 'owner'` |
| `apps/web/app/dashboard/inbox/page.tsx` | 46 | `role === 'manager'` |
| `apps/web/app/dashboard/layout.tsx` | 117 | `role === 'manager'` |
| `apps/web/app/dashboard/layout.tsx` | 141 | `role === 'owner'` |
| `apps/web/app/dashboard/layout.tsx` | 143 | `role === 'owner'` |
| `apps/web/app/dashboard/layout.tsx` | 211 | `role === 'receiver'` |
| `apps/web/app/dashboard/branch-switcher.tsx` | 66 | `role === 'owner'` |
| `apps/web/app/dashboard/branch-switcher.tsx` | 67 | `role === 'owner'` |
