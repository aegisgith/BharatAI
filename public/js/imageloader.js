/**
 * Image Loader for Bharat AI Innovation 2026
 * Loads image URLs from the image_urls table (blob storage URLs).
 * Falls back to local img/ paths if no blob URLs found.
 */
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        // Fetch blob URLs from API
        fetch('tables/image_urls?limit=100')
            .then(function(res) { return res.json(); })
            .then(function(result) {
                var urls = {};
                (result.data || []).forEach(function(r) {
                    if (r.id && r.url) urls[r.id] = r.url;
                });

                // Update all img tags that have src="img/XXXXX.jpg"
                var images = document.querySelectorAll('img[src^="img/"]');
                images.forEach(function(img) {
                    var src = img.getAttribute('src');
                    // Extract ID from "img/XXXXX.jpg"
                    var match = src.match(/img\/([^.]+)\.jpg/);
                    if (match && urls[match[1]]) {
                        img.src = urls[match[1]];
                    }
                });

                if (Object.keys(urls).length > 0) {
                    console.log('[ImageLoader] Loaded ' + Object.keys(urls).length + ' blob URLs');
                }
            })
            .catch(function(err) {
                console.log('[ImageLoader] No blob URLs, using local paths');
            });
    });
})();
