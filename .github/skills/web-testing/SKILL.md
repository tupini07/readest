---
name: web-testing
description: Guide for testing the Readest app in web mode using Puppeteer. Use this when asked to test, verify, or visually inspect UI changes without building a native app.
---

# Web Testing with Puppeteer

Use the web dev server + Puppeteer (headless Chrome) to quickly test UI changes, verify features, and take screenshots — without building a native APK or desktop app.

## When to Use

- **Fast iteration**: web dev server starts in ~3 seconds vs ~10 minutes for Android APK
- **UI verification**: take screenshots to visually confirm changes
- **Feature testing**: import books, navigate pages, check console output
- **Limitations**: Tauri-native APIs (file system, native dialogs, platform plugins) are unavailable in web mode. The app runs with `NEXT_PUBLIC_APP_PLATFORM=web`.

## Environment Setup

```bash
# Install dependencies and vendor files (first time only)
mise x -- task setup

# Increase Node.js heap for large builds (if needed)
export NODE_OPTIONS="--max-old-space-size=8192"
```

## Start the Dev Server

```bash
mise x -- task dev-web
```

The server runs at **http://localhost:3000**. Verify with:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
```

## Install Puppeteer (First Time)

Puppeteer must be installed outside the project to avoid polluting dependencies:

```bash
cd /tmp && npm install puppeteer
npx puppeteer browsers install chrome
```

## Puppeteer Basics

All Puppeteer scripts should be run from `/tmp` (where puppeteer is installed):

```bash
cd /tmp && node -e "
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    userDataDir: '/tmp/puppeteer-profile'  // persist session data
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Listen for console messages
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: '/tmp/screenshot.png' });
  await browser.close();
})();
"
```

Then view the screenshot with the `view` tool on `/tmp/screenshot.png`.

**Important**: Use `userDataDir` to persist IndexedDB data (books, settings) across runs. Without it, each launch starts with an empty library.

## Common Tasks

### Import a Book

Books are imported via a simulated drag-and-drop event. The native file chooser does NOT work in Puppeteer for this app.

```javascript
const fs = require('fs');

// Load the epub file as bytes
const fileBytes = [...fs.readFileSync('/path/to/book.epub')];

await page.evaluate(async (bytes) => {
  const arr = new Uint8Array(bytes);
  const file = new File([arr], 'book.epub', { type: 'application/epub+zip' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.body.dispatchEvent(
    new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    }),
  );
}, fileBytes);

// Wait for import to process
await new Promise((r) => setTimeout(r, 6000));
```

**Note**: On first visit, demo books (Hamlet, Meditations, etc.) are auto-loaded. You may not need to import anything for basic testing.

### Open a Book from the Library

Single-click on a book cover navigates to the reader:

```javascript
// Find all book cover images
const covers = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('img')).map((img) => ({
    alt: img.alt,
    x: Math.round(img.getBoundingClientRect().x + img.getBoundingClientRect().width / 2),
    y: Math.round(img.getBoundingClientRect().y + img.getBoundingClientRect().height / 2),
  }));
});

// Click the first cover to open it
await page.mouse.click(covers[0].x, covers[0].y);
await new Promise((r) => setTimeout(r, 8000));
// URL will change to: http://localhost:3000/reader/{bookHash}
```

Or navigate directly if you know the book hash:

```javascript
await page.goto('http://localhost:3000/reader/' + bookHash, {
  waitUntil: 'networkidle2',
  timeout: 30000,
});
```

### Navigate Pages in the Reader

Use keyboard arrow keys — click/drag gestures are interpreted as page turns:

```javascript
// Go forward
await page.keyboard.press('ArrowRight');

// Go backward
await page.keyboard.press('ArrowLeft');

// Navigate multiple pages
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 300));
}
```

### Find Clickable Elements

Since the app is a WebView/SPA, use `evaluate` to discover UI elements:

```javascript
const elements = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button, [role=button], a, input')).map((el) => ({
    tag: el.tagName,
    text: (el.textContent || '').trim().substring(0, 50),
    ariaLabel: el.getAttribute('aria-label'),
    x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
  }));
});
```

### Check Console Output

Attach a listener before navigating:

```javascript
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error') console.log('ERROR:', text);
  // Filter out noisy messages
  if (!text.includes('DevTools') && !text.includes('HMR'))
    console.log('LOG:', text.substring(0, 200));
});
```

### Get Book Hashes from IndexedDB

```javascript
const books = await page.evaluate(async () => {
  return new Promise((resolve) => {
    const req = indexedDB.open('AppFileSystem');
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const allReq = store.getAllKeys();
      allReq.onsuccess = () => {
        // Book hashes are in paths like "Readest/Books/{hash}"
        const hashes = allReq.result
          .filter((k) => k.match(/^Readest\/Books\/[a-f0-9]{32}$/))
          .map((k) => k.split('/')[2]);
        resolve(hashes);
      };
    };
  });
});
```

## Architecture Notes

- **Book content** is rendered inside nested `about:srcdoc` iframes (foliate-js viewer). You cannot directly access iframe content from the main page context — use `page.frames()` to enumerate them.
- **Page navigation**: ArrowRight/ArrowLeft keys work. Mouse drag in the reader area triggers page turns, not text selection.
- **Library data** is stored in IndexedDB (`AppFileSystem` database, `files` store). The library manifest is at key `Readest/Books/library.json`.
- **Routes**:
  - Library: `http://localhost:3000/` or `/library`
  - Reader: `http://localhost:3000/reader/{bookHash}` (web mode uses path-based routing)

## Download Test Books

```bash
# Alice in Wonderland from Project Gutenberg
curl -L -o /tmp/alice.epub "https://www.gutenberg.org/ebooks/11.epub3.images"

# Pride and Prejudice
curl -L -o /tmp/pride.epub "https://www.gutenberg.org/ebooks/1342.epub3.images"
```

## Cleanup

```bash
# Remove persisted browser profile
rm -rf /tmp/puppeteer-profile

# Stop the dev server (if running in background)
# Use stop_bash with the shellId of the dev-web process
```

## Timeouts Guide

| Action                      | Recommended wait                          |
| --------------------------- | ----------------------------------------- |
| Page load (`goto`)          | `waitUntil: 'networkidle2'`, timeout: 30s |
| Book import (drop)          | 6–8 seconds                               |
| Open book in reader         | 8–10 seconds                              |
| Page navigation (arrow key) | 300–500ms per page                        |
| Screenshot after action     | 1–2 seconds                               |
