# Bridgecast release site

Download page and changelog for Bridgecast, published to GitHub Pages at
https://callmeson.github.io/Bridgecast. Built on the free
[Track](https://github.com/shadcnstudio/shadcn-nextjs-track-landing-page-free) template by shadcn/studio
(MIT, see `LICENSE.md`), with shadcn/ui, Next.js static export and Tailwind CSS.

The page has no content of its own to update: at build time it reads every GitHub release of
`CallMeSon/Bridgecast`. The changelog is each release's notes (the `CHANGELOG.md` section that
`scripts/release.mjs` publishes), and each download button points at the newest release that carries
that platform's file.

```sh
npm install
npm test         # release notes parser and download picker
npm run build    # writes out/; set GITHUB_TOKEN to avoid the 60 requests/hour limit
```

`.github/workflows/site.yml` builds and deploys it on a change under `site/release/`, on every published
release, after the macOS build, and daily.
