## Update Favicon to Custom Icon

Waiting on the user to provide a favicon image (upload) or a URL.

### Steps once asset is provided

**If user uploads an image:**
1. Copy the uploaded file from `user-uploads://` into `public/favicon.png` (or `.svg`/`.ico` matching the upload type).
2. Delete the existing `public/favicon.ico` so browsers don't fall back to the old default.
3. Update `index.html` `<head>` to reference the new file:
   ```html
   <link rel="icon" href="/favicon.png" type="image/png">
   ```

**If user provides a URL:**
1. Update `index.html` `<head>` to point directly at the URL:
   ```html
   <link rel="icon" href="https://example.com/favicon.ico" type="image/x-icon">
   ```

### Notes
- Recommended size: 32x32 or 64x64 (square). SVG also works and scales cleanly.
- Browsers aggressively cache favicons — a hard refresh (Ctrl/Cmd+Shift+R) may be needed to see the change.
- No other files need modification.
