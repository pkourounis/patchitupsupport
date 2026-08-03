# Dashboard logo assets

Drop the PatchitUP logo files here and the dashboard picks them up automatically
(the file names are referenced by `BRAND` in `../index.html`):

| File | Where it shows | Best source art |
|---|---|---|
| `patchitup-logo.png` | **Top-left of the dashboard** (horizontal wordmark) | The "PatchitUP — For Every Type of Drywall Damage" horizontal lockup (transparent PNG or SVG) |
| `patchitup-badge.png` | Every **location card badge** (small circle) | The circular mascot logo (square/round transparent PNG) |

Until these files exist, the dashboard shows a brand-styled **placeholder** (Fira Sans
wordmark + a circular "P"), so it always renders — including in the hosted preview link,
where relative asset files aren't served.

## Getting the real logo into the hosted preview

The hosted artifact link can't read these repo files, so to make the **real** logo show
up in that link the image has to be embedded directly in the page as a `data:` URI. Two
easy ways to get it to me:

1. **Commit the PNG** to this folder (e.g. `patchitup-logo.png`) and tell me — I'll
   base64-embed it into `index.html` so it shows everywhere, hosted link included.
2. **Paste a public URL** to the logo that isn't behind Cloudflare/login — I'll fetch and
   embed it.

(Chat-pasted images can't be read as files from here, and `patchitup.com` is blocked by
the sandbox network, which is why I can't auto-pull it.)
