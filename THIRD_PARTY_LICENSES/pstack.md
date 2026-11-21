# pstack (third-party skills)

Three writing skills in this repository come from pstack, version 0.15.46, by Lauren Tan
(the pstack README is signed "poteto"). Source: https://github.com/cursor/plugins/tree/792440e8a560a4a3f63748cdee70491ecd412982/pstack

| Vendored here | Source file |
|---|---|
| `.claude/skills/pstack-unslop/SKILL.md` | `pstack/skills/unslop/SKILL.md` |
| `.claude/skills/pstack-technical-writing/SKILL.md` | `pstack/skills/technical-writing/SKILL.md` |
| `.claude/skills/pstack-bro/SKILL.md` | `pstack/skills/bro/SKILL.md` |

Changes: each `name` field has the `pstack-` prefix, `technical-writing` names the vendored path of
`unslop`, and each file has a header comment with its source. The rules themselves are unchanged.

Reviewed on 2026-11-21: the three files hold writing rules only, with no tool calls, network
access or configuration changes. Not copied: `no-comments` (it needs pstack's own subagents) and
every other pstack skill (code workflows outside the reply-style task).

## Licence (copied from `pstack/LICENSE`)

```
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
