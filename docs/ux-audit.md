# UI/UX audit and changes

Method: crawled every signed-in and public page at 1360px and 390px with Playwright, ran axe-core (WCAG 2.0/2.1/2.2 A and AA plus best practices), reviewed each form and each modal in code, and compared against Nielsen's usability heuristics and common SaaS patterns (error prevention and recovery, undo/confirmation proportional to consequence, useful empty states, inline hints, visible status).

## Findings and what changed

| Area | Finding | Change |
|---|---|---|
| App header | Three rows on desktop, four on mobile; no current-page indicator; org switch needed a second click | One compact row; active section highlighted with `aria-current`; org switcher submits on change and disappears with a single org; account menu; skip link |
| Destructive actions | `window.confirm()` (inconsistent, not styled) and some with no confirmation at all: Leave workspace, Remove member, Revoke invite, Erase personal data, Reject entry, Remove field | One accessible `ConfirmButton` modal (native `<dialog>`, Esc, focus trap) that states the consequence; guarded by a test |
| Submit feedback | Buttons showed "…" with no explanation, full-width everywhere | Spinner plus a verb ("Saving…"), `aria-busy`; full width only in narrow auth cards |
| Forms | Required fields unmarked, no hints, several unlabeled controls, errors not announced | Required marker, `hint` text tied with `aria-describedby`, labels on every control, `role="alert"/"status"` on notices |
| Entries | Page 2+ was unreachable (25-row page, no pagination); up to nine inline links per row | Pagination; one status badge row and an Actions menu; empty and filtered-empty states; export menu |
| Campaigns | List rows did not look clickable; create form always open | Rows with status badge and chevron; create form collapsible (open when empty); empty state |
| Dashboard | Empty chart axes, zero tiles with no guidance | Getting-started checklist and empty state |
| Campaign overview | 25+ fields in one long form | Grouped into collapsible sections; copy-link and open-form buttons |
| Settings | Brand colour as raw hex text | Picker plus hex, preview swatch |
| Form builder | Unlabeled inputs; raw type names; key typed by hand | Labels, friendly type names, key derived from label, unsaved-changes indicator |
| Designer | Horizontal scroll on phones; preset replace used `confirm()` | Fixed column sizing; dialog |
| Accessibility | axe: 30+ violations | 0 violations on all crawled pages, both viewports |

## Not done / next
- Admin screens were reviewed in code only (they need a super admin with 2FA); they inherit the shared components.
- Public form: could add inline field-level validation messages after blur.
- Dialogs for revoke reason could replace the inline field.
