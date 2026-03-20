
import { SearchResult, InstagramProfile } from "../types";

const normalizeQuery = (query: string): string => {
  const cleaned = query.trim();

  if (!cleaned) return '';

  if (cleaned.startsWith('@')) {
    return cleaned.slice(1).trim();
  }

  const instaUrlMatch = cleaned.match(/instagram\.com\/([a-zA-Z0-9\._]+)/i);
  if (instaUrlMatch?.[1]) {
    return instaUrlMatch[1];
  }

  return cleaned;
};

const withAvatarFallback = (profile: InstagramProfile): InstagramProfile => ({
  ...profile,
  profilePic: profile.profilePic || `https://unavatar.io/instagram/${encodeURIComponent(profile.username)}`,
});

export const performInstaSearch = async (query: string): Promise<SearchResult> => {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    throw new Error('Please enter a valid Instagram username.');
  }

  try {
    const response = await fetch(`/api/instagram?query=${encodeURIComponent(query)}`);

    if (!response.ok) {
      let message = 'Live Instagram data could not be fetched right now. Try again.';
      try {
        const errorJson = await response.json();
        if (errorJson?.error) {
          message = errorJson.error;
        }
      } catch {
        // ignore parse error
      }
      throw new Error(message);
    }

    const data = await response.json();
    const profile: InstagramProfile | undefined = data?.profiles?.[0];

    if (!profile) {
      throw new Error('User not found on Instagram.');
    }

    return {
      text: data?.text || 'Live profile data fetched from Instagram.',
      profiles: [withAvatarFallback(profile)],
    };
  } catch (error: any) {
    console.error('Instagram search failed:', error);

    // Dev fallback (works only locally where vite proxy exists)
    try {
      const localResponse = await fetch(`/ig-api/api/v1/users/web_profile_info/?username=${encodeURIComponent(normalizedQuery)}`);
      if (localResponse.ok) {
        const localData = await localResponse.json();
        const user = localData?.data?.user;

        if (user?.username) {
          return {
            text: 'Live profile data fetched from Instagram.',
            profiles: [
              withAvatarFallback({
                name: user.full_name || user.username,
                bio: user.biography || 'Instagram profile found.',
                url: `https://www.instagram.com/${user.username}/`,
                username: user.username,
                profilePic: user.profile_pic_url_hd || user.profile_pic_url,
                followers: user.edge_followed_by?.count,
                following: user.edge_follow?.count,
                posts: user.edge_owner_to_timeline_media?.count,
                isPrivate: user.is_private,
              }),
            ],
          };
        }
      }
    } catch {
      // ignore local fallback failure
    }

    throw new Error(error?.message || 'Live Instagram data could not be fetched right now. Try again.');
  }
};
