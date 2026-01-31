# Plan: Per-Podcast Access Tokens for M3U URLs

## Problem
External podcast apps can't authenticate via session/headers. They need a URL with embedded auth that:
- Doesn't expire (podcast apps fetch periodically forever)
- Is revocable (if leaked, user can regenerate)
- Has limited scope (only grants access to one podcast)

## Solution
Add a unique `accessToken` to each `PodcastSubscription`. Token is included in M3U URL and validates access to that specific podcast for that user.

```
https://lidify.denshi.dev/api/podcasts/{id}/playlist.m3u?token=ptkn_clx7abc123...
```

---

## Implementation

### 1. Schema Change
**File:** `backend/prisma/schema.prisma`

```prisma
model PodcastSubscription {
  userId        String
  podcastId     String
  subscribedAt  DateTime @default(now())
  autoDownload  Boolean  @default(false)
  autoRemoveAds Boolean  @default(false)

  // Per-subscription access token for external podcast apps
  accessToken   String?  @unique

  user    User    @relation(...)
  podcast Podcast @relation(...)

  @@id([userId, podcastId])
}
```

### 2. Migration
**File:** `backend/prisma/migrations/20260121200000_add_podcast_access_token/migration.sql`

```sql
-- AlterTable
ALTER TABLE "PodcastSubscription" ADD COLUMN "accessToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PodcastSubscription_accessToken_key" ON "PodcastSubscription"("accessToken");
```

### 3. Token Generation Helper
**File:** `backend/src/utils/podcastToken.ts` (new)

```typescript
import crypto from "crypto";

// Generate a unique podcast access token
export function generatePodcastToken(): string {
    // Format: ptkn_<32 random chars>
    return `ptkn_${crypto.randomBytes(16).toString("hex")}`;
}
```

### 4. Generate Token on Subscribe
**File:** `backend/src/routes/podcasts.ts`

In the subscribe endpoint, generate token when creating subscription:

```typescript
const subscription = await prisma.podcastSubscription.create({
    data: {
        userId: req.user!.id,
        podcastId: podcast.id,
        accessToken: generatePodcastToken(),
    },
});
```

### 5. Backfill Existing Subscriptions
**File:** `backend/src/routes/podcasts.ts`

When copying M3U (or on GET podcast), generate token if missing:

```typescript
// Ensure subscription has an access token
if (!subscription.accessToken) {
    await prisma.podcastSubscription.update({
        where: { userId_podcastId: { userId, podcastId } },
        data: { accessToken: generatePodcastToken() },
    });
}
```

### 6. Validate Token in M3U Endpoint
**File:** `backend/src/routes/podcasts.ts`

Update `GET /:id/playlist.m3u` to accept podcast token:

```typescript
router.get("/:id/playlist.m3u", async (req, res) => {
    const podcastId = req.params.id;
    const token = req.query.token as string;

    let subscription;

    if (token?.startsWith("ptkn_")) {
        // Podcast-specific token auth
        subscription = await prisma.podcastSubscription.findFirst({
            where: { podcastId, accessToken: token },
            include: { podcast: { include: { episodes: ... } } },
        });

        if (!subscription) {
            return res.status(401).send("#EXTM3U\n# Invalid token\n");
        }
    } else if (req.user) {
        // Session/JWT auth (existing flow)
        subscription = await prisma.podcastSubscription.findUnique({
            where: { userId_podcastId: { userId: req.user.id, podcastId } },
            ...
        });
    } else {
        return res.status(401).send("#EXTM3U\n# Authentication required\n");
    }

    // Continue with M3U generation...
});
```

### 7. Validate Token in Stream Endpoint
**File:** `backend/src/routes/podcasts.ts`

Episode streams also need token validation:

```typescript
router.get("/:podcastId/episodes/:episodeId/stream", async (req, res) => {
    const { podcastId, episodeId } = req.params;
    const token = req.query.token as string;

    // Accept podcast token or regular auth
    if (token?.startsWith("ptkn_")) {
        const subscription = await prisma.podcastSubscription.findFirst({
            where: { podcastId, accessToken: token },
        });
        if (!subscription) {
            return res.status(401).json({ error: "Invalid token" });
        }
        // Set req.user for downstream compatibility
        req.user = await prisma.user.findUnique({ where: { id: subscription.userId } });
    }

    // Continue with existing stream logic...
});
```

### 8. Return Token in GET Endpoints
**File:** `backend/src/routes/podcasts.ts`

Include `accessToken` in podcast responses so frontend can use it:

```typescript
// In GET /podcasts list
return {
    ...podcast,
    accessToken: sub.accessToken,
};

// In GET /podcasts/:id
return {
    ...podcast,
    accessToken: subscription.accessToken,
};
```

### 9. Frontend: Copy URL with Token
**File:** `frontend/features/podcast/components/PodcastActionBar.tsx`

Update `handleCopyM3U` to include the token:

```typescript
interface PodcastActionBarProps {
    // ... existing props
    accessToken?: string;
}

const handleCopyM3U = async () => {
    const baseUrl = window.location.origin;
    const m3uUrl = accessToken
        ? `${baseUrl}/api/podcasts/${podcastId}/playlist.m3u?token=${accessToken}`
        : `${baseUrl}/api/podcasts/${podcastId}/playlist.m3u`;

    await navigator.clipboard.writeText(m3uUrl);
};
```

### 10. Frontend: Pass Token to Component
**File:** `frontend/app/podcasts/[id]/page.tsx`

```typescript
<PodcastActionBar
    ...
    accessToken={podcast?.accessToken}
/>
```

### 11. Update Podcast Type
**File:** `frontend/features/podcast/types.ts`

```typescript
export interface Podcast {
    // ... existing fields
    accessToken?: string;
}
```

---

## Optional: Regenerate Token

Add endpoint to regenerate token if user wants to revoke access:

**Endpoint:** `POST /podcasts/:id/regenerate-token`

```typescript
router.post("/:id/regenerate-token", requireAuth, async (req, res) => {
    const newToken = generatePodcastToken();

    await prisma.podcastSubscription.update({
        where: { userId_podcastId: { userId: req.user!.id, podcastId: req.params.id } },
        data: { accessToken: newToken },
    });

    res.json({ accessToken: newToken });
});
```

UI: Small "regenerate" icon next to M3U button (shows after copy, or in a tooltip).

---

## Files to Modify

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `accessToken` field |
| `backend/prisma/migrations/...` | Migration SQL |
| `backend/src/utils/podcastToken.ts` | New: token generator |
| `backend/src/routes/podcasts.ts` | Token gen on subscribe, validation in M3U/stream, return in GET |
| `frontend/features/podcast/types.ts` | Add `accessToken` to Podcast type |
| `frontend/features/podcast/components/PodcastActionBar.tsx` | Include token in copied URL |
| `frontend/app/podcasts/[id]/page.tsx` | Pass `accessToken` prop |

---

## Verification

1. Subscribe to a podcast → verify `accessToken` is generated in DB
2. Open podcast page → copy M3U link → verify URL includes `?token=ptkn_...`
3. Paste M3U URL in browser (logged out) → should return valid M3U
4. Try with wrong token → should return 401
5. Play episode from M3U in VLC → should stream successfully
6. Regenerate token → old URL should fail, new one works

---

## Security Notes

- Token prefix `ptkn_` distinguishes from JWT tokens
- Tokens are per-user-per-podcast: leaking one doesn't expose other podcasts
- Tokens can be regenerated to revoke access
- Tokens are stored hashed? (optional, adds complexity)
- Rate limiting on token validation to prevent brute force (existing middleware)
