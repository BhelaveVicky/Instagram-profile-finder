const INSTAGRAM_APP_ID = '936619743392459';
const WEB_BASE = 'https://www.instagram.com';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

const isValidInstaUsername = (str: string): boolean => {
  return /^[a-zA-Z0-9._]{1,30}$/.test(str);
};

const normalizeQuery = (query: string): string => {
  const cleaned = String(query || '').trim();

  if (!cleaned) return '';

  if (cleaned.startsWith('@')) {
    return cleaned.slice(1).trim();
  }

  const instaUrlMatch = cleaned.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (instaUrlMatch?.[1]) {
    return instaUrlMatch[1];
  }

  return cleaned;
};

const extractCookies = (setCookieHeader: string | null): string => {
  if (!setCookieHeader) return '';

  return setCookieHeader
    .split(/,(?=[^;]+=[^;]+)/g)
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

const extractCsrf = (cookieHeader: string): string => {
  const match = cookieHeader.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match?.[1] || '';
};

const getSessionCookie = async (userAgent: string): Promise<string> => {
  try {
    const warmup = await fetch(`${WEB_BASE}/`, {
      method: 'GET',
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    return extractCookies(warmup.headers.get('set-cookie'));
  } catch {
    return '';
  }
};

const fetchInstagramJson = async (path: string) => {
  let lastError: any = null;

  for (const userAgent of USER_AGENTS) {
    const cookie = await getSessionCookie(userAgent);
    const csrf = extractCsrf(cookie);

    try {
      const response = await fetch(`${WEB_BASE}${path}`, {
        method: 'GET',
        headers: {
          'x-ig-app-id': INSTAGRAM_APP_ID,
          'x-requested-with': 'XMLHttpRequest',
          'user-agent': userAgent,
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          origin: WEB_BASE,
          referer: `${WEB_BASE}/`,
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrftoken': csrf } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data?.status === 'fail') {
        throw new Error(data?.message || 'Instagram API failed');
      }

      return data;
    } catch (error: any) {
      lastError = error;
    }
  }

  throw lastError || new Error('Instagram API failed');
};

const findUsernameFromSearch = async (query: string): Promise<string | null> => {
  const data = await fetchInstagramJson(`/web/search/topsearch/?query=${encodeURIComponent(query)}`);
  const users = data?.users || [];

  if (!Array.isArray(users) || users.length === 0) {
    return null;
  }

  const normalized = query.toLowerCase();
  const exact = users.find((item: any) => {
    const user = item?.user;
    const username = String(user?.username || '').toLowerCase();
    const fullName = String(user?.full_name || '').toLowerCase();
    return username === normalized || fullName === normalized;
  });

  return exact?.user?.username || users[0]?.user?.username || null;
};

const getProfileByUsername = async (username: string) => {
  const data = await fetchInstagramJson(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
  const user = data?.data?.user;

  if (!user) {
    throw new Error('User not found');
  }

  const profilePic =
    user.profile_pic_url_hd ||
    user.profile_pic_url ||
    user.hd_profile_pic_url_info?.url ||
    `https://unavatar.io/instagram/${encodeURIComponent(user.username)}`;

  return {
    name: user.full_name || user.username,
    bio: user.biography || 'Instagram profile found.',
    url: `https://www.instagram.com/${user.username}/`,
    username: user.username,
    profilePic,
    followers: user.edge_followed_by?.count,
    following: user.edge_follow?.count,
    posts: user.edge_owner_to_timeline_media?.count,
    isPrivate: user.is_private,
  };
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const normalizedQuery = normalizeQuery(req.query?.query || '');

    if (!normalizedQuery) {
      return res.status(400).json({ error: 'Please enter a valid Instagram username.' });
    }

    let usernameToLookup = normalizedQuery;

    if (!isValidInstaUsername(usernameToLookup)) {
      const discovered = await findUsernameFromSearch(normalizedQuery);
      if (!discovered) {
        return res.status(404).json({ error: 'User not found on Instagram.' });
      }
      usernameToLookup = discovered;
    }

    const profile = await getProfileByUsername(usernameToLookup);

    return res.status(200).json({
      text: 'Live profile data fetched from Instagram.',
      profiles: [profile],
    });
  } catch (error: any) {
    const status = String(error?.message || '').toLowerCase();

    if (status.includes('not found') || status.includes('404')) {
      return res.status(404).json({ error: 'User not found on Instagram.' });
    }

    return res.status(502).json({ error: 'Live Instagram data could not be fetched right now. Try again.' });
  }
}
