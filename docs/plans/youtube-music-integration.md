# YouTube Music Integration Plan

## Overview

Add YouTube Music as a source for Lidify, enabling users to:
1. **Download tracks** from YouTube Music as a fallback when Soulseek/indexers fail
2. **Stream directly** from YouTube Music without downloading (future enhancement)

This is inspired by [OuterTune](https://github.com/OuterTune/OuterTune), an Android app that provides free YouTube Music access by using YouTube's internal InnerTube API.

## How It Works

### YouTube's InnerTube API

YouTube Music uses an internal API called **InnerTube** (`https://music.youtube.com/youtubei/v1/`). Key points:

- **No OAuth required** - Works with anonymous visitor data
- **No DRM on audio** - Unlike Spotify (Widevine), YouTube Music serves unencrypted audio streams
- **High quality available** - Up to 256kbps AAC (OPUS also available)
- **Signed URLs** - Stream URLs expire after ~6 hours and require signature decryption

### Why yt-dlp?

[yt-dlp](https://github.com/yt-dlp/yt-dlp) is the best tool for this because:

1. **Handles signature decryption** - YouTube obfuscates stream URLs; yt-dlp reverse-engineers this
2. **Actively maintained** - YouTube frequently changes their API; yt-dlp keeps up
3. **Format selection** - Can extract best audio quality automatically
4. **Metadata extraction** - Gets title, artist, album, thumbnail, etc.
5. **Already in many Docker images** - Easy to add to our stack

## Implementation Plan

### Phase 1: Download Capability (MVP)

#### Backend Service

Create a new YouTube Music service (`backend/src/services/youtube-music.ts`):

```typescript
interface YouTubeMusicTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumbnail: string;
}

class YouTubeMusicService {
  // Search YouTube Music for a track
  async search(query: string): Promise<YouTubeMusicTrack[]>;
  
  // Search by specific track info (for matching)
  async findTrack(artist: string, title: string, album?: string): Promise<YouTubeMusicTrack | null>;
  
  // Download track using yt-dlp
  async downloadTrack(videoId: string, outputPath: string): Promise<string>;
  
  // Get stream URL (for direct playback)
  async getStreamUrl(videoId: string): Promise<string>;
}
```

#### yt-dlp Integration

**Option A: Shell out to yt-dlp CLI**
```typescript
import { exec } from 'child_process';

async function downloadTrack(videoId: string, outputPath: string): Promise<string> {
  const url = `https://music.youtube.com/watch?v=${videoId}`;
  const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 \
    --embed-thumbnail --add-metadata \
    -o "${outputPath}/%(title)s.%(ext)s" \
    "${url}"`;
  
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(outputPath);
    });
  });
}
```

**Option B: Use yt-dlp as a Python service**
```python
import yt_dlp

def download_track(video_id: str, output_path: str) -> str:
    url = f"https://music.youtube.com/watch?v={video_id}"
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '320',
        }],
        'outtmpl': f'{output_path}/%(title)s.%(ext)s',
        'writethumbnail': True,
        'embedthumbnail': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return ydl.prepare_filename(info)
```

#### Search Implementation

Use InnerTube API directly for search (faster than yt-dlp):

```typescript
const INNERTUBE_API = 'https://music.youtube.com/youtubei/v1';
const INNERTUBE_CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20240101.01.00',
};

async function searchYouTubeMusic(query: string): Promise<YouTubeMusicTrack[]> {
  const response = await fetch(`${INNERTUBE_API}/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    body: JSON.stringify({
      context: {
        client: INNERTUBE_CLIENT,
      },
      query,
      params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D', // Filter: Songs only
    }),
  });
  
  const data = await response.json();
  // Parse response into YouTubeMusicTrack[]
  return parseSearchResults(data);
}
```

#### Integration with Existing Download Flow

Modify the track acquisition flow to use YouTube Music as a fallback:

```
1. User requests track download
2. Try Soulseek → if found, download
3. Try configured indexers → if found, download  
4. Try YouTube Music → if found, download via yt-dlp
5. Mark as failed if all sources fail
```

### Phase 2: Streaming Capability

#### Direct Stream URLs

Get playable URLs without downloading:

```typescript
async function getStreamUrl(videoId: string): Promise<StreamInfo> {
  // Use yt-dlp to extract stream URL
  const command = `yt-dlp -f bestaudio -g "https://music.youtube.com/watch?v=${videoId}"`;
  const url = await execPromise(command);
  
  return {
    url: url.trim(),
    expiresAt: Date.now() + 5 * 60 * 60 * 1000, // ~5 hours
  };
}
```

#### Caching Strategy

Stream URLs expire, so we need smart caching:

```typescript
interface CachedStream {
  videoId: string;
  url: string;
  expiresAt: number;
}

// Redis cache with TTL
await redis.setex(`ytm:stream:${videoId}`, 18000, JSON.stringify({
  url: streamUrl,
  expiresAt: Date.now() + 5 * 60 * 60 * 1000,
}));
```

#### Proxy Considerations

YouTube stream URLs are IP-locked. Options:

1. **Server-side proxy** - Lidify backend fetches and proxies the stream
2. **Client direct** - Client fetches directly (won't work if server IP differs)

For self-hosted scenarios, server-side proxy is more reliable:

```typescript
// Backend route: GET /api/stream/youtube/:videoId
app.get('/api/stream/youtube/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const streamUrl = await youtubeMusic.getStreamUrl(videoId);
  
  // Proxy the stream
  const response = await fetch(streamUrl);
  res.setHeader('Content-Type', 'audio/webm');
  response.body.pipe(res);
});
```

### Phase 3: YouTube Music Browse (Optional)

Add YouTube Music as a browse source alongside Deezer/Spotify:

- Featured playlists
- Charts
- Mood/genre playlists
- Artist pages

This would use InnerTube's `/browse` endpoint similar to OuterTune.

## Docker Integration

### Add yt-dlp to Dockerfile

```dockerfile
# Add to existing Dockerfile
RUN pip3 install --break-system-packages yt-dlp

# Or use the standalone binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp
```

### Environment Variables

```env
# YouTube Music settings
YOUTUBE_MUSIC_ENABLED=true
YOUTUBE_MUSIC_QUALITY=320  # kbps for downloads
YOUTUBE_MUSIC_FORMAT=mp3   # or opus, m4a
YOUTUBE_MUSIC_AS_FALLBACK=true  # Only use when other sources fail
```

## Quality Comparison

| Source | Max Quality | Format | Notes |
|--------|-------------|--------|-------|
| Soulseek | FLAC/Lossless | Various | Best quality, but slow/unreliable |
| Indexers | FLAC/320kbps | Various | Fast, depends on indexer |
| YouTube Music | 256kbps | AAC/OPUS | Always available, good quality |

## Matching Algorithm

To find the right YouTube Music track:

```typescript
async function findBestMatch(
  artist: string, 
  title: string, 
  album?: string,
  duration?: number
): Promise<YouTubeMusicTrack | null> {
  // Search with artist + title
  const query = `${artist} ${title}`;
  const results = await searchYouTubeMusic(query);
  
  // Score each result
  const scored = results.map(track => ({
    track,
    score: calculateMatchScore(track, { artist, title, album, duration }),
  }));
  
  // Return best match above threshold
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best?.score > 0.8 ? best.track : null;
}

function calculateMatchScore(track: YouTubeMusicTrack, target: TargetTrack): number {
  let score = 0;
  
  // Title similarity (most important)
  score += stringSimilarity(track.title, target.title) * 0.4;
  
  // Artist similarity
  score += stringSimilarity(track.artist, target.artist) * 0.3;
  
  // Duration match (within 5 seconds)
  if (target.duration && Math.abs(track.duration - target.duration) < 5) {
    score += 0.2;
  }
  
  // Album match (bonus)
  if (target.album && track.album) {
    score += stringSimilarity(track.album, target.album) * 0.1;
  }
  
  return score;
}
```

## Legal Considerations

**Disclaimer**: Downloading copyrighted content without authorization may violate YouTube's Terms of Service and copyright law in your jurisdiction.

This feature is intended for:
- Personal use / fair use scenarios
- Backing up content you have rights to
- Educational purposes

Users are responsible for ensuring their use complies with applicable laws.

## Implementation Timeline

1. **Week 1**: Add yt-dlp to Docker, create basic YouTube Music service
2. **Week 2**: Implement search and download functionality
3. **Week 3**: Integrate as fallback in track acquisition flow
4. **Week 4**: Add streaming capability (optional)
5. **Future**: YouTube Music browse/discover features

## References

- [OuterTune Source](https://github.com/OuterTune/OuterTune) - InnerTube implementation in Kotlin
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [InnerTube API Research](https://github.com/tombulled/innertube) - Python InnerTube library
- [YouTube.js](https://github.com/LuanRT/YouTube.js) - TypeScript InnerTube implementation
