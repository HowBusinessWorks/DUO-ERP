# LLM_DESIGNER.md
> A living document of design anti-patterns, red flags, and best practices for AI-assisted web design. Built from real critique by industry professionals reviewing AI-generated/vibecoded sites.

---

## PURPOSE

This skill exists because AI coding tools default to the most statistically common patterns — which means every AI-assisted site ends up looking the same. This document catalogs the specific tells, explains *why* they fail, and provides the corrective principle for each.

**Add to this document as new patterns are identified.**

---

## PART 1 — THE "AI SLOP" PATTERN CATALOG

Each entry follows this structure:
- **What it is** — the specific pattern
- **Why it fails** — the UX or design reasoning
- **The fix** — how to avoid or replace it

---

### 1.1 Purple Gradients Everywhere

**What it is:** Startup websites flooded with bright purple-to-pink gradients as the primary visual theme. Often combined with pinkish-purple accent colors across CTAs, headings, and backgrounds.

**Why it fails:** It strips away brand originality entirely. When every AI-generated site uses the same palette, your product signals "I used the default settings" rather than "I thought carefully about who I am." Color is one of the strongest brand identity tools — defaulting to purple gradients wastes it.

**The fix:**
- Build a palette from your brand's *emotional register*, not from what looks "techy."
- If you must use purple, pair it with an unexpected secondary (warm amber, raw cream, deep forest) to break the template feel.
- Use gradients sparingly and directionally — they should guide the eye, not wallpaper the screen.
- Forbidden combos: purple→blue on white, purple→pink on dark, teal+navy as a full-site theme.

---

### 1.2 Broken / "Dumb" Hover Effects

**What it is:** Interactive hover states that do the opposite of what users expect. Common examples:
- Navigation buttons that fade *out* or disappear on hover (the opposite of highlighting selection)
- Elements that shift horizontally at random
- Directional arrows that animate *backward* instead of forward

**Why it fails:** Hover states exist to give feedback — "this is interactive, here's what it does." A hover that hides or confuses defeats the entire purpose. Users lose trust in the interface immediately.

**The fix:**
- Every hover state must answer one question: *does this make the element feel more selected/active, or less?*
- Arrows point in the direction of the action. A "next" arrow on hover should nudge *forward*, never back.
- Fading should be used to *reveal* on hover (secondary info appearing), never to *remove* the primary element.
- Test every hover: if it looks like a bug, it's a bug.

---

### 1.3 Fade-In on Scroll (Indiscriminate Use)

**What it is:** Page sections that start invisible and slowly fade in as the user scrolls into them. Applied globally to every section of the page.

**Why it fails:** 
- Feels like "scrolling through molasses" — unnatural resistance to reading.
- Content can be *missed entirely* if the user scrolls faster than the animation triggers.
- When every element fades in, none of them feel special. The animation loses meaning.
- It's the lazy default in Framer, GSAP starters, and most AI-generated scroll libraries.

**The fix:**
- Use scroll-triggered reveals *selectively* — only for elements where the arrival genuinely matters (a key stat, a product reveal, a before/after).
- Content should be readable by default. Animation layers on top, it doesn't gatekeep.
- If you use fade-in: make it fast (200–300ms), subtle (opacity 0.4 → 1, not 0 → 1), and only on the first viewport intersection.
- Respect `prefers-reduced-motion`: strip all scroll animations for users who need it.

---

### 1.4 Scroll Jacking

**What it is:** Hijacking the browser's native scroll behavior to temporarily lock the user on a section of the page and force them to watch an animation complete before they can continue scrolling.

**Why it fails:**
- Users' scroll speed is *their* preference — it reflects how they process information. Overriding it is hostile UX.
- Creates a jarring, out-of-control sensation.
- Breaks keyboard navigation and assistive technology.
- The animation being "forced" is almost never important enough to justify the friction.

**The fix:**
- Never lock scroll. If an animation needs to complete, make it short enough that it doesn't need to.
- Use scroll-linked animations (progress tied to scroll position) instead of scroll-triggered locks.
- If a sequence is critical to understanding (e.g., a product walkthrough), use a dedicated interactive component *outside* of the page scroll, not inside it.

---

### 1.5 Animated Lines Following the Scroll

**What it is:** SVG path lines that draw themselves as the user scrolls down the page, tracing a visual "thread" between sections.

**Why it fails:**
- The line becomes the focal point instead of the content.
- Users watch the line instead of reading the value proposition.
- Usually connects concepts that don't actually need connecting — the visual metaphor is false.
- Adds significant JS weight for near-zero informational value.

**The fix:**
- Only use connecting visuals if there is a genuine *sequential relationship* between sections that prose cannot convey.
- If you must show flow, use static diagrams or subtle static dividers — not animated SVG paths.
- Ask: "Would removing this line make the page worse?" If no, remove it.

---

### 1.6 Pointless / Decorative Animations

**What it is:** Complex animations that exist purely because the AI made them easy to generate. Examples:
- Meteors or particles shooting across the screen from the corners
- Constantly moving/pulsing buttons with no interaction
- Looping background animations (spinning gradients, floating blobs)
- Floating icons with no purpose

**Why it fails:**
- Motion draws the eye — it's hardwired. Purposeless motion competes with your actual message.
- Slows page performance.
- Ages rapidly; looks trendy for 3 months, then looks dated.
- Makes the site feel like a demo reel, not a product.

**The fix:**
- Every animation must have a *communicative purpose*: loading state, state change, guiding attention, confirming action.
- Ask: "What would the user understand or feel if this animation weren't here?" If the answer is "the same thing," cut it.
- Background should be still unless motion IS the product (e.g., a motion design studio).

---

### 1.7 Critical Information Hidden Behind Hovers

**What it is:** Using hover states to reveal essential text, labels, or functionality — information that users need to understand what the product does or how to use it.

**Why it fails:**
- Mobile users cannot hover. If hover reveals a CTA or explanation, mobile users are excluded.
- Users shouldn't have to hunt to understand a product. First-time visitors especially won't mouse over every element to find the explanation.
- Creates a frustrating "guess what this does" experience.

**The fix:**
- Essential information (what the product does, what a button does, what a feature is) must be visible by default.
- Hover states are for *supplementary* information: keyboard shortcuts, secondary descriptions, preview thumbnails.
- Rule of thumb: if hiding this on mobile would break the experience, it shouldn't be hover-only on desktop either.

---

### 1.8 Inconsistent Visual Hierarchy

**What it is:** Mixing completely different visual styles on the same page. Most commonly: combining 4–5 different font sizes, weights, and styles in a single headline — bold + italic + colored + outlined + uppercase all in one block of text.

**Why it fails:**
- The eye has no anchor. When everything is "special," nothing is.
- Looks like a ransom note — chaotic, unintentional, untrustworthy.
- Signals that no one made deliberate decisions about what matters most.

**The fix:**
- Define a strict typographic hierarchy before building: display, H1, H2, H3, body, caption. Each level has ONE consistent treatment.
- A headline can have *one* stylistic variation (e.g., one word in italic for emphasis) — not five.
- Audit every text block: if removing a style treatment doesn't hurt the message, remove it.
- Consistency IS the hierarchy. Variation only has meaning against a consistent baseline.

---

### 1.9 Standardized "Bento Box" Layouts

**What it is:** Overuse of the 3×2 grid of rounded rectangular cards ("bento boxes"), each with a generic icon at the top and a short label underneath. Used for features, benefits, team members, or any grouped content.

**Why it fails:**
- The layout has become a cliché through AI overuse. Seeing it immediately signals "default template."
- Treats all features as equal — provides no sense of priority or narrative.
- The icon + text pattern rarely communicates what a feature actually *does*.

**The fix:**
- Break the grid. Use asymmetric layouts where the most important feature gets a larger card.
- Replace generic icons with screenshots, illustrations, or actual product UI where possible.
- If a grid is genuinely the right pattern, vary card sizes and visual treatments within it.
- Ask: "Does this layout tell a story, or is it just storing items?"

---

### 1.10 Generic Dashboard Colors

**What it is:** Fake product dashboards (often shown as social proof or "product previews") that use Google's default chart palette — red, yellow, green, blue — for all callouts, status indicators, and UI elements.

**Why it fails:**
- Immediately reads as a mockup, not a real product.
- No brand identity in the "product" screenshot undermines credibility.
- The Google color set is associated with *data neutrality*, not branded software.

**The fix:**
- Dashboard mockups should use your brand's actual color palette.
- Status colors (success/warning/error) should be *derived from* brand colors, not substituted by traffic-light defaults.
- Even if using standard semantic colors (green = good, red = bad), tint them toward your brand.

---

### 1.11 Stock Emojis and Generic Icons

**What it is:** Heavy reliance on standard system emojis or cobbled-together icon libraries (mixing Heroicons with Material Icons with FontAwesome) instead of a cohesive icon system.

**Why it fails:**
- System emojis render differently across platforms — your carefully placed ✨ looks different on Windows, Mac, and Android.
- Mixing icon libraries creates visual incoherence: stroke weights, corner radii, and visual styles clash.
- Generic icons are *generic* — they add no brand personality and don't aid comprehension beyond the obvious.

**The fix:**
- Pick **one** icon library and use it exclusively. Recommended: Phosphor, or a custom set.
- For brand moments (hero sections, feature callouts), consider custom illustrations or Lottie animations instead of icons.
- If using emojis, use them sparingly and only where the informal register is intentional.
- Never mix icon styles on the same page.

---

### 1.12 Clashing / AI-Selected Color Palettes

**What it is:** Letting the AI pick colors without applying software color theory — resulting in overly bright, high-saturation palettes that clash against each other or feel visually aggressive in an app context.

**Why it fails:**
- Bright colors work in marketing contexts but fatigue users in software they stare at for hours.
- AI defaults to visually "exciting" combinations, not calm, functional ones.
- Clashing hues signal amateur tooling choices, not intentional brand identity.

**The fix:**
- Apply software color theory: backgrounds should be low-saturation, surfaces slightly elevated, accents reserved for single interactive elements.
- Replace generic dark blues with more refined alternatives (e.g., deep muted greens, warm charcoals) that feel considered rather than default.
- Reference real SaaS products (Linear, Vercel, Raycast, Notion) for color discipline — not Dribbble shots.
- Palette rule: one background, one surface, one border, one text, one accent. Everything else derives from these five.

---

### 1.13 Cluttered / Redundant Navigation (Vibe-Coded Sidebars)

**What it is:** AI-generated sidebars that list every possible link — settings, billing, account, help, profile, preferences — as top-level navigation items, creating visual noise and no sense of hierarchy.

**Why it fails:**
- Treats all functions as equally important, which means nothing is important.
- Creates decision paralysis and makes the core actions harder to find.
- Feels like a database dump of routes, not a designed information architecture.

**The fix:**
- Consolidate low-frequency items (settings, billing, logout) into a single **account/profile popover** triggered from an avatar or name in the sidebar footer.
- Primary navigation should contain only the 3–6 things users do *daily*.
- Tighten spacing and left-align elements — generous padding without hierarchy reads as filler, not breathing room.
- Ask: "Would a user click this more than once a week?" If no, it doesn't belong in primary nav.

---

### 1.14 Static KPI Numbers Without Context

**What it is:** Dashboard stat cards that display a single big number (e.g., "1,240 users") with no trend, comparison, or visual context.

**Why it fails:**
- A number in isolation is almost meaningless. Is 1,240 good? Up or down? Compared to what?
- Forces the user to remember previous values or navigate elsewhere to understand performance.
- Wastes the primary real estate of a dashboard — the place where decisions should be easiest.

**The fix:**
- Replace or supplement static KPIs with **mini sparkline charts** or trend indicators showing the last 7–30 days.
- Add delta labels: "+12% vs last week" next to the number.
- Even a simple up/down arrow with a percentage adds more signal than the raw number alone.
- Keep the chart minimal — it's a glance, not a report. No axes, no labels, just the shape of the trend.

---

### 1.15 Sparse Forms and Space-Inefficient Layouts

**What it is:** Input forms that spread a handful of fields across huge amounts of vertical space, or conversely, cramming too many items into a card without hierarchy. Both stem from AI not reasoning about available screen real estate.

**Why it fails:**
- Sparse forms make simple tasks feel heavier than they are (scrolling to fill in 3 fields).
- Overly dense cards make it impossible to scan quickly.
- Neither reflects a decision about how the user actually moves through the task.

**The fix:**
- For complex input tasks (creating a record, configuring something), use a **centered modal** — it focuses attention, contains the task, and provides room for advanced options without disrupting the underlying page.
- For simpler tasks, use inline editing or a compact slide-over panel.
- On list/card items: move secondary actions (edit, delete, archive) into a **"⋯" overflow menu** rather than always showing them. Reduces visual noise while keeping actions accessible.
- Replace text-heavy status chips with **icons + tooltip** where the meaning is inferable from context.

---

### 1.16 Confusing Pricing / Billing Pages

**What it is:** Pricing pages with too many tiers, unclear hierarchy between plans, and "placeholder" cards that AI generates to fill space but provide no decision-useful information.

**Why it fails:**
- Too many options cause decision paralysis — users leave instead of choosing.
- When all plans look visually equal, users have no anchor for what's "right" for them.
- Placeholder/generic benefit bullets ("Unlimited everything", "Priority support") don't help users understand actual value.

**The fix:**
- Reduce to 2–3 tiers maximum. Most users only need: free/starter, main paid, enterprise/custom.
- Visually **emphasize one plan** (recommended/popular badge, highlighted card, larger treatment).
- Lead with **price prominence** — the monthly cost should be the biggest number on the card.
- Make upgrade value concrete: "Next tier includes 50k more API calls/month" not "More usage."
- Show the discount explicitly: "Save $48/year" not just "annual billing available."
- For usage pages: use a **two-column layout** with donut/progress charts per resource — lets users immediately see how close they are to limits.

---

### 1.17 Generic AI-Generated Landing Pages

**What it is:** Landing pages built entirely from AI defaults — stock hero sections, generic feature lists, placeholder testimonials — that fail to establish trust or communicate what actually makes the product unique.

**Why it fails:**
- Visitors make credibility judgments in under 3 seconds. A generic page signals a generic product.
- AI-generated landing pages look interchangeable because they are — they're all drawing from the same template distribution.
- No real product UI or unique visual = no reason to believe the product is real or worth trying.

**The fix:**
- Focus on **presentation quality over complexity**. A simple page that shows the real product well beats an elaborate page showing nothing real.
- Use **skewed/angled product screenshots** or stylized representations of the app's actual unique features (maps, charts, outputs) as hero visuals — this is more credible than any illustration.
- Show one specific, true thing the product does better than alternatives. Make that the headline.
- Remove placeholder social proof. Zero testimonials is more credible than fake-looking ones.
- Invest in **one high-quality visual** rather than five mediocre ones.

---

### 1.18 The "Bootstrap Template" Hero Layout

**What it is:** AI defaults to the same rigid hero structure on nearly every site: logo top-left, two blue buttons side by side, a generic product screenshot floating on the right. The layout is so statistically common in training data that it becomes the AI's first instinct every time.

**Why it fails:**
- Users have seen this exact layout hundreds of times — it signals "default template" before they read a word.
- Two same-weight buttons next to each other immediately creates a visual hierarchy problem — the user doesn't know which one matters.
- A generic screenshot with no context, annotation, or focal point communicates nothing about what the product actually does.
- Your layout is part of your brand. A cloned layout means no brand.

**The fix:**
- Before accepting any AI-generated layout, ask: "Could this hero belong to a different product?" If yes, redesign it.
- Break at least one structural convention intentionally: offset the screenshot, use an asymmetric split, put the headline in an unexpected position, or lead with a demo instead of a static image.
- Two buttons in the hero = one too many. One primary CTA. The secondary link (docs, GitHub, etc.) goes in the nav — not competing in the hero.
- If using a product screenshot, give it context: annotate it, show a specific meaningful state, frame it as the output of a specific action.

---

### 1.19 CTA Clutter — Too Many Competing Actions

**What it is:** Hero sections (and pages generally) that present 5–7 buttons all at equal visual weight, competing for the user's attention simultaneously. Common AI-generated offenders: "Join Discord", "GitHub", "Product Hunt", "Documentation", "Sign Up", "Start Free" — all present, all styled similarly, all in the same viewport.

**Why it fails:**
- When everything is a priority, nothing is a priority. The user's brain stalls.
- Multiple equal-weight CTAs signal indecision on the product's part — it doesn't know what it wants the user to do.
- Users presented with too many choices are statistically more likely to choose none (Hick's Law: decision time increases with the number of options).
- Community/social links (Discord, GitHub, Product Hunt) serve the builder's vanity, not the user's needs — they dilute the conversion path.

**The fix:**
- **One primary CTA per scroll height of the page.** For every ~100vh of content, there should be one dominant action.
- Strict hierarchy: one **primary button** (filled, high contrast), optionally one **secondary action** (ghost/outline or text link) — never two primary buttons side by side.
- Discord, GitHub, Product Hunt links belong in the footer or nav — not the hero. They are not calls to action; they are social signals.
- If you genuinely need multiple actions (e.g., "Sign Up" and "Watch Demo"), make the hierarchy visually unambiguous: one is a button, one is a text link with an arrow.

---

### 1.20 Unprompted Auto-Movement

**What it is:** Background elements, decorative lines, cards, or UI components that animate continuously and autonomously — moving, pulsing, rotating, or scrolling — while the user is stationary and trying to read.

**Why it fails:**
- Motion is the strongest attentional signal in the visual field — it's hardwired from millions of years of evolution detecting predators. Continuous background motion competes directly with the text the user is trying to process.
- The rule is simple: **if the user isn't moving, the UI shouldn't be moving.** Motion should be a response to interaction, not ambient decoration.
- Auto-moving elements become visual noise within seconds but the cognitive cost of filtering them out is continuous.
- Frequently causes `prefers-reduced-motion` violations, affecting users with vestibular disorders who can experience physical discomfort from constant motion.

**The fix:**
- Audit every animation on the page: if it plays without any user input, it needs a clear justification or it gets removed.
- Acceptable ambient motion: a very subtle, slow parallax on scroll (user-driven), or a single looping animation that is the product's core value demonstration.
- Unacceptable ambient motion: background gradient shifts, orbiting icons, bouncing elements, auto-scrolling marquees, pulsing cards, animated grid lines.
- If you want something to feel "alive," use microinteractions triggered by hover or scroll — not autonomous loops.

---

## PART 2 — QUICK-REFERENCE RED FLAG CHECKLIST

Before shipping any AI-assisted design, audit against this list. Each item is a fail if present without a clear intentional reason.

**Color & Visual**
- [ ] Purple gradient is the primary theme
- [ ] AI-selected colors are overly bright / clashing (not reviewed against software color theory)
- [ ] Dashboard mockup uses Google's red/yellow/green/blue palette
- [ ] Mixed icon libraries on the same page
- [ ] System emojis in primary visual positions

**Layout & Information Architecture**
- [ ] Hero layout is logo top-left + two blue buttons + screenshot right (Bootstrap clone)
- [ ] Every feature section uses 3×2 bento grid
- [ ] Every section has identical visual treatment / spacing
- [ ] Sidebar contains more than 6 primary nav items (settings/billing/account not consolidated)
- [ ] Critical information is only accessible via hover
- [ ] Forms spread across excessive vertical space instead of using modals
- [ ] List/card items show all secondary actions inline instead of behind a ⋯ menu

**CTAs & Conversion**
- [ ] More than one primary CTA competing at equal visual weight in the hero
- [ ] Social/community links (Discord, GitHub, Product Hunt) in the hero section
- [ ] More than one dominant CTA per scroll height of the page
- [ ] No interactive or constrained demo available without sign-up

**Data & Dashboard**
- [ ] KPI cards show a single number with no trend, delta, or sparkline
- [ ] Usage stats use placeholder cards with no visual progress indicators
- [ ] Pricing page has 4+ tiers with no clear recommended/emphasized option
- [ ] Pricing benefits are generic ("unlimited everything") with no concrete values

**Motion & Interaction**
- [ ] Fade-in on scroll applied globally to all sections
- [ ] Any scroll jacking / scroll locking present
- [ ] Decorative animations with no communicative purpose (meteors, floating blobs, etc.)
- [ ] Animated SVG path lines tracing scroll
- [ ] Background elements moving autonomously while user is stationary
- [ ] Hover states that hide or diminish the hovered element
- [ ] Directional arrows that move the wrong direction on hover

**Loading & Feedback States**
- [ ] AI operations show only a generic spinner or "Thinking..." with no progress detail
- [ ] No timeout state or retry option for long-running operations
- [ ] Async operations have no loading, success, or error state designed

**Typography**
- [ ] 4+ visual treatments in a single headline
- [ ] No clear hierarchy between display, heading, body, and caption

**Landing Page & Messaging**
- [ ] Hero headline could describe any product in the category
- [ ] Sub-headline is abstract or vague (doesn't literally explain what the product does)
- [ ] Hero opens with "stop doing X" or other negative framing
- [ ] Copy uses internal jargon or invented concepts the target user doesn't recognize
- [ ] Landing page doesn't answer: What is this? Is it for me? Does it work? Is it credible?
- [ ] No real product UI shown — only illustrations or abstract graphics
- [ ] Placeholder testimonials or zero social proof treatment
- [ ] Hero section is generic enough to describe any product in the category

**Microcopy**
- [ ] CTA buttons say "Get Started", "Learn More", or "Submit"
- [ ] Form placeholders used as the only label (no persistent `<label>`)
- [ ] Error messages don't explain what failed or what to do next

**Accessibility**
- [ ] Text contrast below 4.5:1 for body text or 3:1 for large text/UI elements
- [ ] Any `outline: none` without a visible replacement focus style
- [ ] Interactive elements built with `<div>` instead of `<button>` or `<a>`
- [ ] Images missing `alt` attributes
- [ ] Form inputs missing persistent `<label>` elements
- [ ] Touch targets smaller than 44×44px

**Mobile**
- [ ] Layout built desktop-first with no mobile consideration
- [ ] Navigation has no mobile-adapted version
- [ ] Images missing `width`/`height` attributes (causes CLS)
- [ ] Images not compressed or using modern formats (WebP/AVIF)
- [ ] Hover-only interactions with no touch equivalent

**Empty / Error / Edge States**
- [ ] Empty state (no data) shows a blank screen or broken layout
- [ ] Error messages say "Something went wrong" with no recovery path
- [ ] No loading state for async operations
- [ ] No confirmation for destructive actions (delete, disconnect)
- [ ] Long strings overflow their containers

**Trust & Credibility**
- [ ] Copyright year is hardcoded and stale
- [ ] Lorem ipsum or placeholder text in production
- [ ] Testimonials have no names, photos, or company affiliations
- [ ] No privacy policy or terms of service
- [ ] No real contact information

**Design System**
- [ ] Colors hardcoded instead of using CSS custom properties/tokens
- [ ] Same component rebuilt differently across multiple pages
- [ ] Spacing values don't follow a consistent scale (multiples of 4)

**Performance & Technical**
- [ ] PageSpeed / Lighthouse mobile score below 70
- [ ] Browser tab title is "React App", "Document", or "Vite + React"
- [ ] Missing or default favicon
- [ ] No `og:image` set for social sharing
- [ ] Console errors present in production
- [ ] No 404 page designed

---

## PART 3 — THE DESIGN INTENT TEST

Before adding any visual element, animation, or interactive behavior, answer these questions:

1. **What does this communicate?** If you can't articulate it, remove it.
2. **What would a user feel or understand without it?** If the answer is "the same thing," remove it.
3. **Does this work on mobile?** If it relies on hover, reconsider.
4. **Is this here because it's the default, or because I chose it?** Defaults need to be replaced, not accepted.
5. **Would this be on a site I'd screenshot and share?** If no, it needs work.

---

## PART 4 — FOUNDATIONAL UI/UX PRINCIPLES

These are the underlying concepts that, when missing, explain *why* most AI slop fails. Apply these proactively, not as a checklist after the fact.

---

### 4.1 Affordances and Signifiers

UI elements must communicate their function without written instructions. Users should never have to guess what something does.

**Containers:** Use borders or background fills to group related items. Anything left outside a container signals it belongs to a different group. Grouping communicates relationship before the user reads a single word.

**States:** Every interactive element needs visual states:
- **Default** — resting state
- **Hover** — signals interactivity
- **Pressed/Active** — confirms the action is happening
- **Disabled** — grayed out, not clickable; must look visually inert, not just slightly muted
- **Selected/On** — highlighted, clearly distinct from default

**Rule:** If a user has to click something to find out whether it's clickable, you've already failed.

---

### 4.2 Visual Hierarchy

Guide the eye to the most important information first. Three levers: **size**, **position**, and **color**. Use them deliberately.

- **Size + weight:** The most critical item (product name, page title, key number) should be the largest and boldest element in its region.
- **Color + contrast:** Reserve bright/saturated color for one thing per view — the most important action or piece of data. If everything is colorful, nothing is emphasized.
- **Position:** Top-left gets read first (F-pattern). Hero content, primary CTAs, and key labels belong at the top or left before supporting detail.
- **Images:** Use real visuals wherever possible — photos, screenshots, charts. Images are scanned before text and dramatically increase information absorption speed.

**Rule:** You should be able to squint at any screen and immediately identify the single most important element. If you can't, the hierarchy is broken.

---

### 4.3 Spacing: The 4pt Grid System

Use multiples of 4 (or 8) for all spacing and sizing values: `4, 8, 12, 16, 24, 32, 48, 64, 96...`

**Why it works:**
- Creates mathematical consistency throughout the UI.
- Any element can be halved or doubled cleanly.
- Eliminates arbitrary spacing (13px, 22px, 37px) that makes designs feel unresolved.

**Whitespace:** Don't fill every gap. Empty space is not wasted space — it creates visual grouping, reduces cognitive load, and makes the important elements stand out. Crowded layouts signal low confidence in the content.

**Grids:** A 12-column grid is a useful *guideline*, not a law. Use it for structured content (galleries, data tables, card grids) where responsiveness across breakpoints matters. For editorial or feature layouts, break it intentionally.

---

### 4.4 Typography Discipline

**Font count:** One well-chosen sans-serif handles 90% of software UI. DM Sans, Inter, and SF Pro are reliable defaults. Add a second font only if it serves a specific purpose (e.g., a serif for editorial emphasis).

**The "professional header" technique:**
- Letter spacing: `-2%` to `-3%` on large display text
- Line height: `110%`–`120%` on headings (not `150%` which is for body text)
- These two changes alone make AI-generated headers look significantly more intentional.

**Font size by context:**
- Landing pages: wide range acceptable (12px caption → 80px+ hero). Contrast is the point.
- Dashboards: keep body and label text under 24px to maintain information density. Data UIs need to show more, not impress with scale.

**Never:** mix more than 2 font families, use default browser font sizes without a defined scale, or treat line-height and letter-spacing as afterthoughts.

---

### 4.5 Semantic Color Usage

Colors carry meaning. Assign meaning intentionally and use it consistently:

| Color | Meaning |
|---|---|
| Blue | Trust, primary action, links |
| Green | Success, confirmation, "new" |
| Red | Error, danger, destructive action |
| Yellow/Amber | Warning, caution |
| Gray | Inactive, disabled, secondary |

**Brand color ramp:** Don't use your brand color at full saturation for everything. Build a ramp:
- Lighten for backgrounds and tinted surfaces
- Full saturation for interactive elements and accents
- Darken for text on light backgrounds

This creates visual cohesion without overwhelming the UI with your brand hue.

**Rule:** Every color in the UI should be answerable with "this color means ___." If it's decorative with no meaning, it's visual noise.

---

### 4.6 Depth and Shadows

**Light mode:**
- Use soft, diffused shadows with low opacity (`box-shadow: 0 2px 8px rgba(0,0,0,0.08)`)
- If the shadow is the first thing a user notices on a card, it's too strong
- Shadows should imply elevation, not decoration

**Dark mode:**
- Shadows become invisible on dark backgrounds — they lose contrast
- Create depth through **lightness stepping**: the higher an element sits, the lighter its background
  - Page background: `#111`
  - Card surface: `#1a1a1a`
  - Popover/modal: `#222`
  - Tooltip: `#2a2a2a`
- Never use the same background color for nested elements in dark mode

---

### 4.7 Interaction Feedback

Every user action must receive a visible response. Silence from the UI after an action breaks trust.

**Required button states (non-negotiable):**
- Default, Hover, Pressed, Disabled, Loading (for async actions)

**Micro-interactions:** Small animations that confirm an action completed. Examples:
- "Copied!" with a checkmark sliding up after clicking a copy button
- A checkmark replacing a save icon after successful save
- A progress bar filling during upload

These should be: fast (150–300ms), subtle, and purposeful. They reduce support burden by eliminating "did that work?" uncertainty.

**Rule:** If an async action (save, submit, delete) has no loading state and no success/error confirmation, the UI is incomplete regardless of whether the backend works.

---

### 4.8 Text Over Images

Never place white text directly over a busy or variable background image — contrast will break on some photos and the text becomes unreadable.

**Solutions (in order of subtlety):**
1. **Linear gradient overlay:** `linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)` — dark at the bottom where text sits, transparent at the top where the image shows
2. **Progressive blur:** Blur the image region behind text using `backdrop-filter: blur()` or a blurred duplicate layer
3. **Solid scrim:** A semi-transparent solid fill behind the text block — less elegant but always reliable
4. **Choose images with intentional negative space** for text placement

**Never:** use `text-shadow` alone to solve contrast problems. It patches the symptom without fixing the underlying composition issue.

---

## PART 5 — ACCESSIBILITY

AI almost universally ignores accessibility. This is both an ethical failure and a legal risk — accessibility lawsuits increased 37% YoY in 2025, and over 94% of the top 1M websites still fail basic accessibility checks. Every item in this section is something AI gets wrong by default.

---

### 5.1 Color Contrast Failures

**What it is:** Text that doesn't have sufficient contrast against its background — common in AI-generated muted color schemes, gray-on-gray secondary text, and light text on gradient backgrounds.

**Why it fails:**
- Fails WCAG 2.1 AA requirements (4.5:1 for body text, 3:1 for large text ≥18pt)
- Unreadable for users with low vision or in bright sunlight
- Fails legally in many jurisdictions under ADA and European Accessibility Act (fully enforced 2025)
- AI routinely generates `#999` text on `#fff` (contrast: 2.85:1 — a hard fail)

**The fix:**
- Test every text/background combination with a contrast checker (WebAIM, Polypane, or browser devtools)
- Minimum ratios: **4.5:1** for body text, **3:1** for large text (≥24px normal or ≥18.6px bold), **3:1** for UI components and icons
- Never use color as the *only* way to convey information (e.g., red = error) — always pair with an icon or label
- Common AI failures to audit: placeholder text, disabled states, secondary/muted labels, text on gradient backgrounds, white text on colored buttons

---

### 5.2 Missing or Broken Focus States

**What it is:** AI routinely generates `outline: none` on interactive elements — or simply never styles `:focus` at all — making keyboard navigation invisible.

**Why it fails:**
- Keyboard-only users (mobility impairments, power users) have no way to see where they are on the page
- Screen readers rely on logical focus order to navigate
- Fails WCAG 2.1 Success Criterion 2.4.7 (Focus Visible)
- Makes the entire app unusable for a significant portion of users

**The fix:**
```css
/* Never do this without a replacement: */
/* :focus { outline: none; } */

/* DO: Custom visible focus that matches brand */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 4px;
}

/* Use :focus-visible not :focus — avoids showing outlines on mouse clicks */
```
- Focus order must follow logical reading order (don't use `tabindex` values > 0)
- Focus must be visible on every interactive element: buttons, links, inputs, selects, custom components
- Test by pressing Tab through the entire page — the focus ring must never disappear

---

### 5.3 Div Soup — Missing Semantic HTML

**What it is:** AI builds interfaces almost entirely out of `<div>` and `<span>` elements, ignoring the semantic HTML elements that convey meaning to browsers and assistive technology.

**Why it fails:**
- Screen readers use landmark elements (`<nav>`, `<main>`, `<header>`, `<footer>`) to let users jump between sections
- A `<div onClick>` is not a button — it has no keyboard support, no role, no accessible name
- Search engines use semantic structure for indexing — `<h1>` through `<h6>` hierarchy matters for SEO
- Breaks browser built-ins: form submission, keyboard shortcuts, right-click context menus on links

**The fix:**

| AI default | Use instead |
|---|---|
| `<div onClick>` | `<button>` |
| `<div onClick>` (navigation) | `<a href="">` |
| `<div class="nav">` | `<nav>` |
| `<div class="header">` | `<header>` |
| `<div class="main">` | `<main>` |
| `<div class="footer">` | `<footer>` |
| `<div class="article">` | `<article>` |
| Custom dropdown | `<select>` or ARIA combobox pattern |
| Custom checkbox/radio | Native `<input type="checkbox/radio">` with styled label |

- Heading hierarchy: one `<h1>` per page, `<h2>` for sections, `<h3>` for subsections — never skip levels
- Every image needs meaningful `alt` text; decorative images need `alt=""`
- Every form input needs a `<label>` — never use placeholder text as the only label

---

### 5.4 Touch Target Size Failures

**What it is:** Interactive elements that are too small to tap reliably on mobile — icon-only buttons, inline text links, and tight navigation items that AI generates at desktop-comfortable sizes.

**Why it fails:**
- Apple HIG requires minimum 44×44pt; Material Design requires 48×48dp
- Small targets cause mis-taps, especially for users with motor impairments or large fingers
- Navigation issues cause 30–40% of mobile usability problems
- Makes the interface feel physically frustrating to use

**The fix:**
- Minimum touch target: **44×44px** on all tappable elements
- If the visual element is smaller (e.g., a 16px icon), use padding to expand the hit area without changing appearance:
```css
.icon-button {
  padding: 12px; /* expands tap area to 40px+ around the icon */
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```
- Space between touch targets: at least 8px to prevent accidental activation
- Test all interactive elements on an actual phone, not just browser devtools

---

## PART 6 — MOBILE-FIRST DESIGN

Over 58% of global web traffic is mobile. AI tools design for desktop first (sometimes exclusively), then either ignore mobile entirely or apply a broken afterthought. Mobile-first means designing the constrained version first, then expanding — not squishing a desktop layout into a phone.

---

### 6.1 Desktop-Only Thinking

**What it is:** Building layouts, interactions, and navigation patterns that only work with a mouse and large screen — with no consideration for how they behave on a 390px wide touchscreen.

**Why it fails:**
- The majority of your users are on mobile
- Google uses mobile-first indexing — your mobile experience determines your search ranking
- Hover-only interactions are inaccessible on touch devices (see 1.7)
- Fixed-pixel layouts overflow or produce horizontal scrolling on small screens

**The fix:**
- Write CSS mobile-first: base styles target small screens, `min-width` media queries layer in desktop enhancements
```css
/* Mobile first */
.container { padding: 1rem; }
.grid { grid-template-columns: 1fr; }

/* Desktop enhancement */
@media (min-width: 768px) {
  .container { padding: 2rem 4rem; }
  .grid { grid-template-columns: repeat(3, 1fr); }
}
```
- Use `clamp()` for fluid typography and spacing that adapts without breakpoints
- Replace sidebar navigation with bottom navigation bar or hamburger menu on mobile
- Test every screen at 390px width before considering it done

---

### 6.2 Navigation That Doesn't Adapt

**What it is:** Desktop sidebars and horizontal nav bars that either overflow, collapse badly, or disappear entirely on mobile — leaving users with no way to navigate.

**Why it fails:**
- Users who can't navigate leave immediately
- A broken nav on mobile means your entire app is effectively broken for mobile users
- AI generates desktop navs without a mobile equivalent

**The fix:**
- **App-like products:** Switch to a bottom navigation bar on mobile (max 5 items, icon + label)
- **Marketing sites:** Collapse to a hamburger menu that opens a full-screen or slide-in overlay
- Navigation overlay must: trap focus when open, close on Escape key, return focus to trigger on close
- Active state must be unambiguous on both desktop and mobile versions
- Never hide the primary navigation behind a hover on desktop if it has no mobile equivalent

---

### 6.3 Unoptimized Images

**What it is:** AI ships images as whatever format was easiest — typically large PNGs or uncompressed JPEGs — with no resizing, compression, or modern format usage.

**Why it fails:**
- A single hero image at 3MB adds 3+ seconds to load time on mobile networks
- When mobile pages take over 4 seconds to load, 63% of users leave; at 6 seconds, 66% are gone
- Unoptimized images are the single most common cause of poor Core Web Vitals scores
- Images without explicit `width` and `height` attributes cause Cumulative Layout Shift (CLS) — the page visibly jumps as images load, which is disorienting and a Google ranking penalty

**The fix:**
- **Format:** Use WebP or AVIF for all images. AVIF is ~50% smaller than JPEG at equivalent quality
- **Size:** Never serve a 2400px image in a 400px container. Generate multiple sizes and use `srcset`
- **Lazy load:** `loading="lazy"` on all below-the-fold images
- **Explicit dimensions:** Always set `width` and `height` attributes to prevent CLS
- **Hero images:** Preload with `<link rel="preload">` — the LCP image should never be lazy loaded
```html
<img
  src="hero.webp"
  width="1200"
  height="600"
  alt="Product dashboard showing analytics"
  fetchpriority="high"
/>

<img
  src="feature.webp"
  width="600"
  height="400"
  alt="Feature illustration"
  loading="lazy"
/>
```

---

## PART 7 — EMPTY STATES, ERROR STATES & EDGE CASES

AI generates the "happy path" — what the app looks like with perfect, populated data. It almost never generates what happens at the edges. These are where products feel unfinished and users get lost.

---

### 7.1 Missing Empty States

**What it is:** When a user first signs up, or when a list/table/dashboard has no data yet, AI-generated apps show either a blank white space, a broken layout, or (worst) an error.

**Why it fails:**
- New users' first experience of your product is an empty app — this is the most critical moment for retention
- A blank screen gives no guidance on what to do next
- Users assume the product is broken rather than empty
- Missed opportunity: empty states are high-visibility brand moments

**The fix:**
- Every list, table, feed, and dashboard needs a designed empty state
- Empty state formula: **illustration or icon + explanation + primary action**
  - "You haven't created any projects yet. [Create your first project →]"
  - Not: just a blank card grid
- Tone should match the product: friendly for consumer apps, efficient for B2B tools
- Consider "zero-data" onboarding: populate the app with sample/demo data so new users see what it looks like filled

---

### 7.2 Missing Error States

**What it is:** Forms, API calls, and data operations that either silently fail, show generic "Something went wrong" messages, or crash without any user-facing recovery path.

**Why it fails:**
- Users don't know what failed or what to do next
- "Something went wrong" is not an error message — it's an admission of no thought
- Silent failures (success UI that never actually saved) destroy trust
- Generic errors cause support tickets for problems users could self-resolve

**The fix:**
- Every error message must answer three questions: **what happened, why, and what to do now**
  - Bad: "Error 422"
  - Bad: "Something went wrong"
  - Good: "Your email is already registered. [Sign in instead →] or [Reset password →]"
- Form validation: inline, field-level errors that appear on blur (not just on submit)
- Network errors: show a retry mechanism, never just a spinner that hangs forever
- Destructive actions (delete, disconnect): require confirmation with explicit consequence stated — "Delete project — this cannot be undone"
- Always design: default state, loading state, success state, error state. All four, every time.

---

### 7.3 Overflow and Long Content

**What it is:** AI designs with perfectly controlled fake data — a 12-character username, a 3-word product name, a 2-line description. Real users break this immediately.

**Why it fails:**
- A 60-character name overflows its container and breaks the layout
- A URL with no spaces causes horizontal overflow
- A table with 50 rows that was designed for 5 looks broken
- Truncated text with no tooltip means users can't see the full value

**The fix:**
- Use `text-overflow: ellipsis` with `overflow: hidden` and `white-space: nowrap` for single-line truncation — but always pair with a `title` attribute or tooltip showing the full text
- For multi-line truncation: `-webkit-line-clamp` with a "show more" toggle
- Test every text container with: a 3-character value, a 100-character value, a URL with no spaces
- Tables: define what happens at 10 rows vs 1000 rows — pagination or virtual scrolling
- Images: `object-fit: cover` prevents broken aspect ratios when image dimensions vary
```css
/* Prevent layout breaks from long strings */
.user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* Prevent horizontal overflow from URLs/code */
.content {
  overflow-wrap: break-word;
  word-break: break-word;
}
```

---

### 7.4 Fake Loading Spinners & Opaque AI Progress

**What it is:** When an AI feature takes time to process, the default implementation shows either a generic spinner, a looping "Thinking..." message, or no feedback at all. The user stares at an empty interface with no indication of what's happening, whether it's working, or how long it will take.

**Why it fails:**
- A generic spinner gives users no information — they can't tell if the system is working, stuck, or broken
- "Thinking..." looping indefinitely becomes anxiety-inducing after about 5 seconds
- Without feedback, users refresh the page, click again, or abandon — all of which cause real problems
- It creates a perceived disconnect between user action and system response — the interaction feels disjointed
- Users who can see progress feel in control; users who can't feel helpless

**The fix:**
- Show the **actual steps being executed**, not just a spinner. AI tool calls, retrieval steps, and processing stages are all real events — surface them:
  - "Analyzing your codebase..."
  - "Searching documentation..."
  - "Generating response..."
- Use a **progress stream**: update a status line in real-time as each step completes, with a checkmark when done
- Provide **time anchoring**: if you know the operation takes 10–30 seconds, say so. "This usually takes about 15 seconds" dramatically reduces abandonment
- Show partial results as they arrive (streaming output) rather than holding everything until complete
- If the operation can genuinely fail, show a timeout state with a retry option — never let the spinner run forever
- The goal: the user should always know the answer to "is this working?"

---

## PART 8 — MICROCOPY & CONTENT

AI generates placeholder-sounding copy that ships untouched. Words are interface. Bad copy undermines good design; good copy makes a mediocre design functional. This is one of the cheapest and highest-impact areas to improve.

---

### 8.1 Generic Hero Headlines

**What it is:** Landing page headlines that could describe any product in the category. Examples AI generates constantly:
- "The future of [X] is here"
- "Supercharge your workflow"
- "The all-in-one platform for teams"
- "Build faster, ship smarter"

**Why it fails:**
- Tells visitors nothing specific about what the product does
- Impossible to remember or repeat
- Looks like every other AI-generated landing page
- Users make credibility judgments in under 3 seconds — a generic headline fails that test

**The fix:**
- The headline should complete this sentence: "This product helps [specific person] do [specific thing] so they can [specific outcome]"
- Specificity is credibility: "Cut your AWS bill by 40% without changing infrastructure" > "Save money on cloud"
- If a competitor could use the same headline, rewrite it
- Formula: [what it does] + [for whom] + [key differentiator]

---

### 8.2 Meaningless CTA Copy

**What it is:** Buttons and calls-to-action that use default AI-generated labels: "Get Started", "Learn More", "Click Here", "Submit", "Continue".

**Why it fails:**
- Tells the user nothing about what happens when they click
- "Get Started" on every button creates no distinction between primary and secondary actions
- "Submit" on a form has been shown in A/B tests to underperform specific alternatives by 10–30%
- Creates anxiety: users don't know what they're committing to

**The fix:**
- CTA copy formula: **verb + outcome** — what will happen when they click
  - "Get Started" → "Start my free trial"
  - "Learn More" → "See how it works" or "Watch the demo"
  - "Submit" → "Create my account" / "Send message" / "Book a call"
  - "Continue" → "Continue to payment" / "Continue to review"
- Reduce friction on scary actions: "Delete" → "Delete forever" (honest) or add friction copy below: "You can undo this for 30 days"
- The primary CTA should be the most specific, action-oriented text on the page

---

### 8.3 Useless Placeholder and Label Text

**What it is:** Form labels that just restate the field name, placeholder text used as the only label, and tooltip text that adds no information.

**Why it fails:**
- Placeholder text disappears when users start typing — they lose context mid-form
- "Enter your email" as placeholder, with no label, is both an accessibility failure and UX failure
- Tooltips that say "Name" on a field already labeled "Name" are invisible noise

**The fix:**
- Every input needs a persistent `<label>` above it — not just placeholder
- Placeholder text should show an example, not a restatement: `placeholder="e.g. john@company.com"`
- Helper text below the field (always visible) for format requirements: "Must be at least 8 characters, including a number"
- Error messages are specific: "Password must include at least one number" not "Invalid password"
- Tooltips add information not visible in the label: a "?" on a billing field should explain what it's used for, not just restate "Billing Address"

---

### 8.4 The Literal Sub-headline Rule

**What it is:** When a hero headline uses a "clever" or abstract marketing phrase, the sub-headline beneath it is equally vague or abstract — leaving the user with no clear understanding of what the product actually does.

**Why it fails:**
- Abstract headlines can create intrigue but they trade clarity for style. If the sub-headline doesn't immediately cash out the meaning, the user has to work to understand the product — and they won't
- Most visitors will read headline → sub-headline → CTA and then decide whether to stay. If sub-headline doesn't explain the product, they leave
- "Clever" + "vague" is the worst combination. It signals effort was spent on sounding good instead of communicating value

**The fix:**
- **Pair every abstract headline with a brutally literal sub-headline.** The sub-headline's only job is to answer: "Okay but what does it actually do?"
  - Headline: "Your codebase, finally understood."
  - Sub-headline: "Paste any GitHub repo and get an interactive map of every function, dependency, and data flow — in under 30 seconds."
- The sub-headline should contain: what the product is, who it's for, and what the key output is
- If someone reads only the sub-headline and immediately understands the product, it's written correctly
- Rule of thumb: the sub-headline should be something a user could quote to a colleague to explain what the product does

---

### 8.5 Starting With Negatives

**What it is:** Hero sections that open by telling the user what *not* to do, what to *stop* doing, or framing the problem using negative commands — instead of leading with what the product does and enables.

**Why it fails:**
- "Stop doing X" tells the user nothing about the product — it's all about the problem, nothing about the solution
- Starting with negatives creates an adversarial, lecture-y tone before you've earned any goodwill
- Users don't arrive at your site looking for criticism of their current behavior; they arrive looking for solutions
- It wastes the most valuable real estate on the page (the first line the user reads) on framing rather than value

**The fix:**
- Lead with what users **gain**, not what they should stop doing
  - Bad: "Stop following tutorials designed for beginners"
  - Good: "Ship production-grade code on day one — no tutorials, no boilerplate"
- If you want to acknowledge the problem, do it in the *body* of the hero (sub-headline or supporting copy), after the headline has already delivered the value proposition
- A simple test: remove the headline and ask whether the user knows more or less about the product. If removing it changes nothing, rewrite it

---

### 8.6 Internal Jargon and Made-Up Concepts

**What it is:** Using technical terminology, invented product concepts, or industry-insider language that the target user doesn't actually use when describing their own problem. Common AI-generated examples: "progressive discovery," "modern MCP infra," "agentic workflows," "context-aware orchestration."

**Why it fails:**
- If users don't recognize the words you use to describe their problem, they don't believe you understand their problem
- Jargon creates distance — it signals "this product is for someone more technical than you"
- Invented concepts require users to learn your internal vocabulary before they can evaluate your product — most won't bother
- AI generates jargon fluently because it's trained on technical writing, but fluency is not the same as clarity

**The fix:**
- Write copy using the **exact words your target users use** when describing the problem to a colleague — not the words you use internally
- Conduct a simple test: show the headline to someone in your target audience. If they need anything explained, rewrite it using their words
- The "Old World vs. New World" frame: describe the painful before state in the user's language, then describe the better after state — using the same vocabulary throughout
  - Old World: "I spend 3 hours every Monday copying numbers from Stripe into a Google Sheet"
  - New World: "Every Monday morning, your revenue report is already in your inbox"
- Avoid inventing category names for your product unless you have the budget to define them. Use existing categories with a differentiator instead

---

### 8.7 Speak the User's Language — Old World vs. New World

**What it is:** A specific copywriting technique for describing product value. The "Old World" is the painful status quo described in the user's own words. The "New World" is the improved state your product enables — also described in the user's own words. AI-generated copy skips both and jumps straight to feature descriptions.

**Why it works:**
- People don't buy features; they buy relief from a specific frustration. Naming the frustration in their words makes them feel understood
- Contrast creates desire — showing the "before" makes the "after" feel more valuable
- Using the user's own language (not yours) signals that you've actually listened to customers, which builds trust

**How to execute it:**
- Identify the single most common complaint your target user has about their current situation (from user interviews, Reddit, support tickets, reviews of competitors)
- State that complaint as the "Old World" — use their exact phrasing, not a polished version
- Immediately follow with the "New World" — what life looks like after the problem is solved
- Example structure:
  - Old World: "You're drowning in Slack messages, half of which need to become tasks somewhere."
  - New World: "Every action item from every conversation, captured and assigned automatically — before the thread goes cold."
- The product name and features come *after* this contrast, not before

---

## PART 9 — TRUST SIGNALS & CREDIBILITY

Design communicates trustworthiness before users read a word. AI-generated products routinely ship with credibility-destroying details that take minutes to fix but significantly impact conversion and retention.

---

### 9.1 Stale and Placeholder Content

**What it is:** AI forgets to — or never knows to — replace generated content with real values. Common examples:
- Copyright footer still showing the year the template was created (e.g., "© 2024" in 2026)
- "Lorem ipsum" placeholder text in production
- "Your Company Name" or "Acme Corp" in the logo or copy
- Demo email addresses like "user@example.com" visible in the UI

**Why it fails:**
- Signals the product is abandoned or unmaintained — users assume it's not safe to use
- Destroys credibility more than almost any visual mistake
- "© 2024" on a site in 2026 is immediately noticed and immediately damaging

**The fix:**
- Audit every page for placeholder text before shipping — search for "lorem", "example", "placeholder", "TODO", "your company"
- Use dynamic copyright year: `© ${new Date().getFullYear()}` — never hardcode a year
- All demo/mock data in screenshots should use realistic but non-real values

---

### 9.2 Fake or Low-Quality Social Proof

**What it is:** Testimonials with no photos, no names, no company affiliations — or obviously AI-generated review text. Also: "as seen in" logo bars with no real connection to those publications.

**Why it fails:**
- Users have learned to recognize fake testimonials — they're now a trust *negative*, not positive
- "A satisfied customer" with no photo/name/company reads as fabricated
- A logo bar featuring The New York Times when you've never been featured there is fraudulent
- Zero real social proof is more credible than obvious fake social proof

**The fix:**
- Use real testimonials with: full name, photo, job title, company (with permission)
- If you have no testimonials yet: remove the section entirely, or replace with a quantitative claim you can back up ("Used by 400 teams in their first month")
- Logo bars: only include logos you have an actual relationship with
- Video testimonials or case study links are far more credible than text quotes
- Show real user counts, real data, real outcomes — specificity signals truth

---

### 9.3 Missing Legal and Contact Basics

**What it is:** AI-generated sites often ship with no privacy policy, no terms of service, no real contact information, and sometimes no identifiable company behind the product.

**Why it fails:**
- No privacy policy is illegal in most jurisdictions (GDPR, CCPA) if you collect any user data
- Users who are evaluating whether to pay for or trust your product look for these signals
- "Contact us" links that go nowhere, or only a generic contact form with no email, suggest there's no one behind the product
- Investors, enterprise customers, and press all look for these before taking you seriously

**The fix:**
- Ship with: Privacy Policy, Terms of Service, and a real contact method (email or support channel)
- Footer minimum: company name, © year (dynamic), privacy link, terms link, contact
- If you're a solo founder, a real email address is more credible than no contact info
- For SaaS specifically: a status page link and a clear data retention/deletion policy are increasingly expected

---

## PART 10 — DESIGN SYSTEM THINKING

AI generates components one at a time, in isolation. The result is a product where every screen is slightly inconsistent with every other — different border radii on similar cards, different spacing between similar elements, slightly different shades of the same color. This isn't a visual taste problem; it's an architectural one.

---

### 10.1 No Design Token System

**What it is:** Hard-coding visual values throughout the codebase instead of defining them once as variables. AI generates `color: #6366f1` in 40 different places instead of `color: var(--accent)`.

**Why it fails:**
- Changing your brand color requires finding and replacing dozens of hardcoded values
- Minor inconsistencies accumulate: `#6366f1` here, `#6267f1` (a typo) there
- No single source of truth means the design diverges from itself over time
- Makes dark mode, theming, or white-labeling nearly impossible to implement correctly

**The fix:**
- Define all visual values as CSS custom properties at the `:root` level before writing any components:
```css
:root {
  /* Color tokens */
  --color-bg: #0f0f0f;
  --color-surface: #1a1a1a;
  --color-border: rgba(255,255,255,0.08);
  --color-text-primary: #f0f0f0;
  --color-text-secondary: #a0a0a0;
  --color-accent: #6366f1;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  /* Spacing tokens */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* Radius tokens */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Typography tokens */
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```
- Every component references tokens, never raw values
- One change to a token propagates everywhere instantly

---

### 10.2 Inconsistent Component Variants

**What it is:** The same conceptual component (e.g., a button, a card, a badge) gets rebuilt from scratch in slightly different ways across different pages — different padding, different border radius, different hover behavior, different font size.

**Why it fails:**
- Users notice inconsistency subconsciously — the product feels unpolished without them being able to say why
- Inconsistent components signal that no one is in charge of the product's quality
- Makes the codebase harder to maintain — fixing a button means finding all 12 versions of it
- Breaks user mental models: a button that looks slightly different gets treated as a different kind of element

**The fix:**
- Define components *once* with explicit variants, and use them everywhere:
  - Button: `primary | secondary | ghost | danger` — never create a one-off button
  - Badge/chip: `success | warning | error | neutral` — always the same size and radius
  - Card: `default | elevated | bordered` — consistent padding and radius
- When you need something that doesn't fit existing components, either extend the system or create a new explicit variant — never create a one-off
- Audit the product for duplicate components regularly: if you have 3 versions of a card, consolidate to 1 with variants

---

### 10.3 Spacing Inconsistency

**What it is:** Different gaps between similar elements across the product — a list item might have 12px padding on one page, 16px on another, 20px on a third. No consistent rhythm.

**Why it fails:**
- Spacing inconsistency is the most common reason a product "looks a bit off" without users knowing why
- Creates visual noise: the eye expects rhythm and consistency; random spacing breaks that rhythm
- Makes the product look like it was built by multiple people with no coordination (because it was — you and an AI with no memory of previous sessions)

**The fix:**
- Use the 4pt grid exclusively — every margin, padding, and gap must be a multiple of 4
- Apply spacing tokens (from 10.1) so the same conceptual distance always uses the same token
- Same-level items get the same gap: all items in a vertical list get the same `gap`, all section headings get the same `margin-bottom`
- The fastest audit: scan the product looking only at spacing. If your eye catches rhythm breaks, find and fix the outliers

---

## PART 11 — PERFORMANCE & TECHNICAL CREDIBILITY

Visual polish means nothing if the page loads slowly, shifts around while loading, or ships with embarrassing technical oversights. These issues are invisible in Figma and in AI previews — they only emerge in the browser.

---

### 11.1 Core Web Vitals Failures

**What it is:** Google's three core performance metrics that directly affect search ranking and user experience — which AI-generated sites routinely fail:
- **LCP (Largest Contentful Paint):** How fast the main content loads. Target: under 2.5s
- **CLS (Cumulative Layout Shift):** How much the page visually jumps during load. Target: under 0.1
- **INP (Interaction to Next Paint):** How responsive the page is to input. Target: under 200ms

**Why it fails:**
- AI ships unoptimized images, no preloading, and no explicit image dimensions
- LCP failures: hero images not preloaded, render-blocking scripts, unoptimized fonts
- CLS failures: images without width/height, fonts causing FOUT (Flash of Unstyled Text), dynamic content injected above existing content
- INP failures: heavy JavaScript blocking the main thread

**The fix:**
- Always set explicit `width` and `height` on images to prevent CLS
- Preload the hero/LCP image: `<link rel="preload" as="image" href="hero.webp">`
- Load fonts with `font-display: swap` to prevent invisible text during load
- Defer non-critical JavaScript: `<script defer src="analytics.js">`
- Measure with PageSpeed Insights or Lighthouse before shipping — a score under 70 on mobile is a red flag

---

### 11.2 Stale Metadata and Technical Oversights

**What it is:** The unglamorous details AI forgets that signal "no one checked this":
- Hardcoded copyright year that doesn't update
- Default browser tab title ("React App", "Vite + React", "Document")
- Missing or broken favicon
- No `meta description` for SEO
- Missing `og:image` for social sharing (link previews show a blank card)
- Console errors visible in browser devtools

**Why it fails:**
- A tab labeled "React App" signals prototype, not product
- A broken favicon (or the default Vite/React logo) on a paying customer's browser tab is embarrassing
- No `og:image` means every shared link looks blank on Slack, Twitter, WhatsApp — killing organic sharing
- Console errors in production signal incomplete, untested code to any technical evaluator

**The fix:**
- Pre-launch checklist for every project:
  - [ ] `<title>` is product name + page context ("Dashboard — ProductName")
  - [ ] Favicon exists and works at 16px, 32px, and 180px (Apple touch icon)
  - [ ] `<meta name="description">` is written and accurate
  - [ ] `og:title`, `og:description`, `og:image` are set (1200×630px image)
  - [ ] Copyright year uses `new Date().getFullYear()`
  - [ ] Zero console errors in production build
  - [ ] 404 page exists and is designed (not a white browser default)
  - [ ] All external links open in `target="_blank"` with `rel="noopener noreferrer"`

---

## PART 12 — LANDING PAGE STRATEGY

The landing page is not a design problem — it's a communication problem. Most AI-generated landing pages look acceptable but fail completely at their one job: convincing a skeptical stranger that your product is worth their time. This section covers the strategic layer that visual design alone cannot fix.

---

### 12.1 The "Big 4" Questions — Answer These Immediately

**What it is:** Every first-time visitor to your landing page arrives with four unconscious questions. If your page doesn't answer all four within the first scroll, most visitors will leave without converting.

1. **What is this?** — What does the product literally do?
2. **Is it for me?** — Am I the right kind of person/team/company for this?
3. **Does it work?** — Is there evidence it actually does what it claims?
4. **Is it credible?** — Can I trust the people/company behind it?

**Why it fails when ignored:**
- AI generates landing pages that look complete but answer only question 1 (vaguely) and skip 2, 3, and 4 entirely
- Visitors who can't answer "is this for me?" within seconds assume it isn't
- No evidence of it working (demos, case studies, numbers) means users have to take it on faith — most won't
- No credibility signals (real team, real company, real users) triggers modern fraud-detection instincts

**The fix — answer all four in the hero or first scroll:**

| Question | How to answer it |
|---|---|
| What is this? | Literal sub-headline (see 8.4) |
| Is it for me? | Name the audience explicitly: "for solo founders", "for React teams", "for e-commerce stores doing $1M+" |
| Does it work? | An inline demo, a real output screenshot, a specific metric ("saves 4 hours/week") |
| Is it credible? | Real user count, real company names, a named founder, a logo from a recognizable user |

- After the hero, the rest of the page deepens each answer — it doesn't introduce entirely new questions
- Audit your landing page: read only the headline and sub-headline. Can a stranger answer all four? If not, the hero needs work

---

### 12.2 One Primary CTA Per Scroll Height

**What it is:** A structural rule for landing page layout. For every ~100vh of vertical content the user scrolls through, there should be exactly one visually dominant call to action. Not zero, not three — one.

**Why it fails when ignored:**
- Multiple CTAs at equal weight create choice paralysis (see 1.19)
- Zero CTAs in a section means users who are ready to convert have to scroll to find the button — conversion opportunity missed
- Repeating the same CTA identically 5 times down the page is better than having 5 different ones, but still feels repetitive and mechanical

**The fix:**
- Map your page as a vertical sequence of scroll heights. Assign one CTA to each zone:
  - Zone 1 (hero): Primary conversion CTA — "Start free trial" / "Get early access"
  - Zone 2 (features): Secondary engagement CTA — "See how it works" / "Watch the demo"
  - Zone 3 (social proof): Reinforcement CTA — "Join 2,000 teams already using [Product]"
  - Zone 4 (pricing): Conversion CTA again — same as Zone 1
  - Zone 5 (footer): Final CTA — same text as Zone 1
- Each CTA should feel like the natural next step given what the user just read in that section
- Social links (Discord, GitHub, Product Hunt) are not CTAs — they go in the nav or footer, never competing with conversion buttons

---

### 12.3 Constrained Interactive Demos

**What it is:** Instead of offering users an open-ended input box ("Try it yourself — enter anything!"), provide a constrained demo with curated example inputs that guarantee a high-quality, impressive output — visible on the landing page without requiring sign-up.

**Why it fails when absent:**
- Open-ended demos fail unpredictably — a user enters something the model handles poorly and their first impression is a bad output
- "Sign up to try it" gates the demo behind friction at exactly the moment the user is most curious — high drop-off
- A static screenshot of output is better than nothing, but it's passive — interactive demos convert dramatically better
- "Trust me, it works great" is the weakest form of proof. Showing it working is the strongest

**The fix:**
- Offer 3–5 **pre-set example inputs** as buttons or chips: "Try: Summarize earnings call" / "Try: Debug this function" / "Try: Plan a campaign"
- Each preset reliably produces a result you've validated looks impressive — no surprises
- Run the demo inline on the page, not in a new tab or modal
- Show the output immediately — stream it if possible to create a sense of speed and capability
- If sign-up is required for the full product, the constrained demo should be the *teaser* — enough to demonstrate the core value, not enough to replace the full product
- Label it honestly: "Live demo — no sign-up required"

---

## SOURCES & CREDITS

- Y Combinator design review sessions — video 1 (AI slop patterns: gradients, hover effects, scroll jacking, bento grids)
- Y Combinator design review sessions — video 2 (bootstrap templates, CTA clutter, auto-movement, Big 4 questions, constrained demos)
- Kole Jain — "5 UI/UX Mistakes in Vibe-Coded Software" (iconography, layout, components, billing, landing pages)
- Kole Jain — "Fundamental UI/UX Concepts" (affordances, hierarchy, spacing, typography, color, depth, interaction, image overlays)
- DEV Community / industry analysis — "I Analyzed 100 Vibe-Coded Websites" (technical oversights, performance, mobile, credibility signals)
- Web design statistics 2025–2026 (accessibility lawsuits, mobile traffic share, Core Web Vitals benchmarks)

---

*This is a living document. Add new patterns as they are identified — include what the pattern is, why it fails, and the corrective principle.*
