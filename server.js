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
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const match = data.match(/"videoId":"([^"]+)"/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

// --- 2. MANEJADOR DE ALEXA (SOLUCIÓN A PETICIONES MALFORMADAS) ---
app.post('/', async (req, res) => {
    // Evita el crash que vimos en los logs de las 14:24 y 14:26
    if (!req.body || !req.body.request) {
        console.log("[LOG] Petición no reconocida o mal formada de Alexa.");
        return res.status(200).json({ version: "1.0", response: { shouldEndSession: true } });
    }

    const requestType = req.body.request.type;

    if (requestType === 'LaunchRequest') {
        return res.json({ version: "1.0", response: { outputSpeech: { type: "PlainText", text: "Servidor musical listo. ¿Qué canción buscamos?" }, shouldEndSession: false } });
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);
        
        if (!videoId) {
            return res.json({ version: "1.0", response: { outputSpeech: { type: "PlainText", text: "No encontré resultados." }, shouldEndSession: true } });
        }

        const streamUrl = `https://${req.headers.host}/stream/${videoId}`;
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Reproduciendo ${query}` },
                directives: [{
                    type: "AudioPlayer.Play",
                    playBehavior: "REPLACE_ALL",
                    audioItem: { stream: { url: streamUrl, token: videoId, offsetInMilliseconds: 0 } }
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
        const rawCookies = process.env.YOUTUBE_COOKIES;

        try {
            // Si es JSON (la línea larga que te pasé), lo parseamos
            const cookieData = JSON.parse(rawCookies);
            agent = ytdl.createAgent(cookieData);
        } catch (e) {
            // Si no es JSON (formato Netscape), lo usamos como string
            agent = ytdl.createAgent(rawCookies);
        }

        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            agent: agent,
            filter: 'audioonly',
            quality: 'highestaudio', // FIX: Evita el error 'lowestaudio'
            highWaterMark: 1 << 25
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        
        stream.on('error', (err) => {
            // Aquí monitoreamos el Status 403 visto en logs
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