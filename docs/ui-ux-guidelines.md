# UI/UX guidelines (read before changing any screen)

Every change that touches a page, form, dialog, email or the designer must follow this. The goal is that a first-time organiser in a village NGO, on a phone, can finish the task without help.

## 1. Use the shared building blocks, do not hand-roll
| Need | Use | Where |
|---|---|---|
| Page title, description, primary action | `PageHeader` | `src/components/ui.tsx` |
| Nothing to show yet | `EmptyState` (what is empty, why, one action) | `ui.tsx` |
| Status label | `Badge` (text always says the state; never colour alone) | `ui.tsx` |
| Form with server action | `ActionForm` + `Field` (`hint`, `required`) | `src/components/ActionForm.tsx` |
| Submit inside a plain `<form action>` | `SubmitButton` (spinner + verb, blocks double submit) | `ActionForm.tsx` |
| Any destructive or irreversible action | `ConfirmButton` (native `<dialog>`), or `ActionButton` with `confirm` | `ConfirmButton.tsx`, `ActionButton.tsx` |
| Colour input | `ColorField` (picker + hex) | `ColorField.tsx` |
| Copy a link or secret | `CopyButton` | `CopyButton.tsx` |
| Campaign sub-navigation | `CampaignTabs` | `Tabs.tsx` |
| Logo | `Logo` (bird mark, assets in `public/brand/`) | `Logo.tsx` |

Styling comes from `tailwind.config.ts` and `src/app/globals.css` (`btn`, `btn-ghost`, `btn-danger`, `btn-link-danger`, `input`, `card`, `label`, `pill`). Brand blue is `brand-*`; text is `neutral-*` (not `gray-*`); borders are `border-black/10`. Do not introduce new colours, fonts or one-off button styles. Never use `window.confirm()` (a test fails if you do).

## 2. Rules (with the reason)
1. **Say what will happen.** Button labels are verbs for the outcome ("Send invitation", "Erase data"), not "Submit"/"OK". Dialog text states the consequence and whether it can be undone.
2. **Confirm in proportion to the damage.** Reversible: no dialog (offer undo or a clear way back). Hard to reverse (remove member, revoke, reject, erase data, replace design): `ConfirmButton`. Never put two dangerous actions side by side without spacing.
3. **Show progress and result.** Every submit shows a pending state; every outcome is announced (`Notice` already sets `role="alert"` / `role="status"`). Errors say what is wrong and how to fix it, in plain language, and never wipe what the user typed.
4. **Label everything.** Every input and select has a visible `<label htmlFor>` (or an `aria-label` where a visible label would be redundant, e.g. a filter in a toolbar). Required fields are marked. Put help in `hint`, not in placeholders.
5. **No dead ends.** Every list has an empty state with the next action. Every filtered list has a "no matches" state. Lists that can exceed one page need pagination (a 25-row page without paging once hid every later entry).
6. **Mobile first.** Check 390px wide: no horizontal page scroll (grid items need `min-w-0`), tap targets at least 36px, primary action reachable without hunting. Navigation scrolls horizontally inside its own container only.
7. **Keyboard and screen readers.** Visible focus (global `:focus-visible` ring), logical tab order, dialogs close with Esc, links that open a new tab say so (`sr-only` text), colour contrast at least 4.5:1 (use `neutral-600` or darker for body text, never `neutral-400/500` for essential text on white or tinted backgrounds).
8. **Language.** The public form is Marathi/Hindi/English; any new public string needs all three. Devanagari needs generous line-height (already set in certificate rendering). The admin app is English.
9. **Data safety is a UX feature.** Do not show full phone numbers or emails by default (masked), explain why before asking for personal data, keep consent wording visible.
10. **Designer preview must be truthful.** It uses the same `renderCertificateHtml` as the worker. Any new design field needs: schema default (old designs must still parse and render identically), a control, a line in `tests/design-fields.test.ts`.

## 3. Verify every UI change (required before saying "done")
1. `pnpm typecheck && pnpm test`
2. Start the app (`pnpm build && pnpm start`, seeded DB: `pnpm db:seed`), then `pnpm ux:audit`. It crawls all signed-in and public pages at desktop and 390px width with axe-core and screenshots them to `storage/ux-audit/`. **It must report zero violations and no overflow.**
3. Open the screenshots of the screens you changed (and mobile) and look at them. Check empty, error and long-text states too (long Marathi names, 60-character campaign titles).
4. Exercise the interaction you changed in a real browser (Playwright): open the dialog, press Esc, submit with invalid input, submit twice quickly.
5. If you add a page, add it to the `pages` list in `scripts/ux-audit.mjs`.

## 4. Review checklist (use when auditing or reviewing a PR)
Heuristics to walk through for each screen: visibility of system status, match with the user's language, user control and undo, consistency (same component for the same job), error prevention, recognition over recall, flexibility for repeat users, minimal design, helpful error recovery, help where needed.
- Is the primary action obvious and singular? Is anything destructive too close to it?
- What does the screen look like with zero data, one item, and 500 items?
- What happens on a slow network or when the server action fails?
- Can it be completed one-handed on a phone and with the keyboard only?
- Would a first-time user know what to do without reading documentation?

Background reading: Nielsen Norman Group's 10 usability heuristics and form-error guidance (nngroup.com), WCAG 2.2 AA (w3.org/TR/WCAG22), Material/Apple guidance on confirmation versus undo. The change history and reasoning for the current patterns is in `docs/ux-audit.md`.
