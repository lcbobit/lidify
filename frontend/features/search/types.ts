export type FilterTab = "all" | "library" | "discover" | "soulseek";

export interface Artist {
    id: string;
    name: string;
    heroUrl?: string;
    mbid?: string;
    image?: string;
}

export interface Album {
    id: string;
    title: string;
    coverUrl?: string;
    albumId?: string;
    artist?: {
        name: string;
    };
}

export interface Podcast {
    id: string;
    title: string;
    author?: string;
    imageUrl?: string;
    episodeCount?: number;
}

export interface LibraryTrack {
    id: string;
    title: string;
    duration: number;
    filePath?: string;
    album: {
        id: string;
        title: string;
        coverUrl?: string | null;
        artist: {
            id: string;
            mbid?: string;
            name: string;
        };
    };
}

export interface SearchResult {
    artists?: Artist[];
    albums?: Album[];
    podcasts?: Podcast[];
    tracks?: LibraryTrack[];
}

export interface DiscoverResult {
    type: "music" | "podcast";
    id?: string;
    name: string;
    mbid?: string;
    image?: string;
}

export interface SoulseekResult {
    username: string;
    path: string;
    filename: string;
    size: number;
    bitrate: number;
    format: string;
    parsedArtist?: string;
    parsedAlbum?: string;
}
