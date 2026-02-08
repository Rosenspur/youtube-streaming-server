const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const app = express();

app.use(express.json());

// --- 1. BÚSQUEDA ---
async function searchYouTube(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const match = data.match(/"videoId":"([^"]+)"/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

// --- 2. MANEJADOR DE ALEXA ---
app.post('/', async (req, res) => {
    // Validación robusta para evitar "Petición mal formada"
    if (!req.body || !req.body.request) {
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

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Poniendo ${query}` },
                directives: [{
                    type: "AudioPlayer.Play",
                    playBehavior: "REPLACE_ALL",
                    audioItem: { stream: { url: `https://${req.headers.host}/stream/${videoId}`, token: videoId, offsetInMilliseconds: 0 } }
                }],
                shouldEndSession: true
            }
        });
    }
    return res.json({ version: "1.0", response: { shouldEndSession: true } });
});

// --- 3. TÚNEL DE AUDIO (SOLUCIÓN AL ERROR 403 Y COOKIES) ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    console.log(`[TÚNEL] Iniciando flujo para: ${videoId}`);

    try {
        let agent;
        const cookieVar = process.env.YOUTUBE_COOKIES;

        // Intentamos crear el agente. Esto soluciona el "cookies must be a string"
        try {
            const parsed = JSON.parse(cookieVar);
            agent = ytdl.createAgent(parsed); 
        } catch (e) {
            // Si no es JSON, lo intentamos como string (formato Netscape)
            agent = ytdl.createAgent(cookieVar);
        }

        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            agent: agent,
            filter: 'audioonly',
            quality: 'highestaudio', // Evita el error "No such format found"
            highWaterMark: 1 << 25
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        stream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message); // Aquí veremos si persiste el 403
            if (!res.headersSent) res.status(500).end();
        });

        stream.pipe(res);
        req.on('close', () => stream.destroy());

    } catch (error) {
        console.error(`[FATAL] ${error.message}`);
        if (!res.headersSent) res.status(500).end();
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));