import { useCallback } from 'react';
import { api } from '@/lib/api';
import { useAudio } from '@/lib/audio-context';
import { Track as AudioTrack } from '@/lib/audio-state-context';
import { Artist, Album, Track } from '../types';

type LibraryAlbumTrack = {
  id: string;
  title: string;
  duration: number;
  trackNumber?: number;
  filePath?: string;
};

type AlbumWithTracks = {
  tracks?: LibraryAlbumTrack[];
};

type QueueTrack = AudioTrack & {
  trackNumber: number;
};

export function useArtistActions() {
  const { playTrack: playTrackFromContext, playTracks } = useAudio();

  // Helper to load all tracks from owned albums
  const loadAllOwnedTracks = async (artist: Artist, albums: Album[]) => {
    // Get owned albums sorted by year (newest first)
    const ownedAlbums = albums
      .filter((album) => album.owned)
      .sort((a, b) => (b.year || 0) - (a.year || 0));

    if (ownedAlbums.length === 0) {
      return [];
    }

    // Load tracks from all owned albums in parallel
    const albumDataPromises = ownedAlbums.map(async (album) => {
      try {
        const response = await api.getAlbum(album.id);
        return response as AlbumWithTracks;
      } catch {
        return null;
      }
    });

    const albumsData = await Promise.all(albumDataPromises);

    // Combine all tracks, maintaining album order (newest first)
    const allTracks: AudioTrack[] = [];

    albumsData.forEach((albumData, index) => {
      if (!albumData || !albumData.tracks) return;

      const album = ownedAlbums[index];
      const formattedTracks: QueueTrack[] = albumData.tracks.map((track) => {
        const trackNumber = track.trackNumber ?? 0;
        return {
          id: track.id,
          title: track.title,
          trackNumber,
          artist: { name: artist.name, id: artist.id },
          album: {
            title: album.title,
            coverArt: album.coverArt,
            id: album.id,
          },
          duration: track.duration,
          filePath: track.filePath, // Include filePath to use local streaming
        };
      });

      // Sort tracks within album by track number
      formattedTracks.sort((a, b) => a.trackNumber - b.trackNumber);
      allTracks.push(...formattedTracks);
    });

    return allTracks;
  };

  const playAll = useCallback(
    async (artist: Artist | null, albums: Album[]) => {
      if (!artist) {
        return;
      }

      try {
        const allTracks = await loadAllOwnedTracks(artist, albums);

        if (allTracks.length === 0) {
          return;
        }

        // Play tracks in order (newest album first, track 1 to end, then next album)
        playTracks(allTracks);
      } catch (error: unknown) {
        console.error('Failed to play artist:', error);
      }
    },
    [playTracks]
  );

  const shufflePlay = useCallback(
    async (artist: Artist | null, albums: Album[]) => {
      if (!artist) {
        return;
      }

      try {
        const allTracks = await loadAllOwnedTracks(artist, albums);

        if (allTracks.length === 0) {
          return;
        }

        // Shuffle all tracks randomly
        const shuffledTracks = [...allTracks].sort(() => Math.random() - 0.5);

        playTracks(shuffledTracks);
      } catch (error: unknown) {
        console.error('Failed to shuffle play artist:', error);
      }
    },
    [playTracks]
  );

  const playTrack = useCallback(
    (track: Track, artist: Artist) => {
      try {
        // Format track for audio context
        const formattedTrack = {
          id: track.id,
          title: track.title,
          artist: { name: artist.name, id: artist.id },
          album: {
            title: track.album?.title || 'Unknown Album',
            coverArt: track.album?.coverArt,
            id: track.album?.id,
          },
          duration: track.duration,
          filePath: track.filePath, // Include filePath to use local streaming
        };

        playTrackFromContext(formattedTrack);
        } catch (error: unknown) {
          console.error('Failed to play track:', error);
        }
    },
    [playTrackFromContext]
  );

  return {
    playAll,
    shufflePlay,
    playTrack,
  };
}
