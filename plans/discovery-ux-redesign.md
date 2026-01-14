# Discovery UX Redesign

## Problem Statement

Current discovery has several issues:
1. **One-size-fits-none** — Blended output doesn't serve users who want "more of the same" OR "surprise me"
2. **Volatile timeframes** — 1 week is too mood-based, all-time is too stale
3. **Narrow seeding** — Top 5 artists creates repetitive results
4. **No user control** — Users can't tune relevance vs novelty
5. **Black box feel** — Users don't understand why they got certain recommendations

## Solution Overview

### Two User Controls

```
┌─────────────────────────────────────────────────────────────┐
│  DISCOVERY SETTINGS                                         │
│                                                             │
│  Taste Source (timeframe):                                  │
│  ┌─────────┬───────────┬──────────┬───────────┐            │
│  │ 7 days  │  28 days  │  90 days │  All time │            │
│  └─────────┴───────────┴──────────┴───────────┘            │
│                    ▲ default                                │
│                                                             │
│  Discovery Mode:                                            │
│  ┌─────────┬───────────┬─────────────┬─────────┐           │
│  │  Safe   │  Adjacent │ Adventurous │   Mix   │           │
│  └─────────┴───────────┴─────────────┴─────────┘           │
│                                            ▲ default        │
└─────────────────────────────────────────────────────────────┘
```

### Sectioned Output (for Mix mode)

```
┌─────────────────────────────────────────────────────────────┐
│  Based on: Nick Cave, QOTSA, Lana Del Rey, Offspring...     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SAFE PICKS (5-6 artists)                                   │
│  "More of what you love"                                    │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │     │ │     │ │     │ │     │ │     │ │     │          │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
│                                                             │
│  ADJACENT (5-6 artists)                                     │
│  "Same vibe, new names"                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │     │ │     │ │     │ │     │ │     │ │     │          │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
│                                                             │
│  WILDCARDS (4-5 artists)                                    │
│  "Unexpected but still you"                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                   │
│  │     │ │     │ │     │ │     │ │     │                   │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Discovery Modes

### 1. Safe Mode
- **What users get**: Direct sonic matches — same genre, era, production style
- **Use case**: "I know what I like, give me more"
- **Output**: 16 artists, all high-similarity

### 2. Adjacent Mode
- **What users get**: Same energy/mood, may cross genres
- **Use case**: "Expand within my taste"
- **Output**: 16 artists, all medium-similarity

### 3. Adventurous Mode
- **What users get**: Stretched connections, unexpected but coherent
- **Use case**: "Surprise me (but keep it relevant)"
- **Output**: 16 artists, all low-similarity wildcards

### 4. Mix Mode (Default)
- **What users get**: Balanced 1/3 each tier
- **Use case**: "Give me everything"
- **Output**: 5-6 safe + 5-6 adjacent + 4-5 wildcards = 16 total
- **Display**: Sectioned by tier with labels

---

## Timeframe Options

| Option | Window | Weighting | Use Case |
|--------|--------|-----------|----------|
| **7 days** | Last week | Equal | "What I'm into RIGHT NOW" |
| **28 days** | Last month | Recency-weighted | "My current taste" (default) |
| **90 days** | Last 3 months | Recency-weighted | "My stable preferences" |
| **All time** | Everything | Equal | "My musical identity" |

### Recency Weighting (for 28d and 90d)

When using 28-day window:
```
Week 1 (most recent): 45% weight
Week 2:               25% weight
Week 3:               18% weight
Week 4 (oldest):      12% weight
```

This captures both current mood AND stable preferences.

---

## Seed Artist Selection

### Current Approach (Too Narrow)
- Top 5 most played → repetitive results

### New Approach: Weighted Sampling from Larger Pool

1. **Build pool**: Top 20-50 artists (based on play count in timeframe)
2. **Sample seeds**: Pick 8-12 using weighted randomness
   - Ranks 1-5: 50% chance to appear
   - Ranks 6-15: 35% chance
   - Ranks 16-50: 15% chance
3. **Diversity constraint**: Max 2 artists from same genre cluster

This produces "you-coded" recommendations without being predictable.

---

## AI Prompt Templates

### Safe Mode Prompt
```
User's top artists (last {timeframe}):
{seed_artists_with_play_counts}

TASK: Recommend 16 artists who sound VERY SIMILAR to these seeds.

REQUIREMENTS:
- Same genre, same era, same production style
- Direct sonic matches only
- Must NOT be in user's library: {library_artists}

Output JSON array of {name, reason} pairs.
```

### Adjacent Mode Prompt
```
User's top artists (last {timeframe}):
{seed_artists_with_play_counts_and_genres}

TASK: Recommend 16 artists who share the same ENERGY and MOOD.

REQUIREMENTS:
- Can cross genres if the vibe matches
- Same feeling, new sounds
- Find artists who "fit the same playlist"
- Must NOT be in user's library: {library_artists}

Output JSON array of {name, reason} pairs.
```

### Adventurous Mode Prompt
```
User's top artists (last {timeframe}):
{seed_artists_with_play_counts_and_genres}

TASK: Recommend 16 artists with UNEXPECTED but COHERENT connections.

REQUIREMENTS:
- Find the thread that links across genres
- Stretch boundaries but stay connected
- Think: "If they like X, they might not expect Y, but they'd love it"
- Must NOT be in user's library: {library_artists}

Output JSON array of {name, reason} pairs.
```

### Mix Mode Prompt
```
User's top artists (last {timeframe}):
{seed_artists_with_play_counts_and_genres}

TASK: Recommend 16 artists in 3 tiers:

SAFE (5-6 artists):
- Direct sonic matches, same genre/era/production

ADJACENT (5-6 artists):
- Same energy/mood, can cross genres if vibe matches

WILDCARD (4-5 artists):
- Unexpected connections, stretch but stay coherent

REQUIREMENTS:
- Label each with its tier
- Must NOT be in user's library: {library_artists}

Output JSON: {safe: [...], adjacent: [...], wildcard: [...]}
```

---

## Implementation Plan

### Phase 1: Core UX
- [ ] Add timeframe dropdown to /discover page
- [ ] Add discovery mode selector (Safe/Adjacent/Adventurous/Mix)
- [ ] Update backend to accept `timeframe` and `mode` parameters
- [ ] Create 4 prompt templates
- [ ] Sectioned output display for Mix mode
- [ ] Show "Based on: X, Y, Z..." transparency

### Phase 2: Algorithm Refinement
- [ ] Implement recency weighting for 28d/90d timeframes
- [ ] Weighted random sampling from top 50 (instead of top 5)
- [ ] Diversity constraints (max 2 per genre cluster)
- [ ] Cache results per mode+timeframe combo (24h)

### Phase 3: Polish
- [ ] Persist user's preferred mode/timeframe in settings
- [ ] Add "Why this?" tooltip explaining each recommendation
- [ ] Album previews (Deezer) for each recommended artist
- [ ] "Add to Library" quick action via Lidarr

---

## Technical Notes

### Backend Changes
- `GET /discover/recommendations` gains new query params:
  - `timeframe`: `7d` | `28d` | `90d` | `all` (default: `28d`)
  - `mode`: `safe` | `adjacent` | `adventurous` | `mix` (default: `mix`)
- Response shape changes for Mix mode to include tier labels

### Frontend Changes
- New UI controls on /discover page header
- Conditional rendering: single list vs sectioned tiers
- Update localStorage cache key to include mode+timeframe

### Caching Strategy
- Cache key: `discover_{userId}_{timeframe}_{mode}`
- TTL: 24 hours
- Invalidate on: manual refresh button

---

## Open Questions

1. **Merge with AI Weekly?**
   - Option A: Replace AI Weekly entirely with this system
   - Option B: Keep both — AI Weekly for LLM, /discover for Last.fm
   - Option C: This becomes the unified discovery, powered by AI

2. **Default mode for new users?**
   - Probably "Mix" — gives them variety to understand the system

3. **Should timeframe affect seed COUNT or just seed SELECTION?**
   - 7 days might have fewer plays → fewer seed candidates
   - Could auto-expand to 28d if <5 artists in 7d window

4. **Mobile UX for controls?**
   - Full controls or simplified?
   - Maybe just mode toggle, timeframe in "advanced"?

---

## Example: How It Would Work

**User settings:**
- Timeframe: 28 days
- Mode: Mix

**System does:**
1. Get plays from last 28 days with recency weighting
2. Build pool of top 50 artists
3. Sample 10 seeds with weighted randomness + diversity
4. Send to AI with Mix prompt
5. Receive 16 artists labeled by tier
6. Display in 3 sections with seed transparency
7. Cache for 24 hours

**User sees:**
```
Based on your last month: Nick Cave, QOTSA, Lana Del Rey...

SAFE PICKS
PJ Harvey, Royal Blood, Weyes Blood, Bad Religion, Chemical Brothers

ADJACENT
Timber Timbre, Mazzy Star, IDLES, Fontaines D.C., Depeche Mode

WILDCARDS
Portishead, Nine Inch Nails, Röyksopp, Massive Attack
```
