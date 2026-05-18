const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');
const admin = require('firebase-admin');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// Auth check helper
const checkAuth = (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader ||
      authHeader !== `Bearer ${process.env.APP_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

// Is line ko change karein:
const { EdgeTTS } = require('node-edge-tts');

app.post('/tts', async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;

    const { text, voice } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'text is required' });
    }

    const cleanText = text
      .replace(/\*+/g, '')
      .replace(/#+/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    // English ke liye Emma select hogi jo bahut calm aur beautiful female voice hai
    const selectedVoice = voice || 'en-US-EmmaNeural';

    // ✅ Ab ye error nahi dega kyunki top par destructuring use ki hai
    const tts = new EdgeTTS();

    // Temp file mein save karo
    const tmpFile = path.join('/tmp', `tts_${Date.now()}.mp3`);

    await tts.ttsPromise(cleanText, tmpFile, {
      voice: selectedVoice,
      rate: '-5%',
      pitch: '-2Hz',
    });

    // File read karke bhejo
    const audioBuffer = fs.readFileSync(tmpFile);

    // Cleanup
    fs.unlinkSync(tmpFile);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache',
    });

    res.send(audioBuffer);
  } catch (e) {
    console.error('TTS error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Available voices list ────────────────────────────
app.get('/tts/voices', async (req, res) => {
  try {
    // Best natural female voices
    const voices = [
      {
        id: 'en-US-AriaNeural',
        name: 'Aria',
        style: 'Calm & Natural (Recommended)',
        gender: 'Female',
      },
      {
        id: 'en-US-JennyNeural',
        name: 'Jenny',
        style: 'Friendly & Clear',
        gender: 'Female',
      },
      {
        id: 'en-US-MichelleNeural',
        name: 'Michelle',
        style: 'Warm & Professional',
        gender: 'Female',
      },
      {
        id: 'en-GB-SoniaNeural',
        name: 'Sonia',
        style: 'British & Elegant',
        gender: 'Female',
      },
      {
        id: 'en-IN-NeerjaNeural',
        name: 'Neerja',
        style: 'Indian English',
        gender: 'Female',
      },
    ];
    res.json(voices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Gemini call helper
const callGemini = async (systemPrompt, contents) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: contents,
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 150,
          stopSequences: ['*', '**'],
        },
      }),
    }
  );

  const data = await response.json();

  // Clean asterisks
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
    data.candidates[0].content.parts[0].text =
      data.candidates[0].content.parts[0].text
        .replace(/\*+/g, '')
        .replace(/#+/g, '')
        .replace(/_{2,}/g, '')
        .trim();
  }

  return data;
};

// Final system prompt — jab ready ho tab yahan daalo
const getFinalPrompt = (userName, userLevel) => {
  return `You are Maya, a warm and friendly human English conversation partner. You are NOT an AI or chatbot — never say you are an AI, a language model, or a bot under any circumstances.

Your personality:
- Warm, encouraging, and genuinely curious about the user
- Speak like a real friend who happens to be great at English
- Never robotic or formal

Your job is to help ${userName || 'the user'} (${userLevel || 'intermediate'} level) practice English conversation naturally.

Strict rules:
- NEVER use asterisks (*), markdown, bullet points, or formatting of any kind
- Write in plain conversational text only
- Each sentence goes on its own line with a blank line between thoughts
- Keep each response to 2-3 short sentences maximum
- Always end with ONE simple follow-up question related to what they said
- If the user makes a grammar mistake, gently correct it in a natural way like a friend would. Example: Oh nice! By the way, we say I went not I go here. So where did you go exactly?
- If they ask who you are, say you are Maya, their English practice friend
- React naturally and show genuine interest in what they say
- NEVER start your response with I — vary your sentence starters`;
};

// ─────────────────────────────────────────────────────
// METHOD 1 — /gemini
// Flutter se apna khud ka prompt pass karo
// Testing ke liye — jab prompt finalize kar rahe ho
// ─────────────────────────────────────────────────────
app.post('/gemini', async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;

    const { contents, systemPrompt, userName, userLevel } = req.body;

    // Agar systemPrompt flutter se aaya to use karo
    // Warna default final prompt use karo
    const prompt = systemPrompt
      ? systemPrompt
      : getFinalPrompt(userName, userLevel);

    const data = await callGemini(prompt, contents);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────
// METHOD 2 — /gemini-with-prompt
// Sirf testing ke liye
// Flutter se poora custom prompt bhejo
// Koi bhi prompt test kar sako bina Render deploy kiye
// ─────────────────────────────────────────────────────
app.post('/gemini-with-prompt', async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;

    const { contents, systemPrompt } = req.body;

    if (!systemPrompt) {
      return res.status(400).json({
        error: 'systemPrompt is required for this endpoint'
      });
    }

    const data = await callGemini(systemPrompt, contents);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', endpoints: ['/gemini', '/gemini-with-prompt', '/token', '/notify'] });
});

// Livekit token
app.post('/token', async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;

    const { roomId, userId, userName } = req.body;

    if (!roomId || !userId) {
      return res.status(400).json({
        error: 'roomId and userId are required'
      });
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

// Send notification
app.post('/notify', async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;

    const { fcmToken, title, body, data } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        error: 'fcmToken is required'
      });
    }

    await admin.messaging().send({
      token: fcmToken,
      notification: { title: title || 'SpeakUp', body: body || '' },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'speakup_channel',
        },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

/*const express = require('express');
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
});*/
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
