const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const { PassThrough } = require('stream');
const app = express();

app.use(express.json());

// --- 1. FUNCIÓN DE BÚSQUEDA ---
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

// --- 2. MANEJADOR DE ALEXA (SOLUCIÓN AL ERROR 'APPLICATION') ---
app.post('/', async (req, res) => {
    // Validación crítica para evitar el TypeError visto en logs
    if (!req.body || !req.body.session || !req.body.session.application) {
        console.log("[LOG] Petición no reconocida o mal formada de Alexa.");
        return res.status(200).json({ version: "1.0", response: { shouldEndSession: true } });
    }

    const requestType = req.body.request.type;

    if (requestType === 'LaunchRequest') {
        return res.json(createResponse("¡Hola! Soy tu servidor de música. ¿Qué canción quieres escuchar?"));
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);

        if (!videoId) return res.json(createResponse("No encontré ese video en YouTube."));

        const myServerUrl = `https://${req.headers.host}/stream/${videoId}`;

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Buscando y reproduciendo ${query}` },
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

// --- 3. TÚNEL DE AUDIO (SOLUCIÓN AL ERROR 'BOT' Y 'FORMAT') ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`[TÚNEL] Iniciando flujo para: ${videoId}`);

    try {
        // Parseamos las cookies del formato JSON Array para evitar el error 403
        let cookies;
        try {
            cookies = JSON.parse(process.env.YOUTUBE_COOKIES);
        } catch (e) {
            cookies = process.env.YOUTUBE_COOKIES; // Si no es JSON, se usa como texto plano
        }

        const options = {
            filter: 'audioonly',
            quality: 'highestaudio', // FIX: Evita el error "No such format found"
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    cookie: cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            }
        };

        res.setHeader('Content-Type', 'audio/mpeg');
        const bufferBridge = new PassThrough();
        const stream = ytdl(videoUrl, options);

        stream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message); // Monitorea aquí el bloqueo de bot
            if (!res.headersSent) res.status(500).end();
        });

        stream.pipe(bufferBridge).pipe(res);

        req.on('close', () => {
            stream.destroy();
            bufferBridge.destroy();
        });

    } catch (error) {
        console.error(`[STREAM ERROR] ${error.message}`);
        if (!res.headersSent) res.status(500).send("Error de streaming");
    }
});

function createResponse(text) {
    return { version: "1.0", response: { outputSpeech: { type: "PlainText", text: text }, shouldEndSession: false } };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));