import jwt from 'jsonwebtoken';

const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';

export function issueToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, jwtSecret, {
    expiresIn: '7d'
  });
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
