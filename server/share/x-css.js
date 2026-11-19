// The X card look shared by the share page and the MCP thread view (plan Task 3). Colors are CSS variables:
// the share page is dark, the thread view is light or dark (plan D9). Nothing here loads a URL: no url(), no @import (rule 10).
export const X_VARS_DARK = '--x-bg:#000;--x-fg:#e7e9ea;--x-muted:#71767b;--x-line:#2f3336;--x-card:#16181c;--x-link:#1d9bf0'
export const X_VARS_LIGHT = '--x-bg:#ffffff;--x-fg:#0f1419;--x-muted:#536471;--x-line:#eff3f4;--x-card:#f7f9f9;--x-link:#1d9bf0'

export const X_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--x-bg); color: var(--x-fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  a { color: var(--x-link); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .x-app { max-width: 600px; margin: 0 auto; border-left: 1px solid var(--x-line); border-right: 1px solid var(--x-line); min-height: 100vh; }
  .x-header { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px); background: rgba(0,0,0,0.65); border-bottom: 1px solid var(--x-line); padding: 14px 16px; display: flex; align-items: center; gap: 28px; }
  .x-back { color: var(--x-fg); font-size: 20px; line-height: 1; padding: 6px 8px; border-radius: 999px; }
  .x-back:hover { background: #181818; text-decoration: none; }
  .x-header-title { font-size: 20px; font-weight: 800; }

  .x-thread { display: flex; flex-direction: column; }

  .x-post { display: grid; grid-template-columns: 56px 1fr; padding: 12px 16px 4px; border-bottom: 1px solid var(--x-line); }
  .x-post-last { border-bottom: 1px solid var(--x-line); padding-bottom: 12px; }

  .x-post-left { display: flex; flex-direction: column; align-items: center; }
  .x-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--x-card); object-fit: cover; }
  .x-avatar-fallback { display: flex; align-items: center; justify-content: center; color: var(--x-muted); font-weight: 700; font-size: 18px; border: 1px solid var(--x-line); }
  .x-thread-line { flex: 1; width: 2px; background: var(--x-line); margin-top: 6px; min-height: 12px; }

  .x-post-body { min-width: 0; padding-bottom: 4px; }
  .x-post-head { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; line-height: 1.2; padding: 2px 0 2px; }
  .x-name { font-weight: 700; color: var(--x-fg); }
  .x-verified { fill: var(--x-link); flex-shrink: 0; }
  .x-meta { color: var(--x-muted); font-size: 15px; }

  .x-text { font-size: 17px; line-height: 1.4; color: var(--x-fg); white-space: pre-wrap; word-wrap: break-word; padding: 4px 0 8px; }
  .x-text[dir="rtl"] { text-align: right; }

  .x-link { color: var(--x-link); }

  .x-media { display: grid; gap: 2px; margin: 4px 0 12px; border-radius: 16px; overflow: hidden; border: 1px solid var(--x-line); }
  .x-media-one { grid-template-columns: 1fr; }
  .x-media-two { grid-template-columns: 1fr 1fr; }
  .x-media-three { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .x-media-three .x-media-item:first-child { grid-row: span 2; }
  .x-media-four { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .x-media-item { display: block; overflow: hidden; background: var(--x-card); aspect-ratio: 16/10; }
  .x-media-one .x-media-item { aspect-ratio: auto; max-height: 510px; }
  .x-media-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .x-media-one .x-media-item img { object-fit: contain; max-height: 510px; }

  .x-embed { margin: 4px 0 12px; }
  .x-embed-fallback { padding: 12px; border: 1px solid var(--x-line); border-radius: 16px; word-break: break-all; }
  .x-embed .twitter-tweet { margin: 0 !important; }

  .x-actions { display: flex; align-items: center; gap: 0; margin-top: 8px; max-width: 425px; color: var(--x-muted); }
  .x-action { display: inline-flex; align-items: center; gap: 6px; flex: 1; font-size: 13px; cursor: default; padding: 4px 0; }
  .x-action-end { flex: 0 0 auto; margin-left: auto; }
  .x-action svg { fill: currentColor; }

  @media (max-width: 640px) {
    .x-app { border-left: none; border-right: none; }
    .x-text { font-size: 16px; }
  }
`
