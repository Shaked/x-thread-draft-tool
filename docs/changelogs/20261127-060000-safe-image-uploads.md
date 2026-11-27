# Safer image uploads

- Uploads are checked by their bytes: only PNG, JPEG, WebP and GIF are accepted, SVG and other files are refused.
- Location and text data (EXIF, XMP, PNG text) is removed from uploaded images; a JPEG keeps only its rotation.
- The admin user page shows each user's stored image bytes. No storage cap yet.

Area: Images
Link: https://github.com/Shaked/x-thread-draft-tool/issues/416
