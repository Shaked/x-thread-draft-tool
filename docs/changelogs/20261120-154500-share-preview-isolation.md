# Share preview isolation

- Preview shows share HTML in a sandboxed iframe; renderer keeps only https image, embed and avatar URLs.
- Share HTML responses send a sandbox CSP; the javascript: back link is gone (Implements #273 Task R2).
