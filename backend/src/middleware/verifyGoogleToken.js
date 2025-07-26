import { OAuth2Client } from 'google-auth-library';
// 請改成你的 Google OAuth Client ID
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    req.user = payload; // 把解析後的使用者資訊放到 req.user
    next();
  } catch (error) {
    console.error('Google token verification failed:', error.message);
    res.status(401).json({ error: 'Unauthorized (invalid Google token)' });
  }
}

export default verifyGoogleToken;
