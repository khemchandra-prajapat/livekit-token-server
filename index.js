const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin initialize karo
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Livekit token
app.post('/token', async (req, res) => {
  try {
    const { roomId, userId, userName } = req.body;

    if (!roomId || !userId) {
      return res.status(400).json({
        error: 'roomId and userId are required'
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader ||
        authHeader !== `Bearer ${process.env.APP_SECRET}`) {
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

// Send notification endpoint
app.post('/notify', async (req, res) => {
  try {
    const { fcmToken, title, body, data } = req.body;

    const authHeader = req.headers.authorization;
    if (!authHeader ||
        authHeader !== `Bearer ${process.env.APP_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!fcmToken) {
      return res.status(400).json({
        error: 'fcmToken is required'
      });
    }

    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: title || 'SpeakUp',
        body: body || '',
      },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'speakup_channel',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Gemini API endpoint add karo
app.post('/gemini', async (req, res) => {
  try {
    const { contents, systemInstruction } = req.body;

    const authHeader = req.headers.authorization;
    if (!authHeader ||
        authHeader !== `Bearer ${process.env.APP_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: systemInstruction,
          contents: contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 200,
          },
        }),
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
//const express = require('express');
//const cors = require('cors');
//const { AccessToken } = require('livekit-server-sdk');
//
//const app = express();
//app.use(cors());
//app.use(express.json());
//
//const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
//const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
//
//app.get('/health', (req, res) => {
//  res.json({ status: 'ok' });
//});
//
//app.post('/token', async (req, res) => {
//  try {
//    const { roomId, userId, userName } = req.body;
//
//    if (!roomId || !userId) {
//      return res.status(400).json({
//        error: 'roomId and userId are required'
//      });
//    }
//
//    // Auth check — sirf valid requests allow karo
//    const authHeader = req.headers.authorization;
//    if (!authHeader || authHeader !== `Bearer ${process.env.APP_SECRET}`) {
//      return res.status(401).json({ error: 'Unauthorized' });
//    }
//
//    const token = new AccessToken(
//      LIVEKIT_API_KEY,
//      LIVEKIT_API_SECRET,
//      {
//        identity: userId,
//        name: userName || 'User',
//        ttl: '1h',
//      }
//    );
//
//    token.addGrant({
//      roomJoin: true,
//      room: roomId,
//      canPublish: true,
//      canSubscribe: true,
//    });
//
//    const jwt = await token.toJwt();
//    res.json({ token: jwt });
//  } catch (e) {
//    res.status(500).json({ error: e.message });
//  }
//});
//
//const PORT = process.env.PORT || 3000;
//app.listen(PORT, () => {
//  console.log(`Token server running on port ${PORT}`);
//});