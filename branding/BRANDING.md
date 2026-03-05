# Laurin — Brand Guide

> _"Don't touch the roses."_

## Origin Story

Laurin is named after **King Laurin**, the Dwarf King of the Dolomites from South Tyrolean legend.
He ruled an underground kingdom filled with treasures and tended a magical rose garden.
He wore a cloak of invisibility, and when enemies tried to steal his roses, the garden
turned to stone at sunset — creating the famous pink glow of the Dolomites (the _Enrosadira_).

## Product

**Laurin** is a self-hosted credential proxy for AI agents. Secrets (treasures) are guarded by
Laurin (the proxy). Agents never see them (cloak of invisibility). The rose garden is the
clean API surface hiding the fortress beneath.

## Logo

**Concept B3 — Wine Rose, Trefoil Key**

Five overlapping elliptical petals in wine rose, arranged in a radial pattern like an alpine rose
viewed from above. At the center, a dark void contains a golden trefoil-bow skeleton key — three
interlocking circles forming the ornate handle, a shaft extending downward with flag-style ward teeth.

The rose garden guards the secret; the golden key unlocks it.

- Logo SVG: [`logo.svg`](./logo.svg)
- Logo (dark background variant): [`logo-dark.svg`](./logo-dark.svg)
- The logo is designed for dark backgrounds (#0a0a0a) by default
- Minimum size: 16px (key detail holds at this size)

## Colors

| Token          | Hex       | Usage                                    |
|----------------|-----------|------------------------------------------|
| `rose`         | `#B5485E` | Primary brand color, petals, UI accents  |
| `rose-light`   | `#D4708F` | Hover states, lighter accents            |
| `rose-muted`   | `#E8A0B4` | Backgrounds, subtle highlights           |
| `gold`         | `#D4A843` | Key accent, CTAs, premium feel           |
| `gold-dark`    | `#8B6914` | Gold on dark, secondary gold             |
| `surface`      | `#0a0a0a` | Primary background                       |
| `surface-1`    | `#111111` | Card/panel background                    |
| `surface-2`    | `#1a1a1a` | Borders, dividers                        |
| `text`         | `#e0e0e0` | Primary text                             |
| `text-muted`   | `#888888` | Secondary text                           |

### Color Logic Across dizyx

Each dizyx product has a distinct color identity:

- **Nockerl** — Grays (`#555555`, `#222222`, `#777777`) — granite, mountain stone
- **Dueydo** — Gold (`#C9A84C`) — trust, protection, the shield
- **Laurin** — Wine rose (`#B5485E`) + gold key accent (`#D4A843`) — alpine roses, the secret garden

## Typography

### Display / Headings: Philosopher

**Philosopher** is a humanist sans-serif with calligraphic and blackletter DNA. It has medieval
warmth while remaining clean and modern — a middle-ground between Nockerl's tech-forward
Space Grotesk and Dueydo's classical Cinzel.

```css
--font-display: 'Philosopher', sans-serif;
```

- Weights: 400 (regular), 700 (bold)
- Source: [Google Fonts](https://fonts.google.com/specimen/Philosopher)
- Use for: logo wordmark, h1-h3 headings, hero text, taglines

### Body: Inter

Consistent with the rest of the dizyx product line.

```css
--font-body: 'Inter', system-ui, -apple-system, sans-serif;
```

- Weights: 400, 500, 600
- Use for: body text, UI elements, navigation, descriptions

### Monospace: JetBrains Mono

Consistent with the rest of the dizyx product line.

```css
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
```

- Weights: 400, 500
- Use for: code blocks, API references, terminal output

### Typography Stack Across dizyx

| Product    | Display Font       | Character              |
|------------|--------------------|------------------------|
| Nockerl    | Space Grotesk      | Modern, geometric, tech |
| Dueydo     | Cinzel / Cinzel Decorative | Classical, Roman, regal |
| Laurin     | Philosopher        | Medieval, calligraphic, warm |

## Tagline

> "Don't touch the roses."

## Voice & Tone

- **Confident but understated** — like a king who doesn't need to prove his power
- **Slightly mythical** — references to the legend are welcome but not mandatory
- **Developer-first** — the product is technical; the brand adds character, not confusion
- **Security-minded** — emphasize zero-trust, isolation, the fortress metaphor
