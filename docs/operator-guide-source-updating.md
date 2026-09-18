# Buglasan Live Operations — Operator Guide to Source Updating

This practical guide explains how to add and update Buglasan Festival sources during live operations without editing code or running complex database scripts.

---

## 1. Where to Place New Sources

All authoritative sources belong in:

```
operator-sources/Buglasan 2026 Official Sources/
```

Inside this folder, create a new subfolder named after the next sequential bundle number (e.g., `36`, `37`, `38`...).

Inside each bundle folder:
- **`manifest.txt`** or **`New Text Document.txt`** (Required): Contains the source URL and caption.
- **Media files** (Optional): Associated images (`.jpg`, `.jpeg`, `.png`, `.webp`) or video clips (`.mp4`, `.webm`).
- **`identity.json`** (Optional sidecar): Helpful if the Facebook URL uses an opaque `pfbid` format.

---

## 2. What Metadata / Identity Information Each Source Needs

Every source bundle requires:
1. A **Facebook URL**:
   - Canonical Reel URL: `https://www.facebook.com/reel/<numeric-id>/`
   - Canonical Buglasan Post URL: `https://www.facebook.com/Buglasan/posts/<numeric-id>/`
   - Amplified Official Post URL: `https://www.facebook.com/<OfficialPage>/posts/<numeric-id>/`
2. An **Operator Caption / Text Evidence**:
   - The text of the announcement, schedule details, or description.

### Format of `manifest.txt` or `New Text Document.txt`

```
URL:
https://www.facebook.com/Buglasan/posts/1501234567890123

CAPTION:
Official Schedule of the Buglasan 2026 Street Dance Competition on October 18, 2026 at Freedom Park.
```

### Opaque `pfbid` URLs (e.g. from mobile Facebook app shares)

If you have a URL like:
```
https://www.facebook.com/Buglasan/posts/pfbid02amKUbVey9pjWu2XbxsMzVYDn9FMDv7Um3xHzq9J9ogMrnWLNo8UCFaYkP1VykVFql...
```

You can either:
- **Option A (In manifest text)**: Add a `POST_ID:` or `CANONICAL_URL:` line above the URL:
  ```
  POST_ID:
  1501234567890123

  URL:
  https://www.facebook.com/Buglasan/posts/pfbid02amKUbVey9pj...

  CAPTION:
  Schedule text...
  ```
- **Option B (Sidecar file)**: Create a small `identity.json` inside the bundle folder:
  ```json
  {
    "postId": "1501234567890123",
    "canonicalUrl": "https://www.facebook.com/Buglasan/posts/1501234567890123/"
  }
  ```

---

## 3. What Single Command to Run

To update sources:

```bash
npm run buglasan:update
```

To check overall corpus health without modifying anything:

```bash
npm run buglasan:status
```

---

## 4. How to Preview

By default, running:

```bash
npm run buglasan:update
```

is **PREVIEW-ONLY**. It scans your source directory, compares it with the production database, and shows you:
- How many bundles are already current;
- Exactly what new sources are proposed for intake;
- Exactly which bundles (if any) need review.

**Zero changes are made to production during preview.**

---

## 5. How to Confirm Production Intake

Once you have reviewed the preview and are satisfied with the proposed intake, run the command with the explicit confirmation flag:

```bash
npm run buglasan:update -- --confirm-production
```

This will:
1. Ingest only approved new or changed sources.
2. Submit them to the production source boundary.
3. Automatically trigger downstream indexing, extraction, and candidate reconciliation.
4. Output a compact summary report.

---

## 6. How to Understand Statuses

The update report will display one of the following bundle classifications:

| Status | Meaning | Next Operator Action |
| :--- | :--- | :--- |
| **`unchanged`** | Bundle is already ingested and its content has not changed. | None. Safe and ignored. |
| **`new`** | Valid new source bundle ready for production intake. | Proceed with `--confirm-production`. |
| **`changed`** | Existing source bundle whose local caption or media has been modified. | Review proposed diff, then intake. |
| **`needs_identity_review`** | Bundle URL is an opaque `pfbid` or lacks a numeric Facebook ID. | Add canonical post ID or `identity.json`. |
| **`incomplete`** | Bundle is missing a URL, or has no caption and no supported media. | Add manifest text with URL and caption. |
| **`invalid`** | Bundle contains corrupted files or unreadable artifacts. | Fix or remove corrupted file. |

---

## 7. How to Resolve `NEEDS IDENTITY REVIEW`

If the preview reports:
```
! Bundle 38
  Raw URL: https://www.facebook.com/Buglasan/posts/pfbid0XzLwoz...
  Next human action: Opaque pfbid Facebook URL requires canonical numeric post ID.
```

**Steps to resolve:**
1. Open the post in your browser on desktop Facebook.
2. Find the canonical numeric post ID (or right-click timestamp → Copy Link Address).
3. Place an `identity.json` inside the bundle directory `operator-sources/Buglasan 2026 Official Sources/38/`:
   ```json
   {
     "postId": "1479386384226415"
   }
   ```
   *or* add `POST_ID: 1479386384226415` to `manifest.txt`.
4. Run `npm run buglasan:update` again to verify it now displays as `New`.

---

## 8. What Happens During Provider Outages

If the LLM or embedding provider (e.g. Google Gemini) experiences a temporary outage, rate limit (HTTP 429), or 503 error during downstream processing:

- **Source admission is SAFE**: The source is already saved into production and will not be lost.
- **Clear reporting**: The report notes `provider unavailable (retryable)`.
- **No data corruption**: The system does not hammer the provider or corrupt the ledger.
- **Future processing**: Running downstream recovery or future updates will process the pending extraction/indexing when the provider recovers.

---

## 9. How to Rerun Safely

You can run `npm run buglasan:update` as many times as you like.
- If no new or changed sources exist, it outputs: `Corpus is ALREADY CURRENT. No production changes required.`
- It will never duplicate existing production sources.

---

## 10. How Idempotency Protects Existing Sources

Every source is identified by its unique canonical identity `(platform, post_id)` and its cryptographic `content_fingerprint`.

When you run an update:
1. If the source post ID already exists in production and its content matches the stored fingerprint, it is classified as `unchanged`.
2. Unchanged sources are never re-submitted or re-indexed.
3. Your existing production knowledge base and chat citations remain completely undisturbed.
