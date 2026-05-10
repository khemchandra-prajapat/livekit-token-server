const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/token', async (req, res) => {
  try {
    const { roomId, userId, userName } = req.body;

    if (!roomId || !userId) {
      return res.status(400).json({
        error: 'roomId and userId are required'
      });
    }

    // Auth check — sirf valid requests allow karo
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.APP_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = new AccessToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      {
        identity: userId,
        name: userName || 'User',
        ttl: '1h',
      }
    );

    token.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();
    res.json({ token: jwt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Token server running on port ${PORT}`);
});