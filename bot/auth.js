const crypto = require('crypto');

// Simple JWT-like token using HMAC
const SECRET = process.env.JWT_SECRET || 'shopbot_jwt_secret_2024';

function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + (24 * 60 * 60 * 1000) // 24 jam
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig  = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64').toString());
    if (payload.exp < Date.now()) return null; // expired
    return payload;
  } catch { return null; }
}

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  const user  = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: 'Token tidak valid atau expired' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden', message: 'Hanya admin yang bisa akses' });
  next();
}

module.exports = { generateToken, verifyToken, authMiddleware, adminOnly };
