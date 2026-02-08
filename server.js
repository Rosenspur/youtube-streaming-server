const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
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
        console.error("Error en búsqueda:", e.message);
        return null;
    }
}

// --- 2. MANEJADOR DE ALEXA ---
app.post('/', async (req, res) => {
    // Evita el error "Cannot read properties of undefined"
    if (!req.body || !req.body.request) {
        return res.status(400).send("Petición inválida");
    }

    const requestType = req.body.request.type;

    // Validación de Skill ID (solo si existe sesión)
    if (req.body.session && req.body.session.application) {
        const skillId = req.body.session.application.applicationId;
        if (process.env.ALEXA_SKILL_ID && skillId !== process.env.ALEXA_SKILL_ID) {
            return res.status(403).send("No autorizado");
        }
    }

    if (requestType === 'LaunchRequest') {
        return res.json(createResponse("Servidor de música listo. ¿Qué quieres escuchar?"));
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);

        if (!videoId) return res.json(createResponse("No encontré ese video."));

        // Genera la URL de streaming usando el host actual
        const myServerUrl = `https://${req.headers.host}/stream/${videoId}`;

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Tocando ${query}` },
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

// --- 3. TÚNEL DE AUDIO OPTIMIZADO ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`[TÚNEL] Streaming video: ${videoId}`);

    try {
        const options = {
            filter: 'audioonly',
            quality: 'lowestaudio', // Menor peso = menor lag
            highWaterMark: 1 << 25, // Buffer de 32MB para evitar cortes
            requestOptions: {
                headers: {
                    cookie: process.env.YOUTUBE_COOKIES || '',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        };

        res.setHeader('Content-Type', 'audio/mpeg');
        
        const stream = ytdl(videoUrl, options);

        stream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message);
            if (!res.headersSent) res.status(500).end();
        });

        stream.pipe(res);

    } catch (error) {
        console.error(`[SERVER ERROR] ${error.message}`);
        if (!res.headersSent) res.status(500).send("Error de streaming");
    }
});

function createResponse(text) {
    return { version: "1.0", response: { outputSpeech: { type: "PlainText", text: text }, shouldEndSession: false } };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));