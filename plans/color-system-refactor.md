# Color System Refactor Plan

## Goal
Centralize all colors in `tailwind.config.js` for easy global adjustments while maintaining full Tailwind functionality (opacity modifiers, hover states, etc.)

## Approach: Tailwind-Native (Option A)

All colors defined as hex values directly in Tailwind config. No CSS variables needed.

---

## Phase 1: Audit Current Colors

### Tasks
1. Search codebase for hardcoded hex colors: `#[0-9a-fA-F]{3,6}`
2. Search for Tailwind color classes: `text-red-`, `bg-green-`, etc.
3. Categorize by usage (brand, services, status, UI)

### Commands
```bash
# Find hardcoded hex colors
grep -rE "#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}" frontend/ --include="*.tsx" | grep -v node_modules

# Find Tailwind color usage
grep -rE "text-(red|green|blue|yellow|purple|orange|gray|white|black)-[0-9]+" frontend/ --include="*.tsx"
grep -rE "bg-(red|green|blue|yellow|purple|orange|gray|white|black)-[0-9]+" frontend/ --include="*.tsx"
```

### Expected Categories
- **Brand**: Primary app color (currently `#fca200` / `#ecb200`)
- **Services**: YouTube (`#FF0000`), Spotify (`#1DB954`), Deezer (`#A855F7`), Last.fm (`#D51007`)
- **Status**: Success (green), Error (red), Warning (yellow), Info (blue)
- **UI**: Backgrounds, borders, text shades

---

## Phase 2: Define Color Palette

### Proposed `tailwind.config.js` Structure
```js
module.exports = {
    theme: {
        extend: {
            colors: {
                // Brand
                brand: {
                    DEFAULT: '#fca200',
                    hover: '#e69200',
                    light: '#fcb84d',
                    dark: '#d48c00',
                },
                
                // External Services
                youtube: '#FF0000',
                spotify: '#1DB954',
                deezer: '#A855F7',
                lastfm: '#D51007',
                
                // AI/Discovery features
                ai: {
                    DEFAULT: '#A855F7',
                    hover: '#9333EA',
                },
                
                // Status (can use Tailwind defaults or customize)
                // success: '#22c55e',  // green-500
                // error: '#ef4444',    // red-500
                // warning: '#f59e0b',  // amber-500
                // info: '#3b82f6',     // blue-500
                
                // Surface colors (optional)
                // surface: {
                //     DEFAULT: '#1a1a1a',
                //     elevated: '#282828',
                //     hover: '#333333',
                // },
            },
        },
    },
};
```

---

## Phase 3: Migration (File by File)

### Order of Migration
1. **Player components** (most visible)
   - `MiniPlayer.tsx`
   - `FullPlayer.tsx`
   - `OverlayPlayer.tsx`
   
2. **Playlist/Track lists**
   - `playlist/[id]/page.tsx`
   - `TrackList.tsx`
   - `PopularTracks.tsx`
   
3. **Feature components**
   - Album, Artist, Podcast pages
   - Search components
   - Settings components
   
4. **Layout components**
   - Sidebar, Navigation
   - Activity panel
   
5. **UI primitives**
   - Button, Form elements
   - Modals, Toasts

### Migration Pattern
For each file:
1. Read current file
2. Identify hardcoded colors
3. Replace with Tailwind tokens:
   - `#fca200` → `brand` (e.g., `text-brand`, `bg-brand`)
   - `#ecb200` → `brand` (consolidate variants)
   - `#FF0000` / `red-500` / `red-600` → `youtube` for YouTube-related
   - `#1DB954` → `spotify`
   - `#A855F7` → `deezer` or `ai`
4. Test the component
5. Commit

### Search & Replace Patterns
```
# Brand colors
text-[#fca200] → text-brand
text-[#ecb200] → text-brand
bg-[#fca200] → bg-brand
hover:bg-[#e69200] → hover:bg-brand-hover

# YouTube (for streaming indicators)
text-red-500 → text-youtube (when YouTube-specific)
bg-red-600 → bg-youtube (when YouTube-specific)

# Keep standard Tailwind for non-semantic uses
text-red-400 → keep as-is (error states, delete buttons)
```

---

## Phase 4: Documentation

### Update CLAUDE.md / AGENTS.md
```markdown
## Color Usage

### Tailwind Tokens
- `brand` - Primary app color (buttons, active states, highlights)
- `youtube` - YouTube streaming indicators
- `spotify` - Spotify-related UI
- `deezer` - Deezer-related UI
- `lastfm` - Last.fm-related UI
- `ai` - AI/ML feature highlights

### Usage Examples
```tsx
// Brand button
<button className="bg-brand hover:bg-brand-hover text-black">

// YouTube streaming indicator
<span className="bg-youtube/80 text-white">YT</span>

// Currently playing (local = brand, YouTube = youtube)
<p className={isYouTube ? "text-youtube" : "text-brand"}>
```

### Standard Tailwind (keep as-is)
- `red-400/500` - Error states, delete actions
- `green-500` - Success states
- `gray-*` - Text, borders, backgrounds
- `white/black` - Base colors
```

---

## Phase 5: Verification

### Checklist
- [ ] All `#fca200` / `#ecb200` replaced with `brand`
- [ ] YouTube indicators use `youtube` token
- [ ] Service icons use correct service colors
- [ ] Opacity modifiers work (`bg-youtube/80`, `text-brand/70`)
- [ ] Hover states work (`hover:bg-brand-hover`)
- [ ] No visual regressions
- [ ] Build passes without errors

### Test Scenarios
1. Play local track - brand yellow highlight
2. Play YouTube stream - youtube red highlight
3. Import Spotify playlist - spotify green accents
4. Import Deezer playlist - deezer purple accents
5. AI recommendations - ai purple styling
6. All buttons, links, active states correct

---

## Rollback Plan

If issues arise:
1. `git stash` current changes
2. Or revert specific files: `git checkout HEAD -- frontend/path/to/file.tsx`
3. Tailwind config can be reverted without affecting other files

---

## Estimated Effort

| Phase | Files | Time |
|-------|-------|------|
| Audit | - | 15 min |
| Define palette | 1 | 10 min |
| Migration | ~70 | 2-3 hours |
| Documentation | 2 | 15 min |
| Testing | - | 30 min |

**Total: ~4 hours**

---

## Notes

- Commit after each major component group
- Test in both desktop and mobile views
- Keep standard Tailwind colors for generic UI (gray, white, etc.)
- Only create semantic tokens for colors with specific meaning
