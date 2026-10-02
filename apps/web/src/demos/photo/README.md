# Photo demo data

- `credits.json`: source, author and license of each example photo (all CC0, from Wikimedia
  Commons). The files are in `apps/web/public/demo/photos/`.
- `fixtures.json`: the unedited responses of the real API for those photos. The demo shows them
  when you pick an example. "Try your own photo" calls the API live.

## How `fixtures.json` was made (2026-10-02)

1. Run the local Worker (`packages/worker`, `wrangler dev` on port 8788, Workers AI available).
2. For each photo, downscale to 384 px like the browser does, then send it:

```sh
sips -s format jpeg -s formatOptions 82 -Z 384 public/demo/photos/puppy.jpg --out /tmp/puppy.jpg
curl -X POST "http://localhost:8788/v1/classify-image?key=pk_demo&limit=8&locale=en" \
  -H "Content-Type: image/jpeg" -H "Origin: http://localhost:4321" \
  --data-binary @/tmp/puppy.jpg
```

3. Save each response body under `photos[].response`, and the `Server-Timing` header under
   `photos[].serverTiming`.

The vision model is not deterministic, so a new run can give a slightly different caption,
keywords and emoji. The API can return fewer than 8 results. The demo shows the caption, the
keywords and the first 6 results.
