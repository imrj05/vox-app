# Vox landing

A standalone Vite + React + TypeScript marketing site for Vox.

This app is fully independent from the desktop app in the repository root. It
has its own `package.json`, lockfile, dependencies, assets, and build output —
nothing is imported from `../src` or `../package.json`.

```sh
pnpm install
pnpm dev        # local dev server
pnpm build      # type-check + production build -> dist/
pnpm preview    # preview the production build
pnpm typecheck  # tsc project build
pnpm lint       # eslint
```

## Structure

```text
landing/
├── public/                 # favicon and other static files
├── src/
│   ├── assets/             # bundled images (fingerprinted by Vite)
│   ├── components/
│   │   ├── demos/          # dark product windows used in the walkthrough
│   │   ├── layout/         # site header and footer
│   │   ├── sections/       # hero, features, walkthrough, privacy, FAQ, CTA
│   │   ├── ui/             # shadcn-style primitives (button, accordion)
│   │   ├── github-star.tsx # GitHub link + live star count
│   │   ├── icons.tsx       # brand icons not shipped by Lucide
│   │   ├── reveal.tsx      # scroll-reveal wrapper
│   │   └── theme-toggle.tsx # light / dark toggle
│   ├── data/               # page copy and section content
│   ├── hooks/              # reduced motion, scroll spy, theme, stars
│   ├── lib/                # site/layout constants, GitHub API, cn
│   ├── app.tsx             # page composition
│   ├── index.css           # Tailwind v4 theme, tokens, keyframes
│   └── main.tsx            # entry point
├── components.json         # shadcn CLI configuration
├── eslint.config.js
├── index.html
├── tsconfig*.json
└── vite.config.ts
```

Fonts are bundled through `@fontsource-variable` (Urbanist and Geist Mono), so
the page does not depend on a third-party font CDN.

## Theme

The site ships light and dark themes. The first visit follows the operating
system; the header toggle stores an explicit choice in `localStorage`
(`vox-theme`). An inline script in `index.html` applies the theme before paint
so dark visitors do not see a light flash, and the toggle keeps the browser
`theme-color` in sync.

## GitHub stars

The header and footer GitHub links read the live star count from the public
GitHub REST API. The hook caches the result in `sessionStorage` for ten minutes
and shares one in-flight request between both links. If the API is unavailable
or rate-limited, the links still work without a count.

## Release version

The version shown in the hero comes from this app's own `package.json`
(`__APP_VERSION__`, injected at build time). Bump it here when the desktop
release it announces changes.
