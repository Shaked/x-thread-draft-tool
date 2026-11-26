# Rare UI (third-party components)

Components in `src/ui/rare/` come from Rare UI by Swami Malode, https://rareui.com.
Source: https://github.com/swamimalode07/rare-ui/tree/0e9f0ef86bd690b16175fb81950ce38a5e689cd4

| Copied here | Source file | Added in |
|---|---|---|
| `src/ui/rare/ThemeSelector.jsx` | `components/ui/theme-selector.tsx` | #406 Task K1 |
| `src/ui/rare/cn.js` | `lib/utils.ts` (`cn`, rewritten without clsx and tailwind-merge) | #406 Task K1 |
| `src/ui/rare/DeleteButton.jsx` | `components/ui/delete-button.tsx` | #406 Task K2 |
| `src/ui/rare/AnimatedCounter.jsx` | `components/ui/animated-counter.tsx` (integer path only) | #406 Task K3 |
| `src/ui/rare/Toast.jsx` | `components/ui/toast.tsx` (sonner stack, our card; the upstream squircle, colours and Undo removed) | #406 Task K4 |

Changes: listed in the header comment of each file (TypeScript removed, values from `src/styles/tokens.css`,
logical properties, full-width cards, accessible names). Each header keeps the copyright notice.

Credit: the About page (`/about`, English and Hebrew) and the admin Feature flags page (`/admin/flags`) link to https://rareui.com, as the licence asks, and
README.md names Rare UI under Credits.

The Rare toast uses the npm package `sonner` 2.0.8 (MIT licence, a normal dependency, not copied here).

Not copied: the other components, and nothing from the Rare UI site (its fonts, analytics and images).

## Licence (copied from `LICENSE` at that commit)

```
MIT + Commons Clause License Condition v1.0 + Attribution

Copyright (c) 2026 Swami Malode

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, and distribute the Software as part of an
application, website, or product, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

Attribution Requirement

Any project that ships any part of the Software must credit Rare UI with a
visible link to https://rareui.com, placed where a visitor or user can find it,
such as a site footer, an about page, a credits screen or a README. The credit
and the copyright notice above must not be removed from the source you copied.

Commons Clause Restriction

You may use this Software, including for any commercial purpose, so long as you
do not sell, sublicense, or redistribute the components themselves, whether
alone, in a bundle, or as a ported version.

No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
