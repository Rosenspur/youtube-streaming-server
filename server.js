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

// --- 2. MANEJADOR DE ALEXA (CORREGIDO PARA EVITAR CRASH) ---
app.post('/', async (req, res) => {
    // FIX: Validación para evitar el error "Cannot read properties of undefined"
    if (!req.body || !req.body.session || !req.body.session.application) {
        console.log("[LOG] Petición ignorada: No viene de una sesión de Alexa válida.");
        return res.status(200).json({ version: "1.0", response: { shouldEndSession: true } });
    }

    const requestType = req.body.request.type;
    const skillId = req.body.session.application.applicationId;

    // Validación de Skill ID
    if (process.env.ALEXA_SKILL_ID && skillId !== process.env.ALEXA_SKILL_ID) {
        console.log("[ALERTA] Skill ID no coincide");
        return res.status(403).send("No autorizado");
    }

    if (requestType === 'LaunchRequest') {
        return res.json(createResponse("Sistema listo. ¿Qué canción busco?"));
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);

        if (!videoId) return res.json(createResponse("No encontré resultados."));

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

// --- 3. TÚNEL DE AUDIO (CON COOKIES Y FORMATO M4A) ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`[TÚNEL] Intentando streaming: ${videoId}`);

    try {
        const options = {
            filter: (format) => format.container === 'm4a' && !format.hasVideo,
            quality: 'lowestaudio',
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    // Importante: Asegúrate de que las cookies en Railway sean recientes
                    cookie: process.env.YOUTUBE_COOKIES || '',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            }
        };

        const bufferBridge = new PassThrough();

        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Connection', 'keep-alive');

        const stream = ytdl(videoUrl, options);

        stream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message); // Aquí verás si sigue saliendo "Sign in to confirm you're not a bot"
            bufferBridge.end();
        });

        stream.pipe(bufferBridge).pipe(res);

        req.on('close', () => {
            stream.destroy();
            bufferBridge.destroy();
        });

    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        if (!res.headers_sent) res.status(500).end();
    }
});

function createResponse(text) {
    return { version: "1.0", response: { outputSpeech: { type: "PlainText", text: text }, shouldEndSession: false } };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));