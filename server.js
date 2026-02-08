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
    } catch (e) { return null; }
}

// --- 2. MANEJADOR DE ALEXA ---
app.post('/', async (req, res) => {
    // PROTECCIÓN: Verificamos que la petición tenga el cuerpo esperado de Alexa
    if (!req.body || !req.body.request) {
        return res.status(400).send("Petición no válida");
    }

    const requestType = req.body.request.type;
    
    // VALIDACIÓN SEGURA DEL SKILL ID
    // Si la sesión existe, verificamos el ID. Si no existe (como en el simulador a veces), saltamos.
    if (req.body.session && req.body.session.application) {
        const skillId = req.body.session.application.applicationId;
        if (process.env.ALEXA_SKILL_ID && skillId !== process.env.ALEXA_SKILL_ID) {
            console.log("ALERTA: Skill ID no coincide");
            return res.status(403).send("Skill ID no autorizado");
        }
    }

    if (requestType === 'LaunchRequest') {
        return res.json(createResponse("YouTube listo. ¿Qué canción buscamos?"));
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'SearchIntent') {
        const query = req.body.request.intent.slots.query.value;
        const videoId = await searchYouTube(query);

        if (!videoId) return res.json(createResponse("No encontré el video."));

        const myServerUrl = `https://${req.headers.host}/stream/${videoId}`;

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Entendido, tocando ${query}` },
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
});

// --- 3. EL TÚNEL DE AUDIO ---
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`[TÚNEL] Procesando audio para: ${videoId}`);

    try {
        const options = {
            filter: 'audioonly',
            quality: 'highestaudio',
            requestOptions: {
                headers: {
                    // Usamos las cookies procesadas del JSON
                    cookie: process.env.YOUTUBE_COOKIES || '' 
                }
            }
        };

        res.setHeader('Content-Type', 'audio/mpeg');
        ytdl(videoUrl, options).pipe(res);

    } catch (error) {
        console.error(`[ERROR TÚNEL] ${error.message}`);
        res.status(500).send("Error en el puente de audio");
    }
});

function createResponse(text) {
    return { version: "1.0", response: { outputSpeech: { type: "PlainText", text: text }, shouldEndSession: false } };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));