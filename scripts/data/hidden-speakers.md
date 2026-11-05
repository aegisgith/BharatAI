# Hidden speakers

Speakers the organiser asked to hide but not delete. Nothing here is served: `scripts/` is not
under `public/`. Their photos and photo fingerprints stay in place. To bring one back, put each
block back where its note says, bump VERSION in `public/sw.js`, and set `is_published = 1` on the
row (the note gives the slug). Rebuild, test and push as for any speaker change.

## Nilesh Shah, Managing Director, Kotak Mahindra Asset Management Co. Ltd

Hidden on 5 Nov 2026 (organiser: "hide his detail, don't delete"). App: `scripts/sql/speakers-hide-nilesh-shah.sql`,
slug `nilesh-shah`. Photo: `public/images/speaker-nilesh-shah-kotak.avif`.

`public/index.html`, the home grid, before `<!-- Yogesh Bhalla -->`:

```html
                    <!-- Nilesh Shah -->
                    <div class="speaker-card reveal reveal-delay-1" style="text-align:center;align-items:center;">
                        <img width="690" height="388" loading="lazy" decoding="async" src="images/speaker-nilesh-shah-kotak.avif" alt="Nilesh Shah, Managing Director, Kotak Mahindra Asset Management Co. Ltd" class="speaker-photo" style="aspect-ratio:1;border-radius:50%;width:160px;height:160px;margin:0 auto;">
                        <h4>Nilesh Shah</h4>
                        <p style="font-size:0.82rem;color:var(--saffron);font-weight:600;margin:0;">Managing Director</p>
                        <p class="spk-org" style="font-size:0.78rem;"><img width="64" height="64" class="spk-logo" src="images/org-logos/favicon-kotak.com.png" alt="" loading="lazy" onerror="this.remove()">Kotak Mahindra Asset Management Co. Ltd</p>
                        <span class="speaker-topic topic-finance" style="margin-top:0.5rem;">AI in Finance</span>
                    </div>
```

`public/index.html`, the Event JSON-LD `performer` list:

```json
        {
          "@type": "Person",
          "name": "Nilesh Shah",
          "jobTitle": "Managing Director",
          "worksFor": { "@type": "Organization", "name": "Kotak Mahindra Asset Management Co. Ltd" },
          "image": "https://bharataiinnovation.com/images/speaker-nilesh-shah-kotak.avif"
        },
```

`public/index.html`, the FAQ answer "Confirmed speakers include ...", before "Shri Praveen Pardeshi": `Nilesh Shah (MD, Kotak Mahindra AMC), `

`public/index.html`, the "Speakers from" strip, in both lines, after Capgemini: `<span>Kotak Mahindra AMC</span>`

`public/conference.html`, the Speakers grid, between Dr. Shrikant Patil and Yogesh Bhalla:

```html
                <div class="speaker-card reveal reveal-delay-4">
                    <div class="speaker-avatar"><img width="690" height="388" loading="lazy" decoding="async" src="images/speaker-nilesh-shah-kotak.avif" alt="Nilesh Shah"></div>
                    <h4>Nilesh Shah</h4>
                    <div class="speaker-role">Managing Director</div>
                    <div class="speaker-org">Kotak Mahindra Asset Management Co. Ltd</div>
                    <span class="speaker-topic topic-finance">AI in Asset Management</span>
                </div>
```

`public/conference.html`, the Speakers section's subtitle, was: "CXOs leading transformation at Capgemini, Kotak, and Bandhan Bank."

`public/llms.txt`, the Confirmed speakers list:

```text
- **Nilesh Shah** — Managing Director, Kotak Mahindra AMC
```
