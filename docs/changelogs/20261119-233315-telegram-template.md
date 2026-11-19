# Telegram notices use one template (#250)

- All four Telegram kinds (production live, production smoke failed, try-preview, owner) share one template: an emoji, bold headline, the commit or PR or issue title, and one main link that gives the link preview.
- Text from commits, PRs and issues is escaped; links must be https; a parse error is retried once as plain text.
