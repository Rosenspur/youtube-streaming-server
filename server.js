const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const { PassThrough } = require('stream');
const app = express();

app.use(express.json());

async function searchYouTube(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url);
        const match = data.match(/"videoId":"([^"]+)"/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

app.post('/', async (req, res) => {
    // Protección contra crash confirmada en logs
    if (!req.body || !req.body.session || !req.body.session.application) {
        console.log("[LOG] Petición ignorada: No viene de una sesión de Alexa válida.");
        return res.status(200).json({ version: "1.0", response: { shouldEndSession: true } });
    }

    const requestType = req.body.request.type;
    if (requestType === 'LaunchRequest') {
        return res.json({ version: "1.0", response: { outputSpeech: { type: "PlainText", text: "Listo. ¿Qué quieres oír?" }, shouldEndSession: false } });
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);
        if (!videoId) return res.json({ version: "1.0", response: { outputSpeech: { type: "PlainText", text: "No lo encontré." } } });

        const myServerUrl = `https://${req.headers.host}/stream/${videoId}`;
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Poniendo ${query}` },
                directives: [{
                    type: "AudioPlayer.Play",
                    playBehavior: "REPLACE_ALL",
                    audioItem: { stream: { url: myServerUrl, token: videoId, offsetInMilliseconds: 0 } }
                }],
                shouldEndSession: true
            }
        });
    }
    return res.json({ version: "1.0", response: { shouldEndSession: true } });
});

app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    console.log(`[TÚNEL] Intentando streaming: ${videoId}`);

    try {
        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            filter: 'audioonly',
            quality: 'highestaudio', // Cambiado para evitar el error "No such format"
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    cookie: process.env.YOUTUBE_COOKIES || '',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            }
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        stream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message);
        });
        stream.pipe(res);
    } catch (error) {
        res.status(500).end();
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));