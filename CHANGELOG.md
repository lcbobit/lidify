# Changelog

All notable changes to this fork will be documented in this file.

This is a fork of [Lidify](https://github.com/Chevron7Locked/lidify) with significant enhancements.

## [Unreleased]

### New Features

#### Remote Playback (Spotify Connect-like)
- Control playback across multiple devices via WebSocket
- Real-time state sync: track info, progress, volume, queue
- Device selector in player UI
- Works through any reverse proxy (internal WebSocket proxy)

#### Subsonic API
- Full Subsonic/OpenSubsonic API compatibility
- Works with Symfonium, DSub, Ultrasonic, and other Subsonic clients
- Set a separate Subsonic password in Settings (use your Lidify username)
- Streaming, playlists, search, and album art endpoints

#### AI-Powered Recommendations
- **AI Weekly playlist**: Personalized weekly recommendations via OpenRouter
- Prioritizes sonic similarity over cultural/genre associations
- Filters out artists already in your library
- Supports multiple LLM providers (OpenAI, Anthropic, etc. via OpenRouter)
- Enable by setting `OPENROUTER_API_KEY` env var ([get key](https://openrouter.ai/keys))

#### Album & Artist Enhancements
- **Album bios**: Fetch descriptions from Last.fm/Wikipedia for owned albums
- **MBID Editor**: Manually search and set MusicBrainz IDs for artists/albums
- **Codec display**: Show format and bitrate (FLAC 1411kbps, MP3 320kbps) on tracks
- **Multi-disc support**: Proper disc number handling and display

#### Search Improvements
- **Lazy enrichment**: Fast search results, full metadata on click
- **Improved ranking**: PostgreSQL full-text search with proper triggers
- **Last.fm discovery**: Find new artists with strict name matching

### Critical Fixes

#### ML Audio Analysis (Was Completely Broken)
- **Model mismatch**: Code looked for non-existent model files - now uses correct paths
- **Column inversion**: Mood predictions were inverted (metal = "not aggressive")
- **Missing models**: Added mood_party, mood_acoustic, mood_electronic
- **Danceability**: Now uses ML model instead of broken heuristic
- **Max file size filter**: Skip oversized files to prevent analysis timeouts (`MAX_FILE_SIZE_MB`)
- **Disable option**: Skip ML entirely for low-resource systems (`DISABLE_ML_ANALYSIS=true`)

<details>
<summary>Example ML analysis results (click to expand)</summary>

| Track | Artist | Aggr | Happy | Sad | Relaxed | Dance | BPM |
|-------|--------|------|-------|-----|---------|-------|-----|
| Master of Puppets | Metallica | 87% | 9% | 10% | 5% | 5% | 104 |
| Enter Sandman | Metallica | 86% | 20% | 19% | 9% | 4% | 124 |
| Thunderstruck | AC/DC | 78% | 79% | 7% | 5% | 58% | 134 |
| Smoke on the Water | Deep Purple | 70% | 28% | 20% | 11% | 20% | 118 |
| Smack My Bitch Up | The Prodigy | 79% | 20% | 5% | 13% | 95% | 136 |
| Firestarter | The Prodigy | 81% | 38% | 6% | 13% | 86% | 142 |
| Get Lucky | Daft Punk | 1% | 89% | 18% | 55% | 96% | 116 |
| Rebel Rebel | David Bowie | 13% | 92% | 26% | 16% | 9% | 126 |
| Life on Mars? | David Bowie | 2% | 25% | 85% | 77% | 3% | 125 |
| My Favorite Things | John Coltrane | 1% | 2% | 88% | 99% | 19% | 89 |

*Metallica correctly shows high aggressive (86-87%). The Prodigy (electronic) is aggressive AND danceable (86-95%). Daft Punk's "Get Lucky" is 96% danceable. Bowie's ballad "Life on Mars?" is 85% sad, only 3% danceable. Jazz (Coltrane) is 99% relaxed.*

</details>

#### Playlist Artist Diversity
- Playlists were dominated by early-imported artists (90% same artist)
- Queries returned tracks by insertion order, not randomly
- Now fetches ALL matching tracks, then diversifies (max 2 per artist)
- Applied to: Chill, Workout, Focus, High Energy, Late Night, Happy, Melancholy, Era, Genre, Party, and more

#### WebSocket Stability
- Reconnection no longer stops playback
- Increased ping timeout for reverse proxy compatibility
- Clears stale device references after timeout

#### Cover Art Loading
- Fixed race conditions causing wrong/missing covers
- Extended cache: 1 year for URLs, 90 days for images
- Added Deezer fallback when Cover Art Archive fails
- Rate limiting prevents API throttling

### Improvements

#### Lidarr Integration
- **Interactive release search**: Choose specific album releases when downloading
- Quality profile selection in settings UI
- Metadata refresh wait when adding artists (prevents "artist not found")
- Retry logic with exponential backoff for MusicBrainz
- Artist name validation prevents wrong artist downloads
- Artist deletion protection (checks for active downloads)

#### Performance
- Parallelized search queries (5 sources simultaneously)
- Reduced API calls during search (30+ → ~5)
- Lazy loading for artist enrichment
- **Album cache improvements**: Unified Redis keys, conditional caching based on config
- Album cover persistence to database for faster subsequent loads

#### Security
- Hardened authentication and session handling
- Input validation improvements
- Subsonic password encryption (AES-256-CBC)

#### UI/UX
- Mobile navigation improvements
- Library state persistence
- Scan animation timing fix
- Edit buttons always visible (not hover-only)
- Preview playback: click any track row
- Direct artist links from AI recommendations

### Infrastructure

#### Docker & CI/CD
- **GHCR publishing**: `docker pull ghcr.io/fjordnode/lidify:latest`
- Tag-based releases (no build on every push)
- Auto-generated release notes from changelog
- Examples folder with deployment configs

---

## Versioning

This fork uses independent semantic versioning starting at v0.1.0.

## Attribution

Original project by [Chevron7Locked](https://github.com/Chevron7Locked/lidify), licensed under GPL-3.0.
