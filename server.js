const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const { PassThrough } = require('stream');
const app = express();

app.use(express.json());

// --- 1. BÚSQUEDA DE VIDEO ID ---
async function searchYouTube(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url);
        const match = data.match(/"videoId":"([^"]+)"/);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

// --- 2. MANEJADOR DE ALEXA ---
app.post('/', async (req, res) => {
    if (!req.body || !req.body.request) return res.status(400).send("Inválido");

    const requestType = req.body.request.type;

    if (req.body.session && req.body.session.application) {
        const skillId = req.body.session.application.applicationId;
        if (process.env.ALEXA_SKILL_ID && skillId !== process.env.ALEXA_SKILL_ID) {
            return res.status(403).send("No autorizado");
        }
    }

    if (requestType === 'LaunchRequest') {
        return res.json(createResponse("Sistema de audio listo. ¿Qué canción busco?"));
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);

        if (!videoId) return res.json(createResponse("Lo siento, no encontré resultados."));

        const myServerUrl = `https://${req.headers.host}/stream/${videoId}`;

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Reproduciendo ${query}` },
                directives: [{
                    type: "AudioPlayer.Play",
                    playBehavior: "REPLACE_ALL",
                    audioItem: {
                        stream: {
                            url: myServerUrl,
                            token: videoId,
                            offsetInMilliseconds: 0
                        }
                    }
                }],
                shouldEndSession: true
            }
        });
    }
    return res.json({ version: "1.0", response: { shouldEndSession: true } });
});

// --- 3. TÚNEL DE AUDIO M4A (MÁXIMA COMPATIBILIDAD) ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`[STREAMING] Intentando flujo M4A para: ${videoId}`);

    try {
        const audioStream = ytdl(videoUrl, {
            filter: (format) => format.container === 'm4a' && !format.hasVideo,
            quality: 'lowestaudio',
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    cookie: process.env.YOUTUBE_COOKIES || '',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            }
        });

        const bufferBridge = new PassThrough();

        // Cabeceras específicas para evitar que Alexa corte el flujo
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Connection', 'keep-alive');

        audioStream.pipe(bufferBridge).pipe(res);

        audioStream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message);
            bufferBridge.end();
        });

        req.on('close', () => {
            audioStream.destroy();
            bufferBridge.destroy();
            console.log(`[LOG] Streaming finalizado o cancelado.`);
        });

    } catch (error) {
        console.error(`[FATAL ERROR] ${error.message}`);
        if (!res.headersSent) res.status(500).end();
    }
});

function createResponse(text) {
    return { version: "1.0", response: { outputSpeech: { type: "PlainText", text: text }, shouldEndSession: false } };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));