# About page credits Rare UI

- The About page has a Credits section, in English and in Hebrew, with a link to Rare UI (rareui.com).

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/TBD

## Technical details

`src/pages/AboutPage.jsx` adds a Credits section with the attribution the Rare UI licence asks for (`THIRD_PARTY_LICENSES/rare-ui.md`): an English line and a Hebrew line (`lang="he" dir="rtl"`), each with a link to https://rareui.com (`rel="noreferrer"`, `target="_blank"`). The unit test `tests/unit/AboutPage.test.jsx` checks both links. `/admin/flags` keeps its credit. The About page already has a ui-audit case (axe, 44 px, RTL pass).
