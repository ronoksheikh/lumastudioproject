# Third-party licences (hosted generator check)

Status: engineering review, **not legal advice**. One item needs a written answer before launch (GSAP).

| Component | Licence | Fits a hosted generator? |
|---|---|---|
| **GSAP 3.15** (+ DrawSVG, CustomEase) | GreenSock "Standard no-charge" licence, https://gsap.com/standard-license | **Probably, confirm in writing.** Commercial use is free. The one restriction: no use "in tools that allow users to build visual animations without code that encourages, induces, or materially assists in creating a solution that competes with Webflow's visual animation building capabilities". Luma Studio is a prompt-to-video agent for a course, not a no-code visual animation builder, and students receive finished videos. Because it is a tool that makes animations for others, email GreenSock/Webflow once, describe the product, and keep the answer in this folder. The FAQ invites exactly this question. |
| **Three.js** | MIT | Yes. Keep the notice in `template/public/vendor`. |
| **d3-geo, topojson-client, world-atlas** | ISC | Yes. |
| **Natural Earth data** (inside world-atlas) | Public domain | Yes. |
| **Fonts**: Inter, Anek Bangla, JetBrains Mono | SIL OFL 1.1 | Yes: may be bundled and served; may not be sold on their own. Vendored as woff2 in `template/assets/fonts`. |
| **ffmpeg / libx264** | GPL (Debian build) | Yes for server-side use: students receive MP4 output, not the binaries. Output files carry no GPL obligations. If the image is ever redistributed, GPL source obligations apply to that image. |
| **Chromium / Playwright / puppeteer-core** | BSD-style / Apache-2.0 | Yes. |
| **Lumademy logos and brand kit** | Ours | Yes. The template ships the white icon/lock-up only. |
| **ElevenLabs** | Their terms; students use **their own** API keys | The student contracts with ElevenLabs. Check the plan they use allows commercial use if they publish the video; the Studio's Voice settings page links to their terms. We never use a shared key. |
| **Model providers (OpenRouter, OpenAI, …)** | Their terms; students bring their own keys | Same as above. |

Before launch: (1) get the GSAP answer, (2) add a short "Credits & licences" page to the app, (3) re-run this check whenever a runtime dependency is added (`docker/runtime-deps/package.json`).
