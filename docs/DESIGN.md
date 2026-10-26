# EventForge  -  Design System (DESIGN.md)

**Document status:** Draft v0.1
**Last updated:** 2026-09-25
**Companion documents:** [ARCHITECTURE.md](./ARCHITECTURE.md) * [PRD.md](./PRD.md) * [RULES.md](./RULES.md) * [TASKS.md](./TASKS.md) * [MEMORY.md](./MEMORY.md)

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Typography](#2-typography)
3. [Color System](#3-color-system)
4. [Spacing and Layout](#4-spacing-and-layout)
5. [Component Library](#5-component-library)
6. [Quiz Interface](#6-quiz-interface)
7. [Leaderboard Interface](#7-leaderboard-interface)
8. [Admin Interface](#8-admin-interface)
9. [Performance Budgets](#9-performance-budgets)
10. [Accessibility Standards](#10-accessibility-standards)
11. [Responsive Breakpoints](#11-responsive-breakpoints)

---

## 1. Design Principles

### 1.1 Core Values

| Principle | Description |
|---|---|
| **Clarity under pressure** | Participants are under a timer. Every UI element must communicate its purpose instantly. No decorative ambiguity. |
| **Trust through feedback** | Every action (answer saved, submission received, timer ticking) must provide immediate, unambiguous feedback. |
| **Mobile-first** | The primary participant device is a mid-range Android phone on 4G (Arjun persona). Desktop is for admins and judges. |
| **Accessible by default** | WCAG 2.2 AA is not a checkbox  -  it is a design input from the first wireframe. |
| **Calm authority** | The admin and judge interfaces should feel powerful but not overwhelming. Dark mode as default for staff. |

### 1.2 Visual Tone

- **Participant views:** Clean, spacious, high-contrast. A focused state  -  like a well-designed exam paper.
- **Admin views:** Dense, information-rich, dark. Like a mission control dashboard.
- **Public views:** Energetic, brand-forward, inviting. Like an event landing page.

---

## 2. Typography

### 2.1 Font Stack

```css
/* Primary  -  headings and UI labels */
--font-display: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;

/* Body  -  prose, descriptions, instructions */
--font-body: 'Inter', system-ui, sans-serif;

/* Monospace  -  code, scores, IDs, timestamps */
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

Both `Plus Jakarta Sans` and `Inter` are loaded from Google Fonts with `display=swap` and preconnect hints.

### 2.2 Type Scale

| Token | Size | Line height | Weight | Usage |
|---|---|---|---|---|
| `--text-xs` | 11px / 0.6875rem | 1.45 | 400 | Captions, timestamps, metadata |
| `--text-sm` | 13px / 0.8125rem | 1.5 | 400 | Secondary labels, table cells |
| `--text-base` | 15px / 0.9375rem | 1.6 | 400 | Body text, form fields |
| `--text-md` | 17px / 1.0625rem | 1.5 | 500 | Sub-headings, emphasized body |
| `--text-lg` | 20px / 1.25rem | 1.4 | 600 | Section headings |
| `--text-xl` | 24px / 1.5rem | 1.3 | 700 | Page headings |
| `--text-2xl` | 30px / 1.875rem | 1.2 | 700 | Hero headings |
| `--text-3xl` | 36px / 2.25rem | 1.15 | 800 | Display / event title |
| `--score-display` | 48px / 3rem | 1.0 | 800 | Score and rank display (mono) |

### 2.3 Font Loading

```html
<!-- In <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

## 3. Color System

### 3.1 Semantic Tokens (CSS Custom Properties)

```css
:root {
  /* === Brand === */
  --color-brand-50:  #eef2ff;
  --color-brand-100: #e0e7ff;
  --color-brand-200: #c7d2fe;
  --color-brand-400: #818cf8;
  --color-brand-500: #6366f1;   /* Primary action */
  --color-brand-600: #4f46e5;   /* Primary action hover */
  --color-brand-700: #4338ca;
  --color-brand-900: #1e1b4b;

  /* === Surface (light mode) === */
  --color-bg:           #f8fafc;
  --color-bg-elevated:  #ffffff;
  --color-bg-sunken:    #f1f5f9;
  --color-bg-overlay:   rgba(15, 23, 42, 0.5);

  /* === Surface (dark mode)  -  admin default === */
  --color-bg-dark:          #0f172a;
  --color-bg-elevated-dark: #1e293b;
  --color-bg-sunken-dark:   #0d1424;
  --color-bg-card-dark:     #1e293b;

  /* === Text === */
  --color-text-primary:   #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted:     #94a3b8;
  --color-text-inverse:   #f8fafc;
  --color-text-link:      #4f46e5;

  /* === Border === */
  --color-border:         #e2e8f0;
  --color-border-strong:  #cbd5e1;
  --color-border-focus:   #6366f1;

  /* === Status === */
  --color-success-50:  #f0fdf4;
  --color-success-500: #22c55e;
  --color-success-700: #15803d;
  --color-warning-50:  #fffbeb;
  --color-warning-500: #f59e0b;
  --color-warning-700: #b45309;
  --color-error-50:    #fef2f2;
  --color-error-500:   #ef4444;
  --color-error-700:   #b91c1c;
  --color-info-50:     #eff6ff;
  --color-info-500:    #3b82f6;
  --color-info-700:    #1d4ed8;

  /* === Quiz answer states === */
  --color-answer-selected:   #eef2ff;  /* indigo-50 */
  --color-answer-selected-border: #6366f1;
  --color-answer-correct:    #f0fdf4;  /* green-50 */
  --color-answer-correct-border:  #22c55e;
  --color-answer-wrong:      #fef2f2;  /* red-50 */
  --color-answer-wrong-border:    #ef4444;
  --color-answer-unanswered: #f8fafc;

  /* === Timer === */
  --color-timer-safe:    #22c55e;  /* > 5 min */
  --color-timer-warn:    #f59e0b;  /* 1""5 min */
  --color-timer-danger:  #ef4444;  /* < 1 min */

  /* === Rank badges === */
  --color-rank-gold:   #fbbf24;
  --color-rank-silver: #94a3b8;
  --color-rank-bronze: #b45309;
}
```

### 3.2 Dark Mode (Admin / Staff)

```css
[data-theme="dark"] {
  --color-bg:           #0f172a;
  --color-bg-elevated:  #1e293b;
  --color-bg-sunken:    #0d1424;
  --color-text-primary: #f1f5f9;
  --color-text-secondary: #94a3b8;
  --color-text-muted:   #475569;
  --color-border:       #334155;
  --color-border-strong: #475569;
}
```

Dark mode is the **default** for admin and judge routes. Participant routes are light mode by default with a system-preference override.

### 3.3 Color Contrast Requirements (WCAG 2.2 AA)

| Pair | Minimum ratio | Notes |
|---|---|---|
| Body text on background | 4.5:1 | All body copy |
| Large text / headings on background | 3:1 | â‰¥ 18 px bold or â‰¥ 24 px regular |
| UI components and graphic elements | 3:1 | Borders, icons, input fields |
| Timer countdown in danger state | 4.5:1 | Must meet full body-text ratio |

---

## 4. Spacing and Layout

### 4.1 Spacing Scale

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;   /* base unit */
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
}
```

### 4.2 Border Radius

```css
:root {
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-2xl:  24px;
  --radius-full: 9999px;  /* pills, badges */
}
```

### 4.3 Layout Containers

```css
.container-narrow  { max-width: 640px;  margin-inline: auto; padding-inline: var(--space-4); }
.container-default { max-width: 960px;  margin-inline: auto; padding-inline: var(--space-6); }
.container-wide    { max-width: 1280px; margin-inline: auto; padding-inline: var(--space-8); }
.container-full    { max-width: 100%;   padding-inline: var(--space-8); }
```

### 4.4 Grid System

```css
.grid-quiz    { display: grid; gap: var(--space-4); } /* single column on mobile */
.grid-cards   { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-6); }
.grid-admin   { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.grid-sidebar { display: grid; grid-template-columns: 1fr 320px; gap: var(--space-8); }
```

---

## 5. Component Library

Components are built on **Radix UI primitives** (accessible, unstyled) with custom Tailwind/CSS styling. All interactive components must have:
- A unique, descriptive `id` attribute (for testing)
- A visible focus ring using `--color-border-focus`
- An accessible label (visible or `aria-label`)
- Loading, disabled, and error states

### 5.1 Buttons

```
Variant     | Use case
â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
primary     | The single primary action per screen (Submit, Save, Next)
secondary   | Secondary actions (Cancel, Back, Edit)
danger      | Destructive actions (Disqualify, Delete, Unlock)
ghost       | Tertiary / navigation actions
link        | Inline text actions
icon        | Icon-only, square, requires aria-label
```

States: `default`, `hover`, `focus`, `active`, `loading` (spinner replaces label), `disabled`.

### 5.2 Form Fields

All form fields wrap an input + label + error/hint text. Labels are always visible (no placeholder-as-label).

```
Field types: TextInput, NumberInput, EmailInput, TextArea, Select, MultiSelect,
             RadioGroup, CheckboxGroup, Toggle, DatePicker, FileUpload
```

Error states use `--color-error-500` border + red error message below the field. Required fields show an asterisk with `aria-required="true"`.

### 5.3 Cards

```
.card           -  white bg, border, shadow-sm, radius-lg, padding-6
.card-compact   -  same but padding-4
.card-elevated  -  shadow-md, used for active/selected states
.card-dark      -  dark bg for admin dashboard panels
```

### 5.4 Badges and Status Indicators

```
Status          Color token
â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
open / active   success-500
paused          warning-500
closed          neutral (text-secondary)
draft           info-500
cancelled       error-500
finalized       brand-500
published       success-700
```

### 5.5 Notification and Alert Toasts

Toasts appear bottom-right on desktop, bottom-center on mobile. They auto-dismiss after 5 s (error toasts require manual dismiss). Types: `success`, `warning`, `error`, `info`.

The save-state indicator in the quiz is a persistent inline component (not a toast): shows `Saved âœ"`, `Saving"¦`, `Offline "" retrying` with appropriate colors and icons.

### 5.6 Modal and Sheet

- **Modal**  -  centered overlay; used for confirmations, quick-edit forms
- **Sheet**  -  slides from the right; used for detailed admin settings panels and judging evaluation forms

Both must trap focus, support Escape to close, and restore focus on close (Radix Dialog/Sheet primitives handle this).

### 5.7 Table

Admin data tables use a sticky header, horizontal scroll on overflow, and row hover highlight. Required columns: sortable headers (where applicable), paginator, row count, empty state illustration. Column widths defined in `px` or `ch` to prevent layout shift on data load.

### 5.8 Navigation

- **Public / Participant:** top navbar, `height: 56px`, sticky, semi-transparent with `backdrop-filter: blur(12px)`
- **Admin:** fixed sidebar, `width: 240px`, dark background, collapsible to icon-only on small screens
- **Judge:** simplified top navbar, judge workspace fills the remaining space

---

## 6. Quiz Interface

### 6.1 Layout

```
â"Œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
â"‚  Header: EventForge  [round name]  [ðŸ• 14:32]  â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚  Question palette (horizontal scroll)   â"‚
â"‚  [1] [2âœ"] [3] ... [30]                â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚                                         â"‚
â"‚  Question 2 of 30    [2 marks]          â"‚
â"‚                                         â"‚
â"‚  [Question stem  -  may include image]    â"‚
â"‚                                         â"‚
â"‚  â - ‹  Option A                            â"‚
â"‚  â -   Option B  <- selected               â"‚
â"‚  â - ‹  Option C                            â"‚
â"‚  â - ‹  Option D                            â"‚
â"‚                                         â"‚
â"‚  [<- Prev]           [Next <-’]           â"‚
â"‚                                         â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚  Footer: [Answered: 12/30]  [ðŸ’¾ Saved]  [Submit <-’]  â"‚
â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
```

### 6.2 Timer Display

```
â"Œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
â"‚  â±  14:32        â"‚   <-’ green (safe)
â"‚  â±  03:58        â"‚   <-’ amber (warning, < 5 min)
â"‚  â±  00:47        â"‚   <-’ red, pulsing (danger, < 1 min)
â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
```

The timer renders `deadline_at âˆ’ (Date.now() + serverOffset)`. It never counts below 0. When it reaches 0, the submit flow is triggered automatically.

### 6.3 Save State Indicator

```
[ðŸ’¾ Saved at 14:31:02]        -  normal state
[âŸ³ Saving...]                 -  during debounce flush
[âš  Offline "" retrying...]     -  network error, queue building
[[x] Save failed "" will retry]  -  persistent error (with retry count)
```

Color: success-green, neutral, warning-amber, error-red.

### 6.4 Question Palette

Each slot in the palette is a small `button` (accessible). States:

| State | Visual |
|---|---|
| Not visited | Light grey outline |
| Visited, unanswered | Light grey fill |
| Answered | Brand-indigo fill, white number |
| Flagged | Amber ring |
| Current | Strong border + shadow |

### 6.5 Answer States (after results release)

| State | Background | Border | Icon |
|---|---|---|---|
| Correct (selected) | green-50 | green-500 | âœ" |
| Wrong (selected) | red-50 | red-500 | [x] |
| Correct (not selected) | green-50 | green-400 dashed |  -  |
| Unanswered | neutral | neutral |  -  |

---

## 7. Leaderboard Interface

### 7.1 Public Leaderboard

```
â"Œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
â"‚  ðŸ†  EventForge 2026  -  Live Leaderboard           â"‚
â"‚  Updated 3 s ago * Provisional * Round 2 of 3    â"‚
â"œâ"€â"€â"€â"€â"¬â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¬â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚ #  â"‚ Team / Participant           â"‚     Score      â"‚
â"œâ"€â"€â"€â"€â"¼â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¼â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚ ðŸ¥‡ â"‚ Quantum Coders              â"‚  94.20         â"‚
â"‚ ðŸ¥ˆ â"‚ Neural Ninjas               â"‚  91.75         â"‚
â"‚ ðŸ¥‰ â"‚ ByteBrigade                 â"‚  89.50         â"‚
â"‚  4 â"‚ Lambda Lords                â"‚  87.00         â"‚
â"‚  5 â"‚ Circuit Breakers            â"‚  86.50         â"‚
â"‚ â"€â"€ â"‚ â"€â"€ â"€â"€ â"€â"€ â"€â"€ â"€â"€ â"€â"€ â"€â"€        â"‚  â"€â"€ â"€â"€ â"€â"€      â"‚
â"‚ 42 â"‚ â - ¶  You  â - €                   â"‚  71.25  (#42)  â"‚
â""â"€â"€â"€â"€â"´â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"´â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
```

- Top 3 ranks use medal emoji + highlighted row
- "You" row is always visible (sticky at bottom when off-screen) if the participant is authenticated
- Frozen state: banner "ðŸ"’ Leaderboard frozen at 16:00  -  final standings after review"
- Stale state (> 2Ã -  poll interval): "âš  Data may be delayed"

### 7.2 Per-Round Breakdown (expandable row)

```
â - ¼  Quantum Coders   94.20
   â"œâ"€ Quiz 1          38.00 / 40.00
   â"œâ"€ Challenge       32.20 / 40.00
   â""â"€ Presentation    24.00 / 20.00 (+4 bonus)
```

---

## 8. Admin Interface

### 8.1 Admin Dashboard Overview

```
â"Œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
â"‚  Sidebar (dark)              â"‚  Main content area             â"‚
â"‚  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€             â"‚  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€               â"‚
â"‚  ðŸ   Overview                â"‚  [Event: TechFest 2026]        â"‚
â"‚  ðŸ"‹  Registrations  [487]    â"‚                                â"‚
â"‚  ðŸ"„  Rounds                  â"‚  â"Œâ"€â"€â"€â"€â"€â"€â"  â"Œâ"€â"€â"€â"€â"€â"€â"  â"Œâ"€â"€â"€â"€â"€â"€â" â"‚
â"‚    â"" Quiz 1  [OPEN]         â"‚  â"‚ 487  â"‚  â"‚  42  â"‚  â"‚  12  â"‚ â"‚
â"‚    â"" Challenge  [scheduled] â"‚  â"‚ regs â"‚  â"‚ teamsâ"‚  â"‚ staffâ"‚ â"‚
â"‚  ðŸ†  Leaderboard            â"‚  â""â"€â"€â"€â"€â"€â"€â"˜  â""â"€â"€â"€â"€â"€â"€â"˜  â""â"€â"€â"€â"€â"€â"€â"˜ â"‚
â"‚  ðŸ"Š  Results                â"‚                                â"‚
â"‚  ðŸ"  Exports                â"‚  Live Attempts: 312 / 487      â"‚
â"‚  ðŸ"œ  Audit Log              â"‚  ||||||||||||â - ‘â - ‘â - ‘â - ‘  64%         â"‚
â"‚  âš™   Settings              â"‚                                â"‚
â"‚                             â"‚  Saves/s:  47                  â"‚
â"‚  [EventForge]               â"‚  Submits:   0 (round open)    â"‚
â"‚  [Super Admin â - ¾]            â"‚  DB CPU:  34%                  â"‚
â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
```

### 8.2 Round Control Panel

Critical actions (Open, Close, Pause, Resume) use a two-step confirmation pattern:

```
1. Admin clicks [Close Round]
2. Confirmation modal appears:
   â"Œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
   â"‚  âš   Close "Quiz Round 1"?                   â"‚
   â"‚                                             â"‚
   â"‚  312 active attempts will be auto-submitted â"‚
   â"‚  from their saved answers.                  â"‚
   â"‚                                             â"‚
   â"‚  This cannot be undone.                     â"‚
   â"‚                                             â"‚
   â"‚  [Cancel]           [Close Round <-’]         â"‚
   â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
3. Admin confirms <-’ action proceeds
```

### 8.3 Judge Evaluation Form

```
â"Œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
â"‚  Evaluating: Item #EF-042  (blind)          â"‚
â"‚  Repo: github.com/[hidden]                  â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚  Technical Implementation         /30       â"‚
â"‚  ||||||||||||||||â - ‘â - ‘â - ‘â - ‘  22 / 30             â"‚
â"‚  [  22  ]  <-â"€â"€ score input                 â"‚
â"‚  Comment: [________________________]        â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚  Presentation Quality              /20       â"‚
â"‚  ||||||||||||â - ‘â - ‘â - ‘â - ‘â - ‘â - ‘â - ‘â - ‘  16 / 20             â"‚
â"‚  [  16  ]                                   â"‚
â"‚  Comment: [________________________]        â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚  Innovation                        /10       â"‚
â"‚  ||||||||||||||||||||   9 / 10             â"‚
â"‚  [   9  ]                                   â"‚
â"‚  Comment: [________________________]        â"‚
â"œâ"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
â"‚  Total: 47 / 60 (78.3%)                    â"‚
â"‚  Overall comment: [__________________]      â"‚
â"‚  Evidence link:  [__________________]      â"‚
â"‚                                             â"‚
â"‚  [Save Draft]          [Submit Evaluation]  â"‚
â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
```

---

## 9. Performance Budgets

| Resource | Budget | Why |
|---|---|---|
| Quiz route JS (gzipped) | â‰¤ 170 KB | Mid-range mobile on 4G; Largest Contentful Paint target |
| Quiz route CSS | â‰¤ 20 KB | |
| Quiz question payload (30 questions, text only) | â‰¤ 60 KB | Single API response at attempt start |
| Quiz question payload (with images) | â‰¤ 150 KB | Images served from CDN separately; deferred load |
| Leaderboard snapshot (top-100) | â‰¤ 10 KB raw, â‰¤ 4 KB gzip | Polled every 15 s |
| Admin dashboard initial JS | â‰¤ 300 KB gzip | Admin is on better hardware/network |
| Individual page image assets | â‰¤ 100 KB each | |
| First Contentful Paint (LCP, p75, 4G mobile) | â‰¤ 2.5 s | Lighthouse |
| Time to Interactive (4G mobile) | â‰¤ 4.0 s | Lighthouse |
| Cumulative Layout Shift | â‰¤ 0.05 | Prevent layout jumping on image load |

### 9.1 Enforcement

- Lighthouse CI runs on every PR against the performance budgets above.
- A `bundle-size` action tracks gzipped size per route and comments on PRs when a budget is exceeded.
- Images must be optimized with Next.js `<Image>` with explicit `width` and `height` to prevent CLS.

---

## 10. Accessibility Standards

### 10.1 Requirements (WCAG 2.2 AA)

| Area | Requirement |
|---|---|
| Keyboard navigation | All interactive elements reachable by Tab; logical focus order; no keyboard traps (except modals, which trap intentionally and support Escape) |
| Focus indicators | Visible focus ring on all focusable elements, using `--color-border-focus` with at least 2 px offset |
| Screen reader | All images have meaningful alt text or `alt= - `; all icons have aria-label if standalone; all form fields have associated labels |
| Color contrast | All text and UI components meet WCAG 2.2 AA ratios (see sec.3.3) |
| Motion | All animations respect `prefers-reduced-motion: reduce`; timer pulse animation is suppressed |
| Error identification | Error messages are associated with their field via `aria-describedby`; errors are announced via an `aria-live` region |
| Status | Save state, timer updates, and leaderboard refreshes are announced via `aria-live="polite"` |

### 10.2 Testing

- `axe-core` runs in Playwright e2e tests on all key flows
- Manual keyboard-only navigation test before every release
- Screen-reader spot check (NVDA/VoiceOver) before first live event

---

## 11. Responsive Breakpoints

```css
:root {
  /* Mobile-first  -  styles without a breakpoint apply to all */
  --bp-sm:  480px;   /* Large phones / small tablets */
  --bp-md:  768px;   /* Tablets */
  --bp-lg:  1024px;  /* Laptops */
  --bp-xl:  1280px;  /* Desktops */
  --bp-2xl: 1536px;  /* Wide screens */
}
```

### 11.1 Participant Views (Mobile-First)

| Breakpoint | Layout |
|---|---|
| `< sm` (default) | Single column; bottom tab nav; full-width cards |
| `sm+` | Slightly wider content area; inline question palette |
| `md+` | Two-column layout for quiz (palette left, question right) |
| `lg+` | Max-width container; navbar instead of bottom tabs |

### 11.2 Admin Views (Desktop-First)

| Breakpoint | Layout |
|---|---|
| `< lg` | Sidebar collapses to icon-only; full-width content |
| `lg+` | Full sidebar + content grid; multi-column data tables |
| `xl+` | Wide dashboard with additional metric panels |

### 11.3 Touch Targets

All interactive elements on participant mobile views must have a minimum touch target size of `44 Ã -  44 px`. This applies especially to:
- Answer option rows (entire row is clickable, not just the radio button)
- Question palette cells
- Navigation buttons (Prev / Next / Submit)