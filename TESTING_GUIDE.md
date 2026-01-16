# Image Enhancements Testing Guide

## 🚀 Quick Start
```bash
npm run dev
```
Then open http://localhost:5173

## ✅ Test Checklist

### 1. Copy Post Button
- [ ] Create a post with some text
- [ ] **Expected:** "📋 Copy" button appears in post header
- [ ] Click the copy button
- [ ] **Expected:** Button changes to "✓ Copied" with green background
- [ ] **Expected:** Button reverts back after 2 seconds
- [ ] Paste somewhere (Cmd+V)
- [ ] **Expected:** Post text is pasted
- [ ] Try with empty post
- [ ] **Expected:** Copy button is disabled (grayed out)

### 2. Clipboard Paste Support
- [ ] Take a screenshot (Cmd+Shift+4 on Mac)
- [ ] Open a draft post
- [ ] Click in the textarea
- [ ] Press Cmd+V (or Ctrl+V)
- [ ] **Expected:** Image uploads and appears with 📋 badge
- [ ] **Expected:** Counter shows "1/4"

### 3. Images + Embed Coexistence
- [ ] Add 2 images to a post (drag/click upload)
- [ ] Paste a tweet URL in the "Paste tweet URL to embed..." field
  - Example: `https://twitter.com/username/status/123456789`
- [ ] **Expected:** Both images AND embed show together
- [ ] **Expected:** No clearing of images when embed added
- [ ] **Expected:** No clearing of embed when images added

### 4. URL Auto-Detection (Single URL)
- [ ] Type in textarea: `Check this image https://picsum.photos/200/300.jpg`
- [ ] Wait 500ms (debounce)
- [ ] **Expected:** "Detecting and converting image URLs..." message appears
- [ ] **Expected:** Image uploads automatically
- [ ] **Expected:** URL is removed from text
- [ ] **Expected:** Image shows 🔗 badge
- [ ] **Expected:** Hover shows source URL in tooltip
- [ ] **Expected:** Click 🔗 icon opens original URL

### 5. URL Auto-Detection (Multiple URLs)
- [ ] Paste text with 3 image URLs:
```
Great images:
https://picsum.photos/200/300.jpg
https://picsum.photos/201/301.jpg
https://picsum.photos/202/302.jpg
```
- [ ] Wait 500ms
- [ ] **Expected:** All 3 convert automatically
- [ ] **Expected:** All 3 URLs removed from text
- [ ] **Expected:** All show 🔗 badges

### 6. Image Limit Edge Cases
- [ ] Add 4 images to a post (max limit)
- [ ] **Expected:** Upload area disappears
- [ ] Try to paste another image (Cmd+V)
- [ ] **Expected:** Error message "Maximum 4 images reached"
- [ ] Type another image URL in text
- [ ] **Expected:** URL detection ignores it (no remaining slots)

### 7. Upload Method Badges
- [ ] Upload image via file: **Expected:** 📁 badge
- [ ] Paste image via clipboard: **Expected:** 📋 badge
- [ ] Auto-convert URL: **Expected:** 🔗 badge
- [ ] All badges should appear in bottom-left of image preview

### 8. Source URL Preservation
- [ ] Add image via URL: `https://picsum.photos/200.jpg`
- [ ] **Expected:** 🔗 link icon in bottom-right of preview
- [ ] Click the 🔗 icon
- [ ] **Expected:** Opens original URL in new tab
- [ ] Hover over image
- [ ] **Expected:** Tooltip shows source URL

### 9. Backward Compatibility
- [ ] Load an old draft (if you have one with string array images)
- [ ] **Expected:** Images still display correctly
- [ ] **Expected:** Old images auto-migrate to new format
- [ ] **Expected:** Old images show 📁 badge (default to 'file' method)

### 10. Export with Source URLs
- [ ] Add image via URL to a post
- [ ] Click "📝 Markdown" export
- [ ] Open the downloaded .md file
- [ ] **Expected:** See `![Image 1](storage-url)`
- [ ] **Expected:** See `<!-- Source: original-url -->` below image
- [ ] Click "📄 JSON" export
- [ ] **Expected:** JSON includes `sourceUrl` and `uploadMethod` fields

### 11. Error Handling
- [ ] Try CORS-blocked URL (some sites block cross-origin requests)
  - Example: Try a URL from a site with strict CORS
- [ ] **Expected:** Error message "Cannot fetch image: ..."
- [ ] **Expected:** URL NOT removed from text
- [ ] Try invalid image URL: `https://example.com/notanimage`
- [ ] **Expected:** Error message shown
- [ ] Try uploading file > 5MB
- [ ] **Expected:** "Image size must be less than 5MB"

### 12. Mixed Content Test
- [ ] Add 2 images (via upload)
- [ ] Paste 1 image (via clipboard)
- [ ] Add 1 image URL in text (auto-detect)
- [ ] Add tweet embed URL
- [ ] **Expected:** All 4 images + 1 embed show correctly
- [ ] **Expected:** Each image has correct badge (📁, 📋, 🔗)
- [ ] Save and reload page
- [ ] **Expected:** Everything persists correctly

## 🐛 Common Issues

### Images not uploading
- Check Supabase credentials in `.env`
- Check browser console for errors
- Verify Supabase storage bucket exists

### CORS errors on URL fetching
- This is expected for some URLs
- Error message should guide user to upload manually
- Not all websites allow cross-origin image fetching

### URL detection not working
- Wait full 500ms after typing
- Ensure URL ends with image extension
- Check supported formats: jpg, jpeg, png, gif, webp, bmp, svg

## 📊 Expected Data Format

### New Image Object
```javascript
{
  url: "https://storage.url/path/to/image.jpg",
  sourceUrl: "https://original.site/image.jpg",  // Only for URL-added images
  uploadMethod: "file" | "clipboard" | "url"
}
```

### Old Format (Still Supported)
```javascript
images: ["https://storage.url/1.jpg", "https://storage.url/2.jpg"]
```

Both formats work! Old drafts auto-migrate to new format when opened.

## 🎯 Success Criteria

All tests should pass with:
- ✅ No console errors (except expected CORS warnings)
- ✅ Images persist after page reload
- ✅ Source URLs preserved and accessible
- ✅ Upload method badges display correctly
- ✅ Old drafts still work (backward compatibility)
- ✅ Export includes source URLs
- ✅ Images and embeds coexist peacefully

## 📝 Notes

- Maximum 4 images per post (existing limit maintained)
- Maximum 1 embed per post (existing limit maintained)
- Image size limit: 5MB per image
- Compression: Images resized to max 1920px width
- Debounce: 500ms delay on URL detection
- Auto-save: Drafts save automatically every 1 second
