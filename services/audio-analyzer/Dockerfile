# Audio Analyzer Service - Essentia with TensorFlow (Discogs EfficientNet)
# Using Ubuntu 20.04 with Python 3.8 for essentia-tensorflow compatibility
FROM ubuntu:20.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip3 install --upgrade pip setuptools wheel

WORKDIR /app

# Install essentia-tensorflow (includes TensorFlow + Effnet/Discogs support)
RUN pip3 install --no-cache-dir essentia-tensorflow

# Verify TensorflowPredictEffnetDiscogs is available
RUN python3 -c "from essentia.standard import TensorflowPredictEffnetDiscogs, TensorflowPredict2D; print('EffnetDiscogs and TensorflowPredict2D: OK')"

# Create models directory
RUN mkdir -p /app/models

# Download Discogs EfficientNet models from essentia.upf.edu/models/
# Base embedding model
RUN curl -L -o /app/models/discogs-effnet-bs64-1.pb \
    "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"

# Mood classification heads (Discogs EfficientNet embeddings)
RUN curl -L -o /app/models/mood_happy-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_happy/mood_happy-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_sad-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_sad/mood_sad-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_relaxed-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_relaxed/mood_relaxed-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_aggressive-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_party-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_party/mood_party-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_acoustic-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_acoustic/mood_acoustic-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_electronic-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_electronic/mood_electronic-discogs-effnet-1.pb"

# Other classification heads
RUN curl -L -o /app/models/danceability-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/danceability/danceability-discogs-effnet-1.pb" && \
    curl -L -o /app/models/voice_instrumental-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_arousal-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_arousal/mood_arousal-discogs-effnet-1.pb" && \
    curl -L -o /app/models/mood_valence-discogs-effnet-1.pb \
    "https://essentia.upf.edu/models/classification-heads/mood_valence/mood_valence-discogs-effnet-1.pb"

# Verify models downloaded
RUN echo "Models downloaded:" && ls -lh /app/models/

# Install other dependencies
RUN pip3 install --no-cache-dir redis psycopg2-binary sqlalchemy python-dotenv 'numpy>=1.19.0,<2.0.0'

# Copy application code
COPY analyzer.py .

# Create non-root user
RUN useradd -m -u 1000 analyzer && \
    chown -R analyzer:analyzer /app

USER analyzer

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python3 -c "from essentia.standard import TensorflowPredictEffnetDiscogs; print('OK')" || exit 1

CMD ["python3", "analyzer.py"]
