# Lidify Quick Start

All-in-one Docker deployment with embedded PostgreSQL, Redis, and audio analyzer.

## Quick Start (Pre-built Image)

```bash
# 1. Create a folder for Lidify
mkdir -p ~/compose/lidify && cd ~/compose/lidify

# 2. Download docker-compose.yml
curl -O https://raw.githubusercontent.com/fjordnode/lidify/main/examples/docker-compose.yml

# 3. Edit docker-compose.yml
#    - Set your music library path (/path/to/your/music)
#    - Set your data directory path (/path/to/appdata/lidify)
#    - Set your timezone

# 4. Start Lidify
docker compose up -d

# 5. Open http://localhost:3030
```

## Optional: API Keys

For AI recommendations and artist bios, create a `.env` file:

```bash
curl -O https://raw.githubusercontent.com/fjordnode/lidify/main/examples/.env.example
mv .env.example .env
# Edit .env and add your API keys
```

| Key | Purpose | Get it at |
|-----|---------|-----------|
| `OPENROUTER_API_KEY` | AI Weekly recommendations | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `LASTFM_API_KEY` | Artist/album bios | [last.fm/api](https://www.last.fm/api/account/create) |

## Building from Source (Optional)

```bash
# Clone and build
git clone https://github.com/fjordnode/lidify.git
cd lidify
docker build -t lidify:latest .

# Then in docker-compose.yml, change image line to:
# image: lidify:latest
```

## Volumes

| Container Path | Purpose |
|----------------|---------|
| `/music` | Your music library (read-only) |
| `/data` | Database, cache, logs (read-write) |

## Ports

| Port | Service |
|------|---------|
| 3030 | Web UI |
| 3006 | API (optional) |
