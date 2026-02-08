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
    } catch (e) { return null; }
}

// --- 2. MANEJADOR DE ALEXA ---
app.post('/', async (req, res) => {
    if (!req.body || !req.body.session || !req.body.session.application) {
        console.log("[LOG] Petición no reconocida o mal formada de Alexa."); // Visto en logs
        return res.status(200).json({ version: "1.0", response: { shouldEndSession: true } });
    }

    const requestType = req.body.request.type;
    if (requestType === 'LaunchRequest') {
        return res.json({ version: "1.0", response: { outputSpeech: { type: "PlainText", text: "Listo. ¿Qué escuchamos?" }, shouldEndSession: false } });
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

// --- 3. TÚNEL DE AUDIO (FIX: cookies must be a string) ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    console.log(`[TÚNEL] Iniciando flujo para: ${videoId}`);

    try {
        // Creamos el agente de seguridad con tus cookies JSON para saltar el error de BOT
        let agent;
        try {
            const cookieData = JSON.parse(process.env.YOUTUBE_COOKIES);
            agent = ytdl.createAgent(cookieData); 
        } catch (e) {
            console.error("Error al crear agente de cookies:", e.message);
        }

        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            agent: agent, // Usamos el agente oficial para evitar el error 403
            filter: 'audioonly',
            quality: 'highestaudio', // Evita el error "No such format found"
            highWaterMark: 1 << 25
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        
        stream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message);
            if (!res.headersSent) res.status(500).end();
        });

        stream.pipe(res);

        req.on('close', () => { stream.destroy(); });

    } catch (error) {
        console.error(`[FATAL] ${error.message}`);
        if (!res.headersSent) res.status(500).end();
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));